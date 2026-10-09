//! PostgreSQL: connection options + schema introspection.
//!
//! Introspection reads `pg_catalog` directly rather than
//! `information_schema`: the latter exposes domain types (`sql_identifier`,
//! `yes_or_no`) that sqlx refuses to decode as `String`, and `pg_catalog`
//! gives `format_type()` output (e.g. `character varying(40)`). Every text
//! value is cast to `::text` for the same reason. All queries run inside a
//! `READ ONLY` transaction that is rolled back afterwards.
//!
//! Requires PostgreSQL 10+ (`relispartition`, `attidentity`).
//! All user schemas are included (everything except `pg_*` and
//! `information_schema`); partition children are skipped.

use std::collections::HashMap;

use sqlx::postgres::{PgConnectOptions, PgPool};
use sqlx::{ConnectOptions, Row};

use super::introspect::{finalize, new_column, new_table, pg_action};
use super::types::{non_empty, ConnectionSpec, ForeignKeyInfo, IndexInfo, TableInfo};

pub(crate) fn connect_options(spec: &ConnectionSpec) -> PgConnectOptions {
    // NOTE: `PgConnectOptions::new()` seeds defaults from libpq env vars
    // (PGHOST, PGPASSWORD, ...) and ~/.pgpass; explicit fields override them.
    let mut o = PgConnectOptions::new().application_name("DrawDB");
    if let Some(host) = non_empty(&spec.host) {
        o = o.host(host);
    }
    o = o.port(spec.port.unwrap_or(5432));
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

const SCHEMA_FILTER: &str = "n.nspname <> 'information_schema' AND left(n.nspname, 3) <> 'pg_'";

pub(crate) async fn introspect(pool: &PgPool) -> Result<(Option<String>, Vec<TableInfo>), String> {
    let mut tx = pool.begin().await.map_err(e)?;
    sqlx::raw_sql("SET TRANSACTION READ ONLY")
        .execute(&mut *tx)
        .await
        .map_err(e)?;

    let database: Option<String> = sqlx::query("SELECT current_database()::text")
        .fetch_one(&mut *tx)
        .await
        .map_err(e)?
        .try_get(0)
        .map_err(e)?;

    // Tables (ordinary + partitioned parents).
    let table_sql = format!(
        "SELECT n.nspname::text, c.relname::text, obj_description(c.oid, 'pg_class') \
         FROM pg_catalog.pg_class c \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND {SCHEMA_FILTER} \
         ORDER BY n.nspname, c.relname"
    );
    let rows = sqlx::query(&table_sql).fetch_all(&mut *tx).await.map_err(e)?;

    let mut tables: Vec<TableInfo> = Vec::with_capacity(rows.len());
    let mut by_key: HashMap<(String, String), usize> = HashMap::new();
    for r in &rows {
        let schema: String = r.try_get(0).map_err(e)?;
        let name: String = r.try_get(1).map_err(e)?;
        let comment: Option<String> = r.try_get(2).map_err(e)?;
        by_key.insert((schema.clone(), name.clone()), tables.len());
        tables.push(new_table(Some(schema), name, comment));
    }

    // Columns.
    let col_sql = format!(
        "SELECT n.nspname::text, c.relname::text, a.attname::text, \
                pg_catalog.format_type(a.atttypid, a.atttypmod), \
                NOT a.attnotnull, \
                pg_catalog.pg_get_expr(d.adbin, d.adrelid), \
                (a.attidentity <> ''), \
                pg_catalog.col_description(c.oid, a.attnum) \
         FROM pg_catalog.pg_attribute a \
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
         WHERE a.attnum > 0 AND NOT a.attisdropped \
           AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND {SCHEMA_FILTER} \
         ORDER BY n.nspname, c.relname, a.attnum"
    );
    let rows = sqlx::query(&col_sql).fetch_all(&mut *tx).await.map_err(e)?;
    for r in &rows {
        let schema: String = r.try_get(0).map_err(e)?;
        let table: String = r.try_get(1).map_err(e)?;
        let Some(&ti) = by_key.get(&(schema, table)) else { continue };
        let name: String = r.try_get(2).map_err(e)?;
        let data_type: String = r.try_get(3).map_err(e)?;
        let nullable: bool = r.try_get(4).map_err(e)?;
        let default_value: Option<String> = r.try_get(5).map_err(e)?;
        let is_identity: bool = r.try_get(6).map_err(e)?;
        let comment: Option<String> = r.try_get(7).map_err(e)?;
        // serial/bigserial columns show up as a nextval() default.
        let auto_increment = is_identity
            || default_value
                .as_deref()
                .map_or(false, |d| d.starts_with("nextval("));
        tables[ti].columns.push(new_column(
            name,
            data_type,
            nullable,
            auto_increment,
            default_value,
            comment,
        ));
    }

    // Primary keys + foreign keys. Column arrays are ordered by key position.
    let con_sql = format!(
        "SELECT n.nspname::text, c.relname::text, con.conname::text, con.contype::text, \
                ARRAY(SELECT a.attname::text \
                      FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) \
                      JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum \
                      ORDER BY k.ord), \
                fn.nspname::text, fc.relname::text, \
                ARRAY(SELECT a.attname::text \
                      FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord) \
                      JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum \
                      ORDER BY k.ord), \
                con.confupdtype::text, con.confdeltype::text \
         FROM pg_catalog.pg_constraint con \
         JOIN pg_catalog.pg_class c ON c.oid = con.conrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         LEFT JOIN pg_catalog.pg_class fc ON fc.oid = con.confrelid \
         LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace \
         WHERE con.contype IN ('p', 'f') AND {SCHEMA_FILTER} \
         ORDER BY n.nspname, c.relname, con.conname"
    );
    let rows = sqlx::query(&con_sql).fetch_all(&mut *tx).await.map_err(e)?;
    for r in &rows {
        let schema: String = r.try_get(0).map_err(e)?;
        let table: String = r.try_get(1).map_err(e)?;
        let Some(&ti) = by_key.get(&(schema, table)) else { continue };
        let con_name: String = r.try_get(2).map_err(e)?;
        let con_type: String = r.try_get(3).map_err(e)?;
        let cols: Vec<String> = r.try_get(4).map_err(e)?;
        if con_type == "p" {
            tables[ti].primary_key = cols;
            continue;
        }
        let ref_schema: Option<String> = r.try_get(5).map_err(e)?;
        let ref_table: Option<String> = r.try_get(6).map_err(e)?;
        let ref_cols: Vec<String> = r.try_get(7).map_err(e)?;
        let on_update = pg_action(r.try_get(8).map_err(e)?);
        let on_delete = pg_action(r.try_get(9).map_err(e)?);
        let Some(ref_table) = ref_table else { continue };
        for (col, ref_col) in cols.into_iter().zip(ref_cols.into_iter()) {
            tables[ti].foreign_keys.push(ForeignKeyInfo {
                name: con_name.clone(),
                column: col,
                ref_schema: ref_schema.clone(),
                ref_table: ref_table.clone(),
                ref_column: ref_col,
                on_update: on_update.clone(),
                on_delete: on_delete.clone(),
            });
        }
    }

    // Non-primary indexes (includes those backing UNIQUE constraints).
    // indkey is a 0-based int2vector; expression entries (attnum 0) drop out
    // of the join. INCLUDE columns (PG11+) are listed too.
    let idx_sql = format!(
        "SELECT n.nspname::text, c.relname::text, i.relname::text, ix.indisunique, \
                ARRAY(SELECT a.attname::text \
                      FROM generate_series(0, ix.indnatts - 1) AS s(pos) \
                      JOIN pg_catalog.pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ix.indkey[s.pos] \
                      ORDER BY s.pos) \
         FROM pg_catalog.pg_index ix \
         JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid \
         JOIN pg_catalog.pg_class c ON c.oid = ix.indrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         WHERE NOT ix.indisprimary AND c.relkind IN ('r', 'p') AND NOT c.relispartition \
           AND {SCHEMA_FILTER} \
         ORDER BY n.nspname, c.relname, i.relname"
    );
    let rows = sqlx::query(&idx_sql).fetch_all(&mut *tx).await.map_err(e)?;
    for r in &rows {
        let schema: String = r.try_get(0).map_err(e)?;
        let table: String = r.try_get(1).map_err(e)?;
        let Some(&ti) = by_key.get(&(schema, table)) else { continue };
        let name: String = r.try_get(2).map_err(e)?;
        let unique: bool = r.try_get(3).map_err(e)?;
        let columns: Vec<String> = r.try_get(4).map_err(e)?;
        tables[ti].indexes.push(IndexInfo { name, columns, unique });
    }

    // Read-only work; nothing to commit.
    let _ = tx.rollback().await;

    finalize(&mut tables);
    Ok((database, tables))
}
