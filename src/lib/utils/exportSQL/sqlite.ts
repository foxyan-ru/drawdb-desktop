import { DB, type Field, type Table } from '../../data/constants';
import {
	escapeQuotes,
	exportFieldComment,
	getTypeInfo,
	parseDefault,
	shouldEmitCheck,
	uniqueConstraintClause,
	getInlineForeignKeys,
	type Diagram
} from './shared';
import { appendViews } from '../views';

/**
 * Map a field type to a SQLite type.
 * Types from the SQLite diagram type list (INTEGER, TEXT, BOOLEAN, DATETIME, …)
 * are emitted verbatim like the web original
 * (drawdb-main/src/utils/exportSQL/sqlite.js:22); types carried over from other
 * dialects collapse to SQLite's storage classes: INTEGER, REAL, TEXT, BLOB.
 */
function sqliteType(field: Field): string {
	if (getTypeInfo(DB.SQLITE, field.type)) {
		return field.type;
	}

	switch (field.type.toUpperCase()) {
		case 'INT':
		case 'INTEGER':
		case 'SMALLINT':
		case 'BIGINT':
		case 'BOOLEAN':
			return 'INTEGER';
		case 'DECIMAL':
		case 'NUMERIC':
		case 'FLOAT':
		case 'DOUBLE':
		case 'REAL':
			return 'REAL';
		case 'CHAR':
		case 'VARCHAR':
		case 'UUID':
		case 'TEXT':
		case 'DATE':
		case 'TIME':
		case 'TIMESTAMP':
		case 'DATETIME':
		case 'BINARY':
		case 'VARBINARY':
		case 'JSON':
			return 'TEXT';
		case 'ENUM':
			if (field.values && field.values.length > 0) {
				return `TEXT CHECK("${field.name}" IN (${field.values.map((v) => `'${escapeQuotes(String(v))}'`).join(', ')}))`;
			}
			return 'TEXT';
		case 'SET':
			return 'TEXT';
		case 'BLOB':
			return 'BLOB';
		default:
			return 'BLOB';
	}
}

/**
 * Format a single field definition for SQLite.
 */
function formatField(field: Field): string {
	const comment = exportFieldComment(field.comment);
	const typeStr = sqliteType(field);

	// ENUM type already includes CHECK constraint in the type string.
	const isEnumType = field.type.toUpperCase() === 'ENUM';

	let def = `${comment}\t"${field.name}" ${typeStr}`;

	if (field.notNull) {
		def += ' NOT NULL';
	}
	if (field.unique) {
		def += ' UNIQUE';
	}

	const defaultVal = parseDefault(field, DB.SQLITE);
	if (field.default !== '' && field.default !== undefined && field.default !== null) {
		def += ` DEFAULT ${defaultVal}`;
	}

	if (!isEnumType && shouldEmitCheck(field, DB.SQLITE)) {
		def += ` CHECK(${field.check})`;
	}

	return def;
}

/**
 * Generate a CREATE TABLE statement for a single table in SQLite syntax.
 * Foreign keys are included inline within the CREATE TABLE statement
 * since SQLite does not support ALTER TABLE ADD FOREIGN KEY.
 */
function formatTable(table: Table, diagram: Diagram): string {
	const tableComment =
		table.comment && table.comment !== '' ? `/* ${table.comment} */\n` : '';

	const fields = table.fields.map(formatField).join(',\n');

	const primaryKeys = table.fields.filter((f) => f.primary);
	const pkClause =
		primaryKeys.length > 0
			? `,\n\tPRIMARY KEY(${primaryKeys.map((f) => `"${f.name}"`).join(', ')})`
			: '';

	const inlineFK = getInlineForeignKeys(table, diagram, (s) => `"${s}"`);
	const fkClause = inlineFK !== '' ? `,\n${inlineFK}` : '';

	const ucClause = uniqueConstraintClause(table, (s) => `"${s}"`);

	let sql = `${tableComment}CREATE TABLE IF NOT EXISTS "${table.name}" (\n${fields}${pkClause}${fkClause}${ucClause}\n);\n`;

	// Indices
	if (table.indices && table.indices.length > 0) {
		const indexStatements = table.indices
			.map(
				(idx) =>
					`CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${idx.name}"\nON "${table.name}" (${idx.fields.map((f) => `"${f}"`).join(', ')});`
			)
			.join('\n');
		sql += '\n' + indexStatements + '\n';
	}

	return sql;
}

/**
 * Generate a complete SQLite SQL export for the given diagram.
 * Foreign keys are defined inline within each CREATE TABLE statement.
 */
export function exportSQLite(diagram: Diagram): string {
	const sql = diagram.tables.map((t) => formatTable(t, diagram)).join('\n');
	// Web utils/views.js:268-273 appends CREATE VIEW statements after the tables.
	return appendViews(sql, diagram, DB.SQLITE);
}
