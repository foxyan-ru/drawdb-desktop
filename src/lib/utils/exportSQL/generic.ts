import type { Field, Table } from '$lib/data/constants';
import {
	exportFieldComment,
	parseDefault,
	uniqueConstraintClause,
	getFkColumnNames,
	type Diagram
} from './shared';

/**
 * Format a generic type string. No database-specific transformations.
 * Includes size in parentheses if provided.
 */
function genericType(field: Field): string {
	if (field.size !== undefined && field.size !== '' && field.size !== null) {
		return `${field.type}(${field.size})`;
	}
	return field.type;
}

/**
 * Format a single field definition for generic SQL.
 * No database-specific features: no UNSIGNED, no AUTO_INCREMENT, no COMMENT.
 */
function formatField(field: Field): string {
	const comment = exportFieldComment(field.comment);

	let def = `${comment}\t"${field.name}" ${genericType(field)}`;

	if (field.notNull) {
		def += ' NOT NULL';
	}
	if (field.unique) {
		def += ' UNIQUE';
	}

	const defaultVal = parseDefault(field);
	if (field.default !== '' && field.default !== undefined && field.default !== null) {
		def += ` DEFAULT ${defaultVal}`;
	}

	if (field.check && field.check !== '') {
		def += ` CHECK(${field.check})`;
	}

	return def;
}

/**
 * Generate a CREATE TABLE statement for a single table in generic SQL syntax.
 */
function formatTable(table: Table): string {
	const tableComment =
		table.comment && table.comment !== '' ? `/* ${table.comment} */\n` : '';

	const fields = table.fields.map(formatField).join(',\n');

	const primaryKeys = table.fields.filter((f) => f.primary);
	const pkClause =
		primaryKeys.length > 0
			? `,\n\tPRIMARY KEY(${primaryKeys.map((f) => `"${f.name}"`).join(', ')})`
			: '';

	const ucClause = uniqueConstraintClause(table, (s) => `"${s}"`);

	let sql = `${tableComment}CREATE TABLE IF NOT EXISTS "${table.name}" (\n${fields}${pkClause}${ucClause}\n);\n`;

	// Indices
	if (table.indices && table.indices.length > 0) {
		const indexStatements = table.indices
			.map(
				(idx) =>
					`CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX "${idx.name}"\nON "${table.name}" (${idx.fields.map((f) => `"${f}"`).join(', ')});`
			)
			.join('\n');
		sql += '\n' + indexStatements + '\n';
	}

	return sql;
}

/**
 * Generate a complete generic SQL export for the given diagram.
 * Uses standard SQL syntax without any database-specific features.
 * Foreign keys are expressed as ALTER TABLE statements.
 */
export function exportGenericSQL(diagram: Diagram): string {
	const tableStatements = diagram.tables.map(formatTable).join('\n');

	const fkStatements = diagram.relationships
		.map((r) => {
			const startTable = diagram.tables.find((t) => t.id === r.startTableId);
			const endTable = diagram.tables.find((t) => t.id === r.endTableId);
			if (!startTable || !endTable) return '';

			const { startColumns, endColumns } = getFkColumnNames(r, startTable, endTable);
			if (startColumns.some((c) => !c) || endColumns.some((c) => !c)) return '';

			return (
				`ALTER TABLE "${startTable.name}"\n` +
				`ADD FOREIGN KEY(${startColumns.map((c) => `"${c}"`).join(', ')}) ` +
				`REFERENCES "${endTable.name}"(${endColumns.map((c) => `"${c}"`).join(', ')})\n` +
				`ON UPDATE ${r.updateConstraint.toUpperCase()} ON DELETE ${r.deleteConstraint.toUpperCase()};`
			);
		})
		.filter(Boolean)
		.join('\n');

	return [tableStatements.trim(), fkStatements.trim()].filter(Boolean).join('\n\n') + '\n';
}
