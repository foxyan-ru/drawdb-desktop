//! Engine-neutral helpers shared by the per-engine introspection code.
//! Every engine module only issues read queries (SELECT / read-only PRAGMA
//! table-valued functions); nothing here mutates the database.

use super::types::{ColumnInfo, TableInfo};

pub(crate) fn new_table(schema: Option<String>, name: String, comment: Option<String>) -> TableInfo {
    TableInfo {
        schema,
        name,
        comment: comment.filter(|c| !c.trim().is_empty()),
        columns: Vec::new(),
        primary_key: Vec::new(),
        foreign_keys: Vec::new(),
        indexes: Vec::new(),
    }
}

pub(crate) fn new_column(
    name: String,
    data_type: String,
    nullable: bool,
    auto_increment: bool,
    default_value: Option<String>,
    comment: Option<String>,
) -> ColumnInfo {
    ColumnInfo {
        name,
        data_type,
        nullable,
        is_primary_key: false,
        is_unique: false,
        auto_increment,
        default_value,
        comment: comment.filter(|c| !c.trim().is_empty()),
    }
}

/// Derives per-column flags from the table-level key/index lists once all
/// of a table's metadata has been collected.
pub(crate) fn finalize(tables: &mut [TableInfo]) {
    for t in tables.iter_mut() {
        let pk = t.primary_key.clone();
        let unique_singles: Vec<String> = t
            .indexes
            .iter()
            .filter(|ix| ix.unique && ix.columns.len() == 1)
            .map(|ix| ix.columns[0].clone())
            .collect();
        for col in t.columns.iter_mut() {
            col.is_primary_key = pk.iter().any(|k| k == &col.name);
            col.is_unique = unique_singles.iter().any(|u| u == &col.name);
        }
    }
}

/// Normalizes FK referential actions to the SQL keyword form used by
/// `REFERENCES ... ON UPDATE <action>`.
pub(crate) fn normalize_action(action: Option<String>) -> Option<String> {
    action
        .map(|a| a.trim().to_ascii_uppercase())
        .filter(|a| !a.is_empty())
}

/// Postgres stores referential actions as single-letter codes
/// (`pg_constraint.confupdtype` / `confdeltype`).
pub(crate) fn pg_action(code: Option<String>) -> Option<String> {
    let action = match code.as_deref().map(str::trim) {
        Some("a") => "NO ACTION",
        Some("r") => "RESTRICT",
        Some("c") => "CASCADE",
        Some("n") => "SET NULL",
        Some("d") => "SET DEFAULT",
        _ => return None,
    };
    Some(action.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::types::IndexInfo;

    #[test]
    fn finalize_sets_pk_and_unique_flags() {
        let mut t = new_table(None, "users".into(), None);
        t.columns.push(new_column("id".into(), "integer".into(), false, true, None, None));
        t.columns.push(new_column("email".into(), "text".into(), false, false, None, None));
        t.columns.push(new_column("a".into(), "text".into(), true, false, None, None));
        t.primary_key = vec!["id".into()];
        t.indexes.push(IndexInfo { name: "u_email".into(), columns: vec!["email".into()], unique: true });
        t.indexes.push(IndexInfo { name: "u_multi".into(), columns: vec!["a".into(), "email".into()], unique: true });
        let mut tables = vec![t];
        finalize(&mut tables);
        let cols = &tables[0].columns;
        assert!(cols[0].is_primary_key && !cols[0].is_unique);
        assert!(!cols[1].is_primary_key && cols[1].is_unique);
        assert!(!cols[2].is_unique);
    }

    #[test]
    fn pg_action_codes() {
        assert_eq!(pg_action(Some("c".into())).as_deref(), Some("CASCADE"));
        assert_eq!(pg_action(Some(" ".into())), None);
        assert_eq!(normalize_action(Some("set null".into())).as_deref(), Some("SET NULL"));
    }
}
