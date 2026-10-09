//! Engine-neutral parts of `db_execute`: pre-flight warnings, the dry-run
//! report, and turning raw per-statement outcomes into an `ExecResult`.
//! The engine-specific execution loop lives in the `run_statements!` macro
//! in `mod.rs` (a macro rather than a generic fn to avoid sqlx's
//! higher-ranked `Executor` bounds).

use super::split::leading_keyword;
use super::types::{DbKind, ExecOptions, ExecResult, StatementResult, StatementStatus};

/// Raw result of one statement inside the execution loop.
pub(crate) enum StmtOutcome {
    Ok(u64),
    Err(String),
}

/// What the execution loop reports back. `outcomes` may be shorter than the
/// statement list: statements after a failure are not attempted.
pub(crate) struct RawOutcome {
    pub outcomes: Vec<StmtOutcome>,
    /// BEGIN / COMMIT / ROLLBACK / acquire failure.
    pub error: Option<String>,
    pub rolled_back: bool,
}

/// MySQL/MariaDB statements that cause an implicit COMMIT
/// (https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html — the DDL
/// subset relevant to schema migration).
fn mysql_implicit_commit(stmt: &str) -> bool {
    matches!(
        leading_keyword(stmt).as_str(),
        "CREATE" | "ALTER" | "DROP" | "RENAME" | "TRUNCATE" | "LOCK" | "UNLOCK" | "GRANT" | "REVOKE"
    )
}

fn looks_like_compound_block(stmt: &str) -> bool {
    if leading_keyword(stmt) != "CREATE" {
        return false;
    }
    let head: String = stmt.chars().take(200).collect::<String>().to_ascii_uppercase();
    head.contains("TRIGGER") || head.contains("PROCEDURE") || head.contains("FUNCTION")
}

/// Caveats computed from the statements alone — returned for dry runs too so
/// the preview UI can show them before the user confirms.
pub(crate) fn warnings(kind: DbKind, statements: &[String], opts: &ExecOptions) -> Vec<String> {
    let mut w = Vec::new();
    if opts.use_transaction {
        if kind == DbKind::MySql && statements.iter().any(|s| mysql_implicit_commit(s)) {
            w.push(
                "MySQL/MariaDB implicitly commits DDL statements (CREATE/ALTER/DROP/RENAME/TRUNCATE). \
                 If a statement fails part-way, statements that already ran cannot be rolled back."
                    .to_string(),
            );
        }
        if statements.iter().any(|s| {
            matches!(
                leading_keyword(s).as_str(),
                "BEGIN" | "COMMIT" | "ROLLBACK" | "START" | "END" | "SAVEPOINT"
            )
        }) {
            w.push(
                "The SQL contains its own transaction control (BEGIN/COMMIT/ROLLBACK); \
                 it may interfere with the wrapping transaction."
                    .to_string(),
            );
        }
    } else {
        w.push(
            "Running without a transaction: if a statement fails, earlier statements stay applied."
                .to_string(),
        );
    }
    if kind != DbKind::Postgres && statements.iter().any(|s| looks_like_compound_block(s)) {
        w.push(
            "Trigger/procedure/function bodies containing ';' are split into separate statements \
             and will likely fail; run them separately."
                .to_string(),
        );
    }
    w
}

pub(crate) fn dry_run_result(statements: Vec<String>, opts: &ExecOptions, warnings: Vec<String>) -> ExecResult {
    ExecResult {
        dry_run: true,
        used_transaction: opts.use_transaction,
        success: true,
        rolled_back: false,
        failed_index: None,
        error: None,
        statements: statements
            .into_iter()
            .enumerate()
            .map(|(index, sql)| StatementResult {
                index,
                sql,
                status: StatementStatus::DryRun,
                rows_affected: None,
                error: None,
            })
            .collect(),
        warnings,
    }
}

pub(crate) fn build_result(
    kind: DbKind,
    statements: Vec<String>,
    opts: &ExecOptions,
    raw: RawOutcome,
    mut warnings: Vec<String>,
) -> ExecResult {
    let failed_index = raw
        .outcomes
        .iter()
        .position(|o| matches!(o, StmtOutcome::Err(_)));

    // On MySQL, once any implicit-commit statement has run, everything before
    // it was committed and everything after it ran in autocommit mode, so the
    // rollback undid nothing that already succeeded.
    let mysql_partial = kind == DbKind::MySql
        && raw.rolled_back
        && raw
            .outcomes
            .iter()
            .zip(statements.iter())
            .any(|(o, s)| matches!(o, StmtOutcome::Ok(_)) && mysql_implicit_commit(s));
    if mysql_partial {
        warnings.push(
            "Rollback could not undo statements already committed by MySQL's implicit commit; \
             statements marked \"ok\" remain applied."
                .to_string(),
        );
    }
    let undone = raw.rolled_back && !mysql_partial;

    let complete = raw.outcomes.len() == statements.len();
    let mut outcomes = raw.outcomes.into_iter();
    let results = statements
        .into_iter()
        .enumerate()
        .map(|(index, sql)| match outcomes.next() {
            Some(StmtOutcome::Ok(n)) => StatementResult {
                index,
                sql,
                status: if undone { StatementStatus::RolledBack } else { StatementStatus::Ok },
                rows_affected: Some(n),
                error: None,
            },
            Some(StmtOutcome::Err(msg)) => StatementResult {
                index,
                sql,
                status: StatementStatus::Error,
                rows_affected: None,
                error: Some(msg),
            },
            None => StatementResult {
                index,
                sql,
                status: StatementStatus::Skipped,
                rows_affected: None,
                error: None,
            },
        })
        .collect();

    ExecResult {
        dry_run: false,
        used_transaction: opts.use_transaction,
        success: failed_index.is_none() && raw.error.is_none() && complete,
        rolled_back: raw.rolled_back,
        failed_index,
        error: raw.error,
        statements: results,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(tx: bool) -> ExecOptions {
        ExecOptions { dry_run: false, use_transaction: tx }
    }

    #[test]
    fn exec_options_default_is_safe() {
        let o: ExecOptions = serde_json::from_str("{}").unwrap();
        assert!(o.dry_run && o.use_transaction);
        let o: ExecOptions = serde_json::from_str(r#"{"dryRun":false}"#).unwrap();
        assert!(!o.dry_run && o.use_transaction);
    }

    #[test]
    fn rollback_marks_prior_statements_rolled_back() {
        let stmts = vec!["CREATE TABLE a (id int)".to_string(), "BAD".to_string(), "SELECT 1".to_string()];
        let raw = RawOutcome {
            outcomes: vec![StmtOutcome::Ok(0), StmtOutcome::Err("syntax".into())],
            error: None,
            rolled_back: true,
        };
        let r = build_result(DbKind::Postgres, stmts, &opts(true), raw, vec![]);
        assert!(!r.success && r.rolled_back);
        assert_eq!(r.failed_index, Some(1));
        assert_eq!(r.statements[0].status, StatementStatus::RolledBack);
        assert_eq!(r.statements[1].status, StatementStatus::Error);
        assert_eq!(r.statements[2].status, StatementStatus::Skipped);
    }

    #[test]
    fn mysql_ddl_is_not_reported_as_rolled_back() {
        let stmts = vec!["CREATE TABLE a (id int)".to_string(), "BAD".to_string()];
        let raw = RawOutcome {
            outcomes: vec![StmtOutcome::Ok(0), StmtOutcome::Err("syntax".into())],
            error: None,
            rolled_back: true,
        };
        let r = build_result(DbKind::MySql, stmts, &opts(true), raw, vec![]);
        assert_eq!(r.statements[0].status, StatementStatus::Ok);
        assert!(!r.warnings.is_empty());
    }

    #[test]
    fn mysql_ddl_in_transaction_warns_up_front() {
        let stmts = vec!["CREATE TABLE a (id int)".to_string()];
        assert!(!warnings(DbKind::MySql, &stmts, &opts(true)).is_empty());
        assert!(warnings(DbKind::Postgres, &stmts, &opts(true)).is_empty());
    }
}
