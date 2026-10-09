//! DB client: connect to SQLite / PostgreSQL / MySQL, introspect the live
//! schema, and execute (migration) SQL. See CLAUDE.md §9.
//!
//! All three engines go through `sqlx` so every command shares one async,
//! pool-based API that maps directly onto Tauri async commands.
//!
//! Security: connection pools (and therefore passwords) live only in memory
//! in `DbState`. Nothing in this module writes connection details to disk or
//! logs them; sqlx statement logging is disabled on every connection.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use sqlx::{Connection, Executor};
use tauri::State;

/// Runs `$body` with `$p` bound to the concrete pool of whichever engine
/// `$pool` holds. Lets engine-agnostic code use each driver's concrete types.
macro_rules! with_pool {
    ($pool:expr, $p:ident => $body:expr) => {
        match $pool {
            DbPool::Sqlite($p) => $body,
            DbPool::Postgres($p) => $body,
            DbPool::MySql($p) => $body,
        }
    };
}

/// Executes `$statements` one by one on `$pool`, optionally inside a single
/// transaction, stopping at the first failure. Uses `sqlx::raw_sql` (the
/// engines' text/simple-query protocol) so DDL that MySQL can't prepare
/// still works. Evaluates to an `exec::RawOutcome`.
///
/// `tx.execute(raw_sql(..))` / `conn.execute(raw_sql(..))` (Executor::execute,
/// called on the connection), not `raw_sql(..).execute(&mut *tx)` (RawSql's
/// own execute, taking the connection as an argument) — the latter's looser
/// lifetime bound makes rustc's HRTB check fail with "implementation of
/// `Executor` is not general enough" when reached via
/// `tauri::generate_handler!`. Confirmed fix from the sqlx maintainers:
/// https://github.com/launchbadge/sqlx/issues/3581
macro_rules! run_statements {
    ($pool:expr, $statements:expr, $use_tx:expr) => {{
        let pool = $pool;
        let statements: &[String] = $statements;
        let mut outcomes: Vec<exec::StmtOutcome> = Vec::with_capacity(statements.len());
        let mut error: Option<String> = None;
        let mut rolled_back = false;
        if $use_tx {
            match pool.begin().await {
                Err(err) => error = Some(format!("Failed to begin transaction: {err}")),
                Ok(mut tx) => {
                    let mut failed = false;
                    for stmt in statements {
                        match tx.execute(sqlx::raw_sql(stmt.as_str())).await {
                            Ok(res) => outcomes.push(exec::StmtOutcome::Ok(res.rows_affected())),
                            Err(err) => {
                                outcomes.push(exec::StmtOutcome::Err(err.to_string()));
                                failed = true;
                                break;
                            }
                        }
                    }
                    if failed {
                        match tx.rollback().await {
                            Ok(()) => rolled_back = true,
                            Err(err) => error = Some(format!("Rollback failed: {err}")),
                        }
                    } else if let Err(err) = tx.commit().await {
                        error = Some(format!("Commit failed: {err}"));
                    }
                }
            }
        } else {
            match pool.acquire().await {
                Err(err) => error = Some(format!("Failed to acquire a connection: {err}")),
                Ok(mut conn) => {
                    for stmt in statements {
                        match conn.execute(sqlx::raw_sql(stmt.as_str())).await {
                            Ok(res) => outcomes.push(exec::StmtOutcome::Ok(res.rows_affected())),
                            Err(err) => {
                                outcomes.push(exec::StmtOutcome::Err(err.to_string()));
                                break;
                            }
                        }
                    }
                }
            }
        }
        exec::RawOutcome { outcomes, error, rolled_back }
    }};
}

mod exec;
mod introspect;
mod mysql;
mod postgres;
mod split;
mod sqlite;
pub mod types;

use types::{ConnectionSpec, DbKind, ExecOptions, ExecResult, SchemaJson};

/// Upper bound for opening a connection / waiting for a pooled one, so a
/// wrong host doesn't hang the UI for the OS TCP timeout.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CONNECTIONS: u32 = 4;

#[derive(Clone)]
enum DbPool {
    Sqlite(SqlitePool),
    Postgres(PgPool),
    MySql(MySqlPool),
}

struct DbConnection {
    kind: DbKind,
    pool: DbPool,
    /// SQLite file path, reported back as `SchemaJson.database`.
    label: Option<String>,
}

/// Tauri managed state: open pools keyed by connection id. Memory only.
#[derive(Default)]
pub struct DbState {
    connections: Mutex<HashMap<String, DbConnection>>,
    next_id: AtomicU64,
}

impl DbState {
    /// Clones the pool handle out so the mutex is never held across `.await`.
    fn get(&self, id: &str) -> Result<(DbKind, DbPool, Option<String>), String> {
        let map = self.connections.lock().map_err(|e| e.to_string())?;
        map.get(id)
            .map(|c| (c.kind, c.pool.clone(), c.label.clone()))
            .ok_or_else(|| format!("Unknown or closed connection: {id}"))
    }
}

fn dialect(kind: DbKind) -> split::Dialect {
    match kind {
        DbKind::Sqlite => split::Dialect::Sqlite,
        DbKind::Postgres => split::Dialect::Postgres,
        DbKind::MySql => split::Dialect::MySql,
    }
}

async fn open_pool(spec: &ConnectionSpec, max_connections: u32, allow_create: bool) -> Result<DbPool, String> {
    spec.validate()?;
    let pool = match spec.kind {
        DbKind::Sqlite => DbPool::Sqlite(
            SqlitePoolOptions::new()
                .max_connections(max_connections)
                .acquire_timeout(CONNECT_TIMEOUT)
                .connect_with(sqlite::connect_options(spec, allow_create)?)
                .await
                .map_err(|e| e.to_string())?,
        ),
        DbKind::Postgres => DbPool::Postgres(
            PgPoolOptions::new()
                .max_connections(max_connections)
                .acquire_timeout(CONNECT_TIMEOUT)
                .connect_with(postgres::connect_options(spec))
                .await
                .map_err(|e| e.to_string())?,
        ),
        DbKind::MySql => DbPool::MySql(
            MySqlPoolOptions::new()
                .max_connections(max_connections)
                .acquire_timeout(CONNECT_TIMEOUT)
                .connect_with(mysql::connect_options(spec))
                .await
                .map_err(|e| e.to_string())?,
        ),
    };
    Ok(pool)
}

/// Opens a connection pool and registers it. Returns the connection id
/// (`"conn-<n>"`) used by the other `db_*` commands.
#[tauri::command]
pub async fn db_connect(state: State<'_, DbState>, spec: ConnectionSpec) -> Result<String, String> {
    let pool = open_pool(&spec, MAX_CONNECTIONS, true).await?;
    let id = format!("conn-{}", state.next_id.fetch_add(1, Ordering::Relaxed) + 1);
    let label = match spec.kind {
        DbKind::Sqlite => types::non_empty(&spec.file_path).map(str::to_string),
        _ => None,
    };
    {
        let mut map = state.connections.lock().map_err(|e| e.to_string())?;
        map.insert(id.clone(), DbConnection { kind: spec.kind, pool, label });
    }
    Ok(id)
}

/// Connects, pings and closes again without registering anything.
/// Never creates a SQLite file (reports success if `createIfMissing` is set
/// and the parent directory exists).
#[tauri::command]
pub async fn db_test(spec: ConnectionSpec) -> Result<bool, String> {
    spec.validate()?;
    if spec.kind == DbKind::Sqlite && spec.create_if_missing.unwrap_or(false) {
        if let Some(path) = types::non_empty(&spec.file_path) {
            let p = std::path::Path::new(path);
            if !p.exists() {
                let parent_ok = p
                    .parent()
                    .map_or(true, |d| d.as_os_str().is_empty() || d.is_dir());
                return if parent_ok {
                    Ok(true)
                } else {
                    Err(format!("Directory does not exist for SQLite file: {path}"))
                };
            }
        }
    }
    let pool = open_pool(&spec, 1, false).await?;
    let result: Result<(), String> = with_pool!(&pool, p => {
        match p.acquire().await {
            Ok(mut conn) => conn.ping().await.map_err(|e| e.to_string()),
            Err(e) => Err(e.to_string()),
        }
    });
    with_pool!(&pool, p => p.close().await);
    result.map(|_| true)
}

/// Reads tables, columns, primary keys, foreign keys and indexes. Issues
/// read-only queries only (Postgres additionally runs them in a READ ONLY
/// transaction).
#[tauri::command]
pub async fn db_introspect(state: State<'_, DbState>, connection_id: String) -> Result<SchemaJson, String> {
    let (kind, pool, label) = state.get(&connection_id)?;
    let (database, tables) = match &pool {
        DbPool::Sqlite(p) => (label, sqlite::introspect(p).await?),
        DbPool::Postgres(p) => postgres::introspect(p).await?,
        DbPool::MySql(p) => mysql::introspect(p).await?,
    };
    Ok(SchemaJson { engine: kind, database, tables })
}

/// Splits `sql` into statements and (unless dry-running) executes them.
///
/// `opts` may be omitted; missing fields default to
/// `{ dryRun: true, useTransaction: true }` — nothing touches the database
/// unless the caller explicitly passes `dryRun: false`.
///
/// Statements are split client-side (see `split.rs`) and run one at a time
/// so each gets its own status / rowsAffected / error. Execution stops at the
/// first failure; in transaction mode everything is rolled back (except DDL
/// on MySQL, which commits implicitly — reported via `warnings`).
#[tauri::command]
pub async fn db_execute(
    state: State<'_, DbState>,
    connection_id: String,
    sql: String,
    opts: Option<ExecOptions>,
) -> Result<ExecResult, String> {
    let opts = opts.unwrap_or_default();
    let (kind, pool, _) = state.get(&connection_id)?;
    let statements = split::split_statements(&sql, dialect(kind));
    if statements.is_empty() {
        return Err("No SQL statements to execute.".into());
    }
    let warnings = exec::warnings(kind, &statements, &opts);
    if opts.dry_run {
        return Ok(exec::dry_run_result(statements, &opts, warnings));
    }
    let raw = with_pool!(&pool, p => run_statements!(p, &statements, opts.use_transaction));
    Ok(exec::build_result(kind, statements, &opts, raw, warnings))
}

/// Closes the pool and forgets the connection id.
#[tauri::command]
pub async fn db_disconnect(state: State<'_, DbState>, connection_id: String) -> Result<(), String> {
    let removed = {
        let mut map = state.connections.lock().map_err(|e| e.to_string())?;
        map.remove(&connection_id)
    };
    match removed {
        Some(conn) => {
            with_pool!(&conn.pool, p => p.close().await);
            Ok(())
        }
        None => Err(format!("Unknown or closed connection: {connection_id}")),
    }
}
