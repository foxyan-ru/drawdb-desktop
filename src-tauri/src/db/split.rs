//! Splits a multi-statement SQL script into individual statements so
//! `db_execute` can run and report on them one by one.
//!
//! Splits on top-level `;`, ignoring semicolons inside:
//! - single/double-quoted strings and backtick identifiers
//! - `-- line` and `/* block */` comments (plus `# line` comments for MySQL)
//! - Postgres dollar-quoted bodies (`$$ ... $$`, `$tag$ ... $tag$`)
//! - MySQL backslash escapes inside quoted strings
//!
//! Known limitation: it is not aware of `BEGIN ... END` compound bodies
//! (SQLite triggers, MySQL procedures/triggers, no `DELIMITER` support).
//! `exec::warnings` flags scripts that look like they contain those.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    Sqlite,
    Postgres,
    MySql,
}

fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// If a Postgres dollar-quote tag starts at `i` (`$$` or `$name$`), returns
/// its length including both `$`.
fn dollar_tag_len(chars: &[char], i: usize) -> Option<usize> {
    let n = chars.len();
    let mut j = i + 1;
    if j < n && chars[j] == '$' {
        return Some(2);
    }
    // Tag must not start with a digit (`$1` is a positional parameter).
    if j < n && (chars[j].is_alphabetic() || chars[j] == '_') {
        while j < n && is_ident_char(chars[j]) {
            j += 1;
        }
        if j < n && chars[j] == '$' {
            return Some(j - i + 1);
        }
    }
    None
}

fn starts_with_at(chars: &[char], i: usize, needle: &[char]) -> bool {
    i + needle.len() <= chars.len() && chars[i..i + needle.len()] == *needle
}

/// Returns trimmed statements without their trailing `;`. Statements that
/// contain only whitespace and/or comments are dropped.
pub fn split_statements(sql: &str, dialect: Dialect) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let n = chars.len();
    let mut out = Vec::new();
    let mut current = String::new();
    let mut has_code = false;
    let mut i = 0;

    while i < n {
        let c = chars[i];
        let next = chars.get(i + 1).copied();

        // Line comment.
        if (c == '-' && next == Some('-')) || (c == '#' && dialect == Dialect::MySql) {
            while i < n && chars[i] != '\n' {
                current.push(chars[i]);
                i += 1;
            }
            continue;
        }

        // Block comment.
        if c == '/' && next == Some('*') {
            current.push_str("/*");
            i += 2;
            while i < n && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                current.push(chars[i]);
                i += 1;
            }
            if i < n {
                current.push_str("*/");
                i += 2;
            }
            continue;
        }

        // Quoted string / identifier. Doubled quotes ('it''s') work naturally:
        // the first quote closes, the second immediately reopens.
        if c == '\'' || c == '"' || c == '`' {
            has_code = true;
            let quote = c;
            current.push(c);
            i += 1;
            while i < n {
                let ch = chars[i];
                if ch == '\\' && dialect == Dialect::MySql && quote != '`' {
                    current.push(ch);
                    i += 1;
                    if i < n {
                        current.push(chars[i]);
                        i += 1;
                    }
                    continue;
                }
                current.push(ch);
                i += 1;
                if ch == quote {
                    break;
                }
            }
            continue;
        }

        // Postgres dollar quoting (function bodies, DO blocks).
        if c == '$' && dialect == Dialect::Postgres && !(i > 0 && is_ident_char(chars[i - 1])) {
            if let Some(len) = dollar_tag_len(&chars, i) {
                has_code = true;
                let tag: Vec<char> = chars[i..i + len].to_vec();
                current.extend(tag.iter());
                i += len;
                while i < n {
                    if starts_with_at(&chars, i, &tag) {
                        current.extend(tag.iter());
                        i += len;
                        break;
                    }
                    current.push(chars[i]);
                    i += 1;
                }
                continue;
            }
        }

        if c == ';' {
            if has_code {
                out.push(current.trim().to_string());
            }
            current.clear();
            has_code = false;
            i += 1;
            continue;
        }

        if !c.is_whitespace() {
            has_code = true;
        }
        current.push(c);
        i += 1;
    }

    if has_code {
        out.push(current.trim().to_string());
    }
    out
}

/// First SQL keyword of a statement (uppercased), skipping leading
/// whitespace and comments. Empty string if none.
pub fn leading_keyword(stmt: &str) -> String {
    let mut rest = stmt;
    loop {
        rest = rest.trim_start();
        if rest.starts_with("--") || rest.starts_with('#') {
            rest = rest.find('\n').map(|p| &rest[p + 1..]).unwrap_or("");
        } else if rest.starts_with("/*") {
            rest = rest.find("*/").map(|p| &rest[p + 2..]).unwrap_or("");
        } else {
            break;
        }
    }
    rest.chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_simple_statements() {
        let s = split_statements("CREATE TABLE a (id int);\nCREATE TABLE b (id int);", Dialect::Sqlite);
        assert_eq!(s, vec!["CREATE TABLE a (id int)", "CREATE TABLE b (id int)"]);
    }

    #[test]
    fn keeps_last_statement_without_semicolon() {
        let s = split_statements("SELECT 1; SELECT 2", Dialect::Postgres);
        assert_eq!(s, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn ignores_semicolons_in_strings_and_identifiers() {
        let s = split_statements(
            "INSERT INTO t VALUES ('a;b', 'it''s;'); SELECT \"x;y\" FROM `t;u`;",
            Dialect::MySql,
        );
        assert_eq!(s.len(), 2);
        assert_eq!(s[0], "INSERT INTO t VALUES ('a;b', 'it''s;')");
    }

    #[test]
    fn ignores_semicolons_in_comments_and_drops_comment_only() {
        let s = split_statements(
            "-- header; comment\nCREATE TABLE a (id int); /* x; y */ ;\n-- trailing;",
            Dialect::Sqlite,
        );
        assert_eq!(s, vec!["-- header; comment\nCREATE TABLE a (id int)"]);
    }

    #[test]
    fn mysql_hash_comments_and_backslash_escapes() {
        let s = split_statements("# a; b\nSELECT 'a\\';b'; SELECT 2;", Dialect::MySql);
        assert_eq!(s, vec!["# a; b\nSELECT 'a\\';b'", "SELECT 2"]);
    }

    #[test]
    fn postgres_dollar_quotes() {
        let sql = "CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql; DO $$ BEGIN NULL; END $$;";
        let s = split_statements(sql, Dialect::Postgres);
        assert_eq!(s.len(), 2);
        assert!(s[0].ends_with("LANGUAGE sql"));
        assert_eq!(s[1], "DO $$ BEGIN NULL; END $$");
    }

    #[test]
    fn positional_params_are_not_dollar_quotes() {
        let s = split_statements("SELECT $1; SELECT 2;", Dialect::Postgres);
        assert_eq!(s, vec!["SELECT $1", "SELECT 2"]);
    }

    #[test]
    fn empty_input_yields_nothing() {
        assert!(split_statements("  ;; -- nothing\n", Dialect::Sqlite).is_empty());
    }

    #[test]
    fn leading_keyword_skips_comments() {
        assert_eq!(leading_keyword("  -- c\n/* d */ create table x"), "CREATE");
        assert_eq!(leading_keyword("# c\nALTER TABLE x"), "ALTER");
        assert_eq!(leading_keyword(""), "");
    }
}
