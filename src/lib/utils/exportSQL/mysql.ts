import { DB, type Field, type Table } from '../../data/constants';
import {
	escapeQuotes,
	getTypeInfo,
	parseDefault,
	shouldEmitCheck,
	uniqueConstraintClause,
	getFkColumnNames,
	type Diagram
} from './shared';

/**
 * Format a MySQL type string, including size, ENUM/SET values, etc.
 * Size is only appended for sized/precision types, as in
 * drawdb-main/src/utils/exportSQL/mysql.js:12-27; types unknown to the MySQL
 * list keep any size the user gave.
 */
function formatType(field: Field): string {
	let result = field.type;

	if (field.type === 'SET' || field.type === 'ENUM') {
		if (field.values && field.values.length > 0) {
			result += `(${field.values.map((v) => `'${escapeQuotes(String(v))}'`).join(', ')})`;
		}
	} else if (field.size !== undefined && field.size !== '' && field.size !== null) {
		const info = getTypeInfo(DB.MYSQL, field.type);
		if (!info || info.isSized || info.hasPrecision) {
			result += `(${field.size})`;
		}
	}

	return result;
}

/**
 * Format a single field definition for MySQL.
 */
function formatField(field: Field): string {
	let def = `\t\`${field.name}\` ${formatType(field)}`;

	// WHY: UNSIGNED only applies to signed numeric types (drawdb-main mysql.js:37-39).
	const info = getTypeInfo(DB.MYSQL, field.type);
	if (field.unsigned && (!info || info.signed)) {
		def += ' UNSIGNED';
	}
	if (field.notNull) {
		def += ' NOT NULL';
	}
	if (field.increment) {
		def += ' AUTO_INCREMENT';
	}
	if (field.unique) {
		def += ' UNIQUE';
	}

	const defaultVal = parseDefault(field, DB.MYSQL);
	if (field.default !== '' && field.default !== undefined && field.default !== null) {
		def += ` DEFAULT ${defaultVal}`;
	}

	if (shouldEmitCheck(field, DB.MYSQL)) {
		def += ` CHECK(${field.check})`;
	}

	if (field.comment && field.comment !== '') {
		def += ` COMMENT '${escapeQuotes(field.comment)}'`;
	}

	return def;
}

/**
 * Generate a CREATE TABLE statement for a single table in MySQL syntax.
 */
function formatTable(table: Table): string {
	const fields = table.fields.map(formatField).join(',\n');

	const primaryKeys = table.fields.filter((f) => f.primary);
	const pkClause =
		primaryKeys.length > 0
			? `,\n\tPRIMARY KEY(${primaryKeys.map((f) => `\`${f.name}\``).join(', ')})`
			: '';

	const ucClause = uniqueConstraintClause(table, (s) => `\`${s}\``);

	const tableComment =
		table.comment && table.comment !== ''
			? ` COMMENT='${escapeQuotes(table.comment)}'`
			: '';

	let sql = `CREATE TABLE IF NOT EXISTS \`${table.name}\` (\n${fields}${pkClause}${ucClause}\n)${tableComment};\n`;

	// Indices
	if (table.indices && table.indices.length > 0) {
		const indexStatements = table.indices
			.map(
				(idx) =>
					`CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX \`${idx.name}\`\nON \`${table.name}\` (${idx.fields.map((f) => `\`${f}\``).join(', ')});`
			)
			.join('\n');
		sql += '\n' + indexStatements + '\n';
	}

	return sql;
}

/**
 * Generate a complete MySQL SQL export for the given diagram.
 * Includes CREATE TABLE statements, indices, and ALTER TABLE ADD FOREIGN KEY statements.
 */
export function exportMySQL(diagram: Diagram): string {
	const tableStatements = diagram.tables.map(formatTable).join('\n');

	const fkStatements = diagram.relationships
		.map((r) => {
			const startTable = diagram.tables.find((t) => t.id === r.startTableId);
			const endTable = diagram.tables.find((t) => t.id === r.endTableId);
			if (!startTable || !endTable) return '';

			const { startColumns, endColumns } = getFkColumnNames(r, startTable, endTable);
			if (startColumns.some((c) => !c) || endColumns.some((c) => !c)) return '';

			return (
				`ALTER TABLE \`${startTable.name}\`\n` +
				`ADD FOREIGN KEY(${startColumns.map((c) => `\`${c}\``).join(', ')}) ` +
				`REFERENCES \`${endTable.name}\`(${endColumns.map((c) => `\`${c}\``).join(', ')})\n` +
				`ON UPDATE ${r.updateConstraint.toUpperCase()} ON DELETE ${r.deleteConstraint.toUpperCase()};`
			);
		})
		.filter(Boolean)
		.join('\n');

	return [tableStatements.trim(), fkStatements.trim()].filter(Boolean).join('\n\n') + '\n';
}
