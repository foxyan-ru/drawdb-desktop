//! MySQL / MariaDB: connection options + schema introspection.
//!
//! Introspection reads `information_schema` for the connection's current
//! database (`DATABASE()`). Every value is wrapped in `CAST(... AS CHAR)` /
//! `CAST(... AS SIGNED)` because MySQL 8 reports several information_schema
//! columns with binary collations, which sqlx refuses to decode as `String`.
//! Only SELECTs are issued.

use std::collections::HashMap;

use sqlx::mysql::{MySqlConnectOptions, MySqlPool};
use sqlx::{ConnectOptions, Row};

use super::introspect::{finalize, new_column, new_table, normalize_action};
use super::types::{non_empty, ConnectionSpec, ForeignKeyInfo, IndexInfo, TableInfo};

pub(crate) fn connect_options(spec: &ConnectionSpec) -> MySqlConnectOptions {
    let mut o = MySqlConnectOptions::new().charset("utf8mb4");
    if let Some(host) = non_empty(&spec.host) {
        o = o.host(host);
    }
    o = o.port(spec.port.unwrap_or(3306));
    if let Some(user) = non_empty(&spec.user) {
        o = o.username(user);
    }
    // Password is passed straight into the in-memory options; never logged.
    if let Some(pw) = spec.password.as_deref().filter(|p| !p.is_empty()) {
        o = o.password(pw);
    }
    if let Some(db) = non_empty(&spec.database) {
        o = o.database(db);
    }
    o.disable_statement_logging()
}

fn e(err: sqlx::Error) -> String {
    err.to_string()
}

pub(crate) async fn introspect(pool: &MySqlPool) -> Result<(Option<String>, Vec<TableInfo>), String> {
    let database: Option<String> = sqlx::query("SELECT CAST(DATABASE() AS CHAR)")
        .fetch_one(pool)
        .await
        .map_err(e)?
        .try_get(0)
        .map_err(e)?;
    let Some(db) = database.clone() else {
        return Err("No database selected for this MySQL connection.".into());
    };

    let rows = sqlx::query(
        "SELECT CAST(TABLE_NAME AS CHAR), CAST(TABLE_COMMENT AS CHAR) \
         FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' \
         ORDER BY TABLE_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(e)?;

    let mut tables: Vec<TableInfo> = Vec::with_capacity(rows.len());
    let mut by_name: HashMap<String, usize> = HashMap::new();
    for r in &rows {
        let name: String = r.try_get(0).map_err(e)?;
        let comment: Option<String> = r.try_get(1).map_err(e)?;
        by_name.insert(name.clone(), tables.len());
        tables.push(new_table(None, name, comment));
    }

    // Columns. COLUMN_TYPE keeps length/unsigned/enum values, e.g.
    // `int(11) unsigned`, `enum('a','b')`.
    let rows = sqlx::query(
        "SELECT CAST(TABLE_NAME AS CHAR), CAST(COLUMN_NAME AS CHAR), CAST(COLUMN_TYPE AS CHAR), \
                CAST(IS_NULLABLE AS CHAR), CAST(COLUMN_DEFAULT AS CHAR), CAST(EXTRA AS CHAR), \
                CAST(COLUMN_COMMENT AS CHAR) \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = DATABASE() \
         ORDER BY TABLE_NAME, ORDINAL_POSITION",
    )
    .fetch_all(pool)
    .await
    .map_err(e)?;
    for r in &rows {
        let table: String = r.try_get(0).map_err(e)?;
        let Some(&ti) = by_name.get(&table) else { continue };
        let name: String = r.try_get(1).map_err(e)?;
        let data_type: String = r.try_get(2).map_err(e)?;
        let is_nullable: Option<String> = r.try_get(3).map_err(e)?;
        let default_value: Option<String> = r.try_get(4).map_err(e)?;
        let extra: Option<String> = r.try_get(5).map_err(e)?;
        let comment: Option<String> = r.try_get(6).map_err(e)?;
        let auto_increment = extra
            .as_deref()
            .map_or(false, |x| x.to_ascii_lowercase().contains("auto_increment"));
        tables[ti].columns.push(new_column(
            name,
            data_type,
            is_nullable.as_deref() == Some("YES"),
            auto_increment,
            default_value,
            comment,
        ));
    }

    // Indexes, including PRIMARY (split out below). COLUMN_NAME is NULL for
    // functional key parts (MySQL 8.0.13+); those parts are omitted.
    let rows = sqlx::query(
        "SELECT CAST(TABLE_NAME AS CHAR), CAST(INDEX_NAME AS CHAR), CAST(NON_UNIQUE AS SIGNED), \
                CAST(COLUMN_NAME AS CHAR) \
         FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA = DATABASE() \
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
    )
    .fetch_all(pool)
    .await
    .map_err(e)?;
    for r in &rows {
        let table: String = r.try_get(0).map_err(e)?;
        let Some(&ti) = by_name.get(&table) else { continue };
        let index_name: String = r.try_get(1).map_err(e)?;
        let non_unique: i64 = r.try_get(2).map_err(e)?;
        let column: Option<String> = r.try_get(3).map_err(e)?;
        let t = &mut tables[ti];
        if index_name == "PRIMARY" {
            if let Some(col) = column {
                t.primary_key.push(col);
            }
            continue;
        }
        // Rows are ordered by index name, so the current index is always last.
        if t.indexes.last().map_or(true, |ix| ix.name != index_name) {
            t.indexes.push(IndexInfo {
                name: index_name,
                columns: Vec::new(),
                unique: non_unique == 0,
            });
        }
        if let (Some(col), Some(ix)) = (column, t.indexes.last_mut()) {
            ix.columns.push(col);
        }
    }

    // Foreign keys, one row per column pair, ordered within each constraint.
    let rows = sqlx::query(
        "SELECT CAST(k.TABLE_NAME AS CHAR), CAST(k.CONSTRAINT_NAME AS CHAR), CAST(k.COLUMN_NAME AS CHAR), \
                CAST(k.REFERENCED_TABLE_SCHEMA AS CHAR), CAST(k.REFERENCED_TABLE_NAME AS CHAR), \
                CAST(k.REFERENCED_COLUMN_NAME AS CHAR), \
                CAST(r.UPDATE_RULE AS CHAR), CAST(r.DELETE_RULE AS CHAR) \
         FROM information_schema.KEY_COLUMN_USAGE k \
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r \
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA \
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME \
          AND r.TABLE_NAME = k.TABLE_NAME \
         WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION",
    )
    .fetch_all(pool)
    .await
    .map_err(e)?;
    for r in &rows {
        let table: String = r.try_get(0).map_err(e)?;
        let Some(&ti) = by_name.get(&table) else { continue };
        let name: String = r.try_get(1).map_err(e)?;
        let column: String = r.try_get(2).map_err(e)?;
        let ref_schema: Option<String> = r.try_get(3).map_err(e)?;
        let ref_table: String = r.try_get(4).map_err(e)?;
        let ref_column: Option<String> = r.try_get(5).map_err(e)?;
        let on_update: Option<String> = r.try_get(6).map_err(e)?;
        let on_delete: Option<String> = r.try_get(7).map_err(e)?;
        tables[ti].foreign_keys.push(ForeignKeyInfo {
            name,
            column,
            // Only meaningful for cross-database references.
            ref_schema: ref_schema.filter(|s| s != &db),
            ref_table,
            ref_column: ref_column.unwrap_or_default(),
            on_update: normalize_action(on_update),
            on_delete: normalize_action(on_delete),
        });
    }

    finalize(&mut tables);
    Ok((database, tables))
}
