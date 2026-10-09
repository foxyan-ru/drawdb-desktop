// WHY relative imports: `bun test` does not resolve the SvelteKit `$lib` alias,
// so modules covered by unit tests import siblings relatively (see connections.ts).
import type { Table, Field, Relationship, EnumType, CustomType } from '../../data/constants';
import { dbToTypes, type DataTypeInfo } from '../../data/datatypes';

export interface Diagram {
	tables: Table[];
	relationships: Relationship[];
	// Optional so callers that only hold tables/relationships (e.g. the DB-client
	// migrate preview) still type-check; only the Postgres exporter consumes them,
	// matching drawdb-main/src/utils/exportSQL/postgres.js:12-32.
	enums?: EnumType[];
	types?: CustomType[];
	database?: string;
}

/**
 * Look up the datatype metadata (hasCheck/isSized/hasQuotes/…) for a field type
 * in the given dialect. Returns undefined for types the dialect does not list
 * (custom/enum type names, or types carried over from another dialect) so
 * callers can fall back to permissive behavior instead of crashing like the web
 * original does on unknown types.
 */
export function getTypeInfo(database: string, type: string): DataTypeInfo | undefined {
	return dbToTypes[database]?.[type];
}

/**
 * Escape single quotes in a string by doubling them.
 */
export function escapeQuotes(str: string): string {
	return str.replace(/'/g, "''");
}

/**
 * Determine whether a string looks like a SQL function call, e.g. NOW() or CURRENT_TIMESTAMP().
 */
export function isFunction(str: string): boolean {
	return /\w+\([^)]*\)$/.test(str);
}

const SQL_KEYWORDS = [
	'CURRENT_TIMESTAMP',
	'CURRENT_DATE',
	'CURRENT_TIME',
	'NULL',
	'TRUE',
	'FALSE',
	'LOCALTIME',
	'LOCALTIMESTAMP'
];

/**
 * Determine whether a string is a recognized SQL keyword that should not be quoted.
 */
export function isKeyword(str: string): boolean {
	if (typeof str !== 'string') return false;
	return SQL_KEYWORDS.includes(str.toUpperCase());
}

/**
 * Format a field's DEFAULT value for SQL output.
 * SQL functions and keywords are emitted bare; string values are single-quoted.
 * When `database` is given and the type is known to that dialect, the type's
 * `hasQuotes` flag decides quoting (drawdb-main/src/utils/exportSQL/shared.js:17-32),
 * so e.g. VARCHAR DEFAULT '123' stays quoted. Unknown types fall back to emitting
 * purely numeric values bare.
 */
export function parseDefault(field: Field, database?: string): string {
	const val = field.default;
	if (val === '' || val === undefined || val === null) return '';

	const str = String(val);

	if (isFunction(str) || isKeyword(str)) {
		return str;
	}

	const typeInfo = database ? getTypeInfo(database, field.type) : undefined;
	if (typeInfo) {
		return typeInfo.hasQuotes ? `'${escapeQuotes(str)}'` : str;
	}

	// If the value is purely numeric, emit it without quotes.
	if (/^-?\d+(\.\d+)?$/.test(str)) {
		return str;
	}

	return `'${escapeQuotes(str)}'`;
}

/**
 * Whether a field's CHECK expression should be emitted. The web original only
 * emits CHECK for types flagged `hasCheck` (e.g. drawdb-main/src/utils/exportSQL/
 * mysql.js:47-50); types unknown to the dialect keep their CHECK so nothing the
 * user wrote is silently dropped.
 */
export function shouldEmitCheck(field: Field, database: string): boolean {
	if (!field.check || field.check === '') return false;
	const typeInfo = getTypeInfo(database, field.type);
	return typeInfo ? typeInfo.hasCheck : true;
}

/**
 * Format field comments as SQL line comments preceding the field definition.
 */
export function exportFieldComment(comment: string): string {
	if (!comment || comment === '') return '';
	return comment
		.split('\n')
		.map((line) => `\t-- ${line}\n`)
		.join('');
}

/**
 * Build a UNIQUE constraint clause for a table's composite unique constraints.
 * The `quote` function wraps identifiers in the appropriate quoting style.
 */
export function uniqueConstraintClause(
	table: Table,
	quote: (s: string) => string
): string {
	const constraints = (table.uniqueConstraints || []).filter(
		(uc) => Array.isArray(uc.fields) && uc.fields.length > 0
	);
	if (constraints.length === 0) return '';

	return (
		',\n' +
		constraints
			.map(
				(uc) =>
					`\tCONSTRAINT ${quote(uc.name)} UNIQUE (${uc.fields.map((f) => quote(f)).join(', ')})`
			)
			.join(',\n')
	);
}

/**
 * Resolve the field pairs for a relationship (supports both simple and composite FKs).
 */
export function getRelationshipFields(
	relationship: Relationship
): { startFieldId: string; endFieldId: string }[] {
	if (Array.isArray(relationship.fields) && relationship.fields.length > 0) {
		return relationship.fields;
	}
	return [
		{
			startFieldId: relationship.startFieldId,
			endFieldId: relationship.endFieldId
		}
	];
}

/**
 * Get the column names for both sides of a foreign key relationship.
 */
export function getFkColumnNames(
	relationship: Relationship,
	startTable: Table | { fields: Field[] },
	endTable: Table | { fields: Field[] }
): { startColumns: string[]; endColumns: string[] } {
	const pairs = getRelationshipFields(relationship);
	const startColumns = pairs.map(
		(p) => startTable.fields.find((f) => f.id === p.startFieldId)?.name ?? ''
	);
	const endColumns = pairs.map(
		(p) => endTable.fields.find((f) => f.id === p.endFieldId)?.name ?? ''
	);
	return { startColumns, endColumns };
}

/**
 * Build inline FOREIGN KEY constraints for SQLite (which does not support ALTER TABLE ADD FK).
 */
export function getInlineForeignKeys(
	table: Table,
	diagram: Diagram,
	quote: (s: string) => string
): string {
	const fks: string[] = [];
	for (const r of diagram.relationships) {
		if (r.startTableId === table.id) {
			const endTable = diagram.tables.find((t) => t.id === r.endTableId);
			if (!endTable) continue;

			const { startColumns, endColumns } = getFkColumnNames(r, table, endTable);
			if (startColumns.some((c) => !c) || endColumns.some((c) => !c)) continue;

			fks.push(
				`\tFOREIGN KEY (${startColumns.map(quote).join(', ')}) REFERENCES ${quote(endTable.name)}(${endColumns.map(quote).join(', ')})\n` +
					`\tON UPDATE ${r.updateConstraint.toUpperCase()} ON DELETE ${r.deleteConstraint.toUpperCase()}`
			);
		}
	}
	return fks.join(',\n');
}
