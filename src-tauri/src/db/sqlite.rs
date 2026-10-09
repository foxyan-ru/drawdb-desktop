//! SQLite: connection options + schema introspection.
//!
//! Introspection uses the PRAGMA table-valued functions
//! (`pragma_table_info`, `pragma_foreign_key_list`, `pragma_index_list`,
//! `pragma_index_info`) so table names can be bound as parameters instead of
//! being quoted into the SQL. These are read-only.

use std::collections::HashMap;
use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use sqlx::{ConnectOptions, Row};

use super::introspect::{finalize, new_column, new_table, normalize_action};
use super::types::{non_empty, ConnectionSpec, ForeignKeyInfo, IndexInfo, TableInfo};

/// Builds connect options. `allow_create` lets the caller veto file creation
/// (used by `db_test`, which must have no side effects).
pub(crate) fn connect_options(spec: &ConnectionSpec, allow_create: bool) -> Result<SqliteConnectOptions, String> {
    let path = non_empty(&spec.file_path)
        .ok_or_else(|| "SQLite connections require a database file path (`filePath`).".to_string())?;
    let create = allow_create && spec.create_if_missing.unwrap_or(false);
    if !create && !Path::new(path).exists() {
        return Err(format!("SQLite database file not found: {path}"));
    }
    // sqlx does not change journal_mode unless asked, so opening a file here
    // does not persistently alter it. Statement logging is disabled so user
    // SQL/data never reaches a log sink.
    Ok(SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(create)
        .foreign_keys(true)
        .disable_statement_logging())
}

fn e(err: sqlx::Error) -> String {
    err.to_string()
}

pub(crate) async fn introspect(pool: &SqlitePool) -> Result<Vec<TableInfo>, String> {
    let table_rows = sqlx::query(
        "SELECT CAST(name AS TEXT) FROM sqlite_master \
         WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(e)?;

    let mut tables: Vec<TableInfo> = Vec::with_capacity(table_rows.len());
    // (table index, fk name, seq) for FKs whose `to` column is implicit and
    // must be resolved against the referenced table's primary key.
    let mut unresolved: Vec<(usize, usize, i64)> = Vec::new();

    for row in &table_rows {
        let name: String = row.try_get(0).map_err(e)?;
        let mut table = new_table(None, name.clone(), None);

        // Columns. `pk` is the 1-based position in the primary key (0 = not).
        let cols = sqlx::query(
            "SELECT CAST(name AS TEXT), CAST(type AS TEXT), CAST(\"notnull\" AS INTEGER), \
                    CAST(dflt_value AS TEXT), CAST(pk AS INTEGER) \
             FROM pragma_table_info(?1) ORDER BY cid",
        )
        .bind(&name)
        .fetch_all(pool)
        .await
        .map_err(e)?;

        let mut pk: Vec<(i64, String)> = Vec::new();
        for c in &cols {
            let col_name: String = c.try_get(0).map_err(e)?;
            let data_type: Option<String> = c.try_get(1).map_err(e)?;
            let not_null: i64 = c.try_get(2).map_err(e)?;
            let default_value: Option<String> = c.try_get(3).map_err(e)?;
            let pk_pos: i64 = c.try_get(4).map_err(e)?;
            if pk_pos > 0 {
                pk.push((pk_pos, col_name.clone()));
            }
            table.columns.push(new_column(
                col_name,
                data_type.unwrap_or_default(),
                // SQLite PK columns may technically be NULL-able (legacy quirk)
                // unless declared NOT NULL; report what the schema says.
                not_null == 0,
                false,
                default_value,
                None,
            ));
        }
        pk.sort_by_key(|(pos, _)| *pos);
        table.primary_key = pk.into_iter().map(|(_, n)| n).collect();

        // A sole INTEGER PRIMARY KEY is an alias for rowid and auto-assigns.
        if table.primary_key.len() == 1 {
            let pk_name = table.primary_key[0].clone();
            if let Some(col) = table.columns.iter_mut().find(|c| c.name == pk_name) {
                col.auto_increment = col.data_type.eq_ignore_ascii_case("INTEGER");
            }
        }

        // Foreign keys (composite FKs share `id`, ordered by `seq`).
        let fks = sqlx::query(
            "SELECT CAST(id AS INTEGER), CAST(seq AS INTEGER), CAST(\"table\" AS TEXT), \
                    CAST(\"from\" AS TEXT), CAST(\"to\" AS TEXT), \
                    CAST(on_update AS TEXT), CAST(on_delete AS TEXT) \
             FROM pragma_foreign_key_list(?1) ORDER BY id, seq",
        )
        .bind(&name)
        .fetch_all(pool)
        .await
        .map_err(e)?;

        for f in &fks {
            let id: i64 = f.try_get(0).map_err(e)?;
            let seq: i64 = f.try_get(1).map_err(e)?;
            let ref_table: String = f.try_get(2).map_err(e)?;
            let from: String = f.try_get(3).map_err(e)?;
            let to: Option<String> = f.try_get(4).map_err(e)?;
            let on_update: Option<String> = f.try_get(5).map_err(e)?;
            let on_delete: Option<String> = f.try_get(6).map_err(e)?;
            let to = to.filter(|t| !t.is_empty());
            if to.is_none() {
                unresolved.push((tables.len(), table.foreign_keys.len(), seq));
            }
            table.foreign_keys.push(ForeignKeyInfo {
                name: format!("{name}_fk_{id}"),
                column: from,
                ref_schema: None,
                ref_table,
                ref_column: to.unwrap_or_default(),
                on_update: normalize_action(on_update),
                on_delete: normalize_action(on_delete),
            });
        }

        // Indexes. origin: 'c' = CREATE INDEX, 'u' = UNIQUE constraint,
        // 'pk' = PRIMARY KEY (skipped — already in `primary_key`).
        let idx_rows = sqlx::query(
            "SELECT CAST(name AS TEXT), CAST(\"unique\" AS INTEGER), CAST(origin AS TEXT) \
             FROM pragma_index_list(?1) ORDER BY name",
        )
        .bind(&name)
        .fetch_all(pool)
        .await
        .map_err(e)?;

        for ix in &idx_rows {
            let ix_name: String = ix.try_get(0).map_err(e)?;
            let unique: i64 = ix.try_get(1).map_err(e)?;
            let origin: Option<String> = ix.try_get(2).map_err(e)?;
            if origin.as_deref() == Some("pk") {
                continue;
            }
            let ix_cols = sqlx::query(
                "SELECT CAST(name AS TEXT) FROM pragma_index_info(?1) ORDER BY seqno",
            )
            .bind(&ix_name)
            .fetch_all(pool)
            .await
            .map_err(e)?;
            let mut columns = Vec::with_capacity(ix_cols.len());
            for ic in &ix_cols {
                // NULL name = expression column; omitted.
                let col: Option<String> = ic.try_get(0).map_err(e)?;
                if let Some(col) = col {
                    columns.push(col);
                }
            }
            table.indexes.push(IndexInfo {
                name: ix_name,
                columns,
                unique: unique != 0,
            });
        }

        tables.push(table);
    }

    // `REFERENCES parent` without a column list targets the parent's PK.
    if !unresolved.is_empty() {
        let pks: HashMap<String, Vec<String>> = tables
            .iter()
            .map(|t| (t.name.clone(), t.primary_key.clone()))
            .collect();
        for (ti, fi, seq) in unresolved {
            let fk = &mut tables[ti].foreign_keys[fi];
            if let Some(col) = pks.get(&fk.ref_table).and_then(|pk| pk.get(seq as usize)) {
                fk.ref_column = col.clone();
            }
        }
    }

    finalize(&mut tables);
    Ok(tables)
}
