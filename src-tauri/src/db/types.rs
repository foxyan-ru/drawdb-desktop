//! Wire types for the DB-client commands. Everything crossing the IPC
//! boundary is camelCase JSON (`#[serde(rename_all = "camelCase")]`).

use serde::{Deserialize, Serialize};
use std::fmt;

/// Database engine. Wire values: `"sqlite" | "postgres" | "mysql"`
/// (`"postgresql"` and `"mariadb"` are accepted as aliases on input).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Sqlite,
    #[serde(alias = "postgresql")]
    Postgres,
    #[serde(alias = "mariadb")]
    MySql,
}

/// Connection parameters supplied by the frontend.
///
/// SECURITY: `password` is kept in memory only. It is never serialized back
/// to the frontend (`skip_serializing`), never written to disk, and redacted
/// from `Debug` output.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSpec {
    pub kind: DbKind,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default, skip_serializing)]
    pub password: Option<String>,
    #[serde(default)]
    pub database: Option<String>,
    /// SQLite only: path to the database file.
    #[serde(default)]
    pub file_path: Option<String>,
    /// SQLite only: create the file if it does not exist (default `false`).
    /// `db_test` never creates the file, even when this is `true`.
    #[serde(default)]
    pub create_if_missing: Option<bool>,
}

impl fmt::Debug for ConnectionSpec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ConnectionSpec")
            .field("kind", &self.kind)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user", &self.user)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("database", &self.database)
            .field("file_path", &self.file_path)
            .field("create_if_missing", &self.create_if_missing)
            .finish()
    }
}

/// Treats `None`, `""` and whitespace-only strings as absent (frontend forms
/// usually send empty strings for untouched fields).
pub(crate) fn non_empty(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

impl ConnectionSpec {
    /// Checks that the fields each engine needs are present. Returns a
    /// user-facing error message instead of panicking.
    pub fn validate(&self) -> Result<(), String> {
        if self.port == Some(0) {
            return Err("Port must be between 1 and 65535.".into());
        }
        match self.kind {
            DbKind::Sqlite => {
                if non_empty(&self.file_path).is_none() {
                    return Err("SQLite connections require a database file path (`filePath`).".into());
                }
            }
            DbKind::Postgres | DbKind::MySql => {
                let engine = if self.kind == DbKind::Postgres { "PostgreSQL" } else { "MySQL" };
                let mut missing = Vec::new();
                if non_empty(&self.host).is_none() {
                    missing.push("host");
                }
                if non_empty(&self.user).is_none() {
                    missing.push("user");
                }
                // Postgres falls back to a database named after the user;
                // MySQL has no current schema without one, so introspection
                // would have nothing to read.
                if self.kind == DbKind::MySql && non_empty(&self.database).is_none() {
                    missing.push("database");
                }
                if !missing.is_empty() {
                    return Err(format!(
                        "{engine} connections require: {}.",
                        missing.join(", ")
                    ));
                }
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Introspection output
// ---------------------------------------------------------------------------

/// Result of `db_introspect`. Engine-neutral; the frontend maps it onto the
/// diagram model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaJson {
    pub engine: DbKind,
    /// SQLite: file path; Postgres: `current_database()`; MySQL: `DATABASE()`.
    pub database: Option<String>,
    pub tables: Vec<TableInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    /// Postgres: schema name (always set). SQLite/MySQL: `None`.
    pub schema: Option<String>,
    pub name: String,
    pub comment: Option<String>,
    /// In ordinal order.
    pub columns: Vec<ColumnInfo>,
    /// Primary-key column names in key order (empty if none).
    pub primary_key: Vec<String>,
    /// One entry per (column -> refColumn) pair. Composite FKs produce several
    /// entries sharing the same `name`.
    pub foreign_keys: Vec<ForeignKeyInfo>,
    /// All non-primary-key indexes, including ones backing UNIQUE constraints.
    pub indexes: Vec<IndexInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    /// Engine-native type text, e.g. `varchar(255)`, `integer`,
    /// `int(11) unsigned`, `character varying(40)`. Not normalized.
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    /// True when a single-column unique index/constraint covers this column.
    pub is_unique: bool,
    /// MySQL `auto_increment`, Postgres identity/`nextval()` default, SQLite
    /// sole `INTEGER PRIMARY KEY` (rowid alias).
    pub auto_increment: bool,
    /// Raw default expression as the engine reports it (not unquoted).
    pub default_value: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    /// Constraint name (Postgres/MySQL). SQLite has no FK names, so a stable
    /// synthetic `"<table>_fk_<id>"` is used — treat it as a grouping key.
    pub name: String,
    pub column: String,
    /// Postgres: always set. MySQL: set only when the referenced table lives
    /// in a different database. SQLite: `None`.
    pub ref_schema: Option<String>,
    pub ref_table: String,
    pub ref_column: String,
    /// `"NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT"`.
    pub on_update: Option<String>,
    pub on_delete: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    /// Plain column names in index order. Expression parts are omitted.
    pub columns: Vec<String>,
    pub unique: bool,
}

// ---------------------------------------------------------------------------
// Execution input/output
// ---------------------------------------------------------------------------

/// Options for `db_execute`.
///
/// SAFETY DEFAULTS: every field missing from the JSON (or `opts` omitted
/// entirely) falls back to `dryRun: true, useTransaction: true`. Nothing is
/// executed against the database unless the caller explicitly sends
/// `dryRun: false`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExecOptions {
    /// When true (the default), the SQL is only split into statements and
    /// echoed back with status `"dryRun"`; the database is not touched.
    pub dry_run: bool,
    /// When true (the default), all statements run inside one transaction
    /// that is rolled back if any statement fails. NOTE: MySQL/MariaDB
    /// implicitly commit DDL (CREATE/ALTER/DROP/...), so rollback cannot undo
    /// those there — a warning is returned in that case.
    pub use_transaction: bool,
}

impl Default for ExecOptions {
    fn default() -> Self {
        Self {
            dry_run: true,
            use_transaction: true,
        }
    }
}

/// Per-statement outcome.
/// Wire values: `"dryRun" | "ok" | "error" | "rolledBack" | "skipped"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatementStatus {
    /// Dry run: would have been executed.
    DryRun,
    /// Executed and applied.
    Ok,
    /// This statement failed (see `error`).
    Error,
    /// Executed successfully but undone by the transaction rollback.
    RolledBack,
    /// Not executed because an earlier statement (or BEGIN) failed.
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementResult {
    /// 0-based position in `statements`.
    pub index: usize,
    pub sql: String,
    pub status: StatementStatus,
    /// Present for statements that executed successfully.
    pub rows_affected: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub dry_run: bool,
    pub used_transaction: bool,
    /// True only if every statement executed (and, in transaction mode, the
    /// commit succeeded). Always true for a dry run.
    pub success: bool,
    /// True if a transaction was rolled back because a statement failed.
    pub rolled_back: bool,
    /// Index of the first failing statement, if any.
    pub failed_index: Option<usize>,
    /// Failure not tied to one statement (BEGIN/COMMIT/ROLLBACK/acquire).
    pub error: Option<String>,
    pub statements: Vec<StatementResult>,
    /// Human-readable caveats to surface in the UI (e.g. MySQL implicit
    /// commits). Also populated for dry runs.
    pub warnings: Vec<String>,
}
