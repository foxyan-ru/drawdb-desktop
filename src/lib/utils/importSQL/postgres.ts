import { nanoid } from 'nanoid';
import { DB, type Field } from '../../data/constants';
import {
	columnName,
	convertAST,
	makeTypeResolver,
	parseColumn,
	tableName,
	type AstNode,
	type DialectConfig,
	type ImportState,
	type ImportedDiagram,
	type ResolvedType
} from './shared';

// From drawdb-main/src/utils/importSQL/postgres.js:6-20 (unknown → BLOB), plus
// the SERIAL pseudo-types for GENERIC diagrams: web maps them to BLOB there,
// losing both the integer type and the implied auto-increment.
const resolve = makeTypeResolver({
	[DB.POSTGRES]: { INT: 'INTEGER' },
	[DB.GENERIC]: {
		INTEGER: 'INT',
		MEDIUMINT: 'INTEGER',
		BIT: 'BOOLEAN',
		'CHARACTER VARYING': 'VARCHAR',
		SMALLSERIAL: 'SMALLINT',
		SERIAL: 'INT',
		BIGSERIAL: 'BIGINT'
	}
});

const SERIAL_RE = /^(SMALL|BIG)?SERIAL[248]?$/i;

/** `mood` / `"mood"` / `public.mood` match a declared type named `mood`. */
function matchesName(dataType: string, name: string): boolean {
	const bare = dataType
		.trim()
		.replace(/^.*\./, '')
		.replace(/^"|"$/g, '');
	return bare.toLowerCase() === name.toLowerCase();
}

function objectName(n: AstNode): string {
	if (typeof n === 'string') return n;
	if (typeof n?.name === 'string') return n.name;
	return tableName(n);
}

/**
 * Type resolution order matches web postgres.js:45-58: declared composite
 * types, then enums, then the diagram DB's built-ins, then affinity.
 */
function resolveType(dataType: string, state: ImportState): ResolvedType {
	const raw = String(dataType ?? '');
	const custom =
		state.types.find((t) => matchesName(raw, t.name))?.name ?? state.enums.find((e) => matchesName(raw, e.name))?.name;
	if (custom) return { type: custom };
	return { type: resolve(raw, state.diagramDb), increment: SERIAL_RE.test(raw.trim()) };
}

function handleStatement(e: AstNode, state: ImportState, config: DialectConfig): boolean {
	// CREATE TYPE … AS ENUM / composite (web postgres.js:282-318)
	if (e.type === 'create' && e.keyword === 'type') {
		const name = objectName(e.name);
		if (e.resource === 'enum') {
			state.enums.push({
				id: nanoid(),
				name,
				values: (e.create_definitions?.value ?? []).map((v: AstNode) => v?.value)
			});
		} else if (Array.isArray(e.create_definitions)) {
			const fields: Field[] = e.create_definitions
				.filter((d: AstNode) => d?.resource === 'column')
				.map((d: AstNode) => {
					const f = parseColumn(d, state, config);
					// Composite type members carry no key/increment semantics.
					return { ...f, primary: false, unique: false, increment: false };
				});
			state.types.push({ id: nanoid(), name, fields, comment: '' });
		}
		return true;
	}

	// COMMENT ON TABLE / COLUMN (web postgres.js:401-418)
	if (e.type === 'comment') {
		const target = e.target ?? {};
		const text = String(e.expr?.expr?.value ?? e.expr?.value ?? '');
		const table = state.tables.find((t) => t.name === tableName(target.name));
		if (table && target.type === 'table') {
			table.comment = text;
		} else if (table && target.type === 'column') {
			const field = table.fields.find((f) => f.name === columnName(target.name?.column));
			if (field) field.comment = text;
		}
		return true;
	}

	return false;
}

/** PostgreSQL AST (node-sql-parser `database: 'postgresql'`) → diagram incl. enums/types. */
export function fromPostgres(ast: AstNode, diagramDb: string = DB.GENERIC): ImportedDiagram {
	return convertAST(ast, diagramDb, { db: DB.POSTGRES, resolveType, handleStatement });
}
