import { nanoid } from 'nanoid';
// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import {
	Cardinality,
	Constraint,
	DB,
	defaultBlue,
	type CustomType,
	type EnumType,
	type Field,
	type Relationship,
	type Table
} from '../../data/constants';
import { dbToTypes } from '../../data/datatypes';

/*
 * Shared core of the SQL importers (port of drawdb-main/src/utils/importSQL/*.js).
 *
 * The web app has one ~240-430 line file per dialect, and they are ~90%
 * identical (same CREATE TABLE / CREATE INDEX / ALTER TABLE walk, differing in
 * type affinity tables and a few AST shape details). Here that walk lives once,
 * in `convertAST`, and each dialect file supplies a `DialectConfig` (its type
 * affinity + optional extra statement handlers, e.g. Postgres CREATE TYPE).
 *
 * The AST comes from `node-sql-parser`, whose published typings don't model the
 * per-dialect shapes the web code relies on (e.g. Postgres wraps column names
 * as `{ expr: { value } }`), so nodes are typed `any` and read defensively.
 */

export type AstNode = any;

export interface ImportedDiagram {
	tables: Table[];
	relationships: Relationship[];
	types: CustomType[];
	enums: EnumType[];
}

/** Mutable state threaded through one conversion run. */
export interface ImportState extends ImportedDiagram {
	/** Dialect of the diagram receiving the import (`database` store value). */
	diagramDb: string;
}

export interface ResolvedType {
	type: string;
	/** Pseudo-types such as Postgres SERIAL imply auto-increment. */
	increment?: boolean;
}

export interface DialectConfig {
	/** Source SQL dialect (controls identifier quoting in rebuilt CHECK expressions). */
	db: string;
	/** Maps a parser `dataType` onto a type name valid for `state.diagramDb`. */
	resolveType: (dataType: string, state: ImportState) => ResolvedType;
	/** Handles dialect-only statements; return true when the statement was consumed. */
	handleStatement?: (e: AstNode, state: ImportState, config: DialectConfig) => boolean;
}

/** Per-diagram-DB fallback tables (web `affinity` Proxies, which default to BLOB/TEXT). */
export type AffinityTable = Record<string, Record<string, string>>;

/**
 * Builds the standard resolver used by every dialect file: keep the type when
 * the diagram DB knows it, otherwise map it through the affinity table, with
 * `fallback` (web Proxy default) for anything unknown. Mirrors e.g.
 * drawdb-main/src/utils/importSQL/mysql.js:44-48.
 */
export function makeTypeResolver(affinity: AffinityTable, fallback = 'BLOB') {
	return (dataType: string, diagramDb: string): string => {
		const upper = String(dataType ?? '')
			.trim()
			.toUpperCase();
		if (dbToTypes[diagramDb]?.[upper]) return upper;
		return affinity[diagramDb]?.[upper] ?? fallback;
	};
}

// ---------------------------------------------------------------------------
// AST accessors (tolerant of the shape differences between dialects/versions)
// ---------------------------------------------------------------------------

/**
 * Column name from any of the shapes node-sql-parser emits:
 * `'id'`, `{ column: 'id' }` (MySQL), `{ column: { expr: { value: 'id' } } }`
 * (Postgres, web postgres.js:43), or a bare `{ expr: { value } }`.
 */
export function columnName(c: AstNode): string {
	if (c === null || c === undefined) return '';
	if (typeof c === 'string') return c;
	if (typeof c !== 'object') return String(c);
	if (c.column !== undefined) return columnName(c.column);
	if (c.expr !== undefined) return columnName(c.expr);
	if (c.value !== undefined) return columnName(c.value);
	return '';
}

/** Table name from `[{ table }]` (CREATE/ALTER), `{ table }` (CREATE INDEX) or a string. */
export function tableName(t: AstNode): string {
	if (t === null || t === undefined) return '';
	if (typeof t === 'string') return t;
	if (Array.isArray(t)) return tableName(t[0]);
	if (typeof t.table === 'string') return t.table;
	if (t.table !== undefined) return tableName(t.table);
	if (typeof t.name === 'string') return t.name;
	return '';
}

/** Function name: a string in older parser versions, `{ name: [{ value }] }` in 5.x. */
export function functionName(fn: AstNode): string {
	const n = fn?.name;
	if (typeof n === 'string') return n;
	if (Array.isArray(n?.name)) return n.name.map((p: AstNode) => p?.value ?? '').join('.');
	if (typeof n?.name === 'string') return n.name;
	return '';
}

export function findReferencedTable(tables: Table[], currentTable: Table, name: string): Table | undefined {
	if (currentTable.name === name) return currentTable;
	return (
		tables.find((t) => t.name === name) ??
		// Case-insensitive fallback: identifier case is often inconsistent in dumps.
		tables.find((t) => t.name.toLowerCase() === name.toLowerCase())
	);
}

function quoteColumn(str: string, db: string): string {
	switch (db) {
		case DB.MYSQL:
		case DB.MARIADB:
			return `\`${str}\``;
		case DB.MSSQL:
			return `[${str}]`;
		default:
			return `"${str}"`;
	}
}

function literal(v: AstNode): string {
	if (v?.type === 'single_quote_string' || v?.type === 'double_quote_string') return `'${v.value}'`;
	if (v?.type === 'column_ref') return `\`${columnName(v)}\``;
	return String(v?.value ?? '');
}

/** Rebuilds SQL text for a CHECK expression (port of web importSQL/shared.js:24). */
export function buildSQLFromAST(ast: AstNode, db: string = DB.MYSQL): string {
	if (!ast) return '';
	if (ast.type === 'binary_expr') {
		return `${buildSQLFromAST(ast.left, db)} ${ast.operator} ${buildSQLFromAST(ast.right, db)}`;
	}
	if (ast.type === 'function') {
		let expr = functionName(ast);
		if (ast.args) expr += '(' + (ast.args.value ?? []).map(literal).join(', ') + ')';
		return expr;
	}
	if (ast.type === 'column_ref') return quoteColumn(columnName(ast), db);
	if (ast.type === 'expr_list') return (ast.value ?? []).map((v: AstNode) => v?.value).join(' AND ');
	return typeof ast.value === 'string' ? `'${ast.value}'` : String(ast.value ?? '');
}

/** `DEFAULT …` → Field.default text (web mysql.js:62-88 + postgres.js cast/array cases). */
export function parseDefault(defaultVal: AstNode): string {
	const v = defaultVal?.value;
	if (v === null || v === undefined) return '';
	if (v.type === 'function') {
		let out = functionName(v);
		if (v.args) {
			out +=
				'(' +
				(v.args.value ?? [])
					.map((a: AstNode) =>
						a?.type === 'single_quote_string' || a?.type === 'double_quote_string' ? `'${a.value}'` : a?.value
					)
					.join(', ') +
				')';
		}
		return out;
	}
	if (v.type === 'null') return 'NULL';
	if (v.type === 'cast') return String(v.expr?.value ?? '');
	if (v.type === 'array') {
		return `ARRAY[${(v.expr_list?.value ?? []).map((x: AstNode) => x?.value ?? x?.expr?.value).join(', ')}]`;
	}
	if (v.value !== undefined && v.value !== null) return v.value.toString();
	// Unknown expression shape: rebuild what we can rather than throwing.
	return buildSQLFromAST(v);
}

/** `length`/`scale` → Field.size (number, or "p,s" for DECIMAL(p,s)). */
export function parseSize(definition: AstNode): number | string | undefined {
	const len = definition?.length;
	if (!len) return undefined;
	return definition.scale ? `${len},${definition.scale}` : len;
}

/** `'set null'` / `'CASCADE'` → the `Constraint` labels ('Set null', 'Cascade'). */
function constraintLabel(raw: AstNode): string {
	const s = String(raw ?? '').toLowerCase();
	if (!s) return Constraint.NONE;
	return s[0].toUpperCase() + s.substring(1);
}

function parseOnActions(referenceDefinition: AstNode): { updateConstraint: string; deleteConstraint: string } {
	let updateConstraint: string = Constraint.NONE;
	let deleteConstraint: string = Constraint.NONE;
	for (const c of referenceDefinition?.on_action ?? []) {
		const value = c?.value?.value ?? c?.value;
		if (c?.type === 'on update') updateConstraint = constraintLabel(value);
		else if (c?.type === 'on delete') deleteConstraint = constraintLabel(value);
	}
	return { updateConstraint, deleteConstraint };
}

function isUnsigned(definition: AstNode): boolean {
	const suffix = definition?.suffix;
	const parts: AstNode[] = Array.isArray(suffix) ? suffix : suffix ? [suffix] : [];
	return parts.some((p) => /unsigned/i.test(typeof p === 'string' ? p : String(p?.value ?? '')));
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function emptyTable(name: string): Table {
	return {
		id: nanoid(),
		name,
		x: 0,
		y: 0,
		fields: [],
		comment: '',
		indices: [],
		uniqueConstraints: [],
		color: defaultBlue,
		collapsed: false,
		locked: false
	};
}

/** A CREATE TABLE / CREATE TYPE column definition → Field. */
export function parseColumn(d: AstNode, state: ImportState, config: DialectConfig): Field {
	const resolved = config.resolveType(d.definition?.dataType ?? '', state);
	const field: Field = {
		id: nanoid(),
		name: columnName(d.column),
		type: resolved.type,
		default: d.default_val ? parseDefault(d.default_val) : '',
		check: d.check?.definition?.[0] ? buildSQLFromAST(d.check.definition[0], config.db) : '',
		primary: !!d.primary_key,
		unique: !!d.unique,
		// WHY: web sets notNull for any truthy `nullable` (mysql.js:59), but an
		// explicit `NULL` also produces `{ type: 'null' }`; only NOT NULL counts.
		notNull: !!d.nullable && d.nullable.type !== 'null',
		increment: !!d.auto_increment || !!resolved.increment,
		comment: d.comment?.value?.value ?? (typeof d.comment?.value === 'string' ? d.comment.value : '')
	};
	if (d.definition?.expr?.type === 'expr_list') {
		field.values = (d.definition.expr.value ?? []).map((v: AstNode) => v?.value);
	}
	const size = parseSize(d.definition);
	if (size !== undefined) field.size = size;
	if (isUnsigned(d.definition)) field.unsigned = true;
	return field;
}

/**
 * Adds a relationship from `startTable.startFieldNames` to the table/columns in
 * `referenceDefinition` (port of web sqlite.js:44 `addRelationshipFromReferenceDef`,
 * which the other dialect files repeat inline). Composite FKs keep every column
 * pair in `fields`; unresolvable references are skipped, as on web.
 */
export function addRelationshipFromReference(
	state: ImportState,
	startTable: Table,
	startFieldNames: string[],
	referenceDefinition: AstNode
): void {
	if (!referenceDefinition || startFieldNames.length === 0) return;
	const endTableName = tableName(referenceDefinition.table);
	const endFieldNames: string[] = (referenceDefinition.definition ?? []).map(columnName);

	const endTable = findReferencedTable(state.tables, startTable, endTableName);
	if (!endTable) return;

	const fieldPairs: { startFieldId: string; endFieldId: string }[] = [];
	for (let i = 0; i < startFieldNames.length; i++) {
		const sf = startTable.fields.find((f) => f.name === startFieldNames[i]);
		const ef = endTable.fields.find((f) => f.name === endFieldNames[i]);
		if (!sf || !ef) break;
		fieldPairs.push({ startFieldId: sf.id, endFieldId: ef.id });
	}
	if (fieldPairs.length === 0 || fieldPairs.length !== startFieldNames.length) return;

	const startField = startTable.fields.find((f) => f.id === fieldPairs[0].startFieldId)!;
	const { updateConstraint, deleteConstraint } = parseOnActions(referenceDefinition);

	state.relationships.push({
		id: nanoid(),
		// Naming mirrors web mysql.js:145.
		name: `fk_${startTable.name}_${startFieldNames[0]}_${endTable.name}`,
		startTableId: startTable.id,
		startFieldId: fieldPairs[0].startFieldId,
		endTableId: endTable.id,
		endFieldId: fieldPairs[0].endFieldId,
		fields: fieldPairs,
		updateConstraint,
		deleteConstraint,
		// web mysql.js:172 — a unique FK column means one-to-one.
		cardinality: startField.unique ? Cardinality.ONE_TO_ONE : Cardinality.MANY_TO_ONE
	});
}

function reindex<T extends { id?: number }>(list: T[]) {
	list.forEach((item, i) => {
		item.id = i;
	});
}

function createTable(e: AstNode, state: ImportState, config: DialectConfig) {
	const table = emptyTable(tableName(e.table));

	for (const d of e.create_definitions ?? []) {
		if (d?.resource === 'column') {
			const field = parseColumn(d, state, config);
			table.fields.push(field);
			// Inline `col INT REFERENCES t(id)`: web handles this for SQLite and
			// Postgres only (sqlite.js:177, postgres.js:212); applied to all here.
			if (d.reference_definition) {
				addRelationshipFromReference(state, table, [field.name], d.reference_definition);
			}
		} else if (d?.resource === 'constraint') {
			const kind = String(d.constraint_type ?? '').toLowerCase();
			const cols: string[] = (d.definition ?? []).map(columnName);
			if (kind === 'primary key') {
				for (const f of table.fields) if (cols.includes(f.name)) f.primary = true;
			} else if (kind === 'foreign key') {
				addRelationshipFromReference(state, table, cols, d.reference_definition);
			} else if (kind.includes('unique')) {
				table.uniqueConstraints.push({
					name: d.constraint || d.index || `${table.name}_unique_${table.uniqueConstraints.length}`,
					fields: cols
				});
			}
		} else if (d?.resource === 'index') {
			// MySQL `KEY idx (a, b)` inside CREATE TABLE (mysqldump output). Web
			// ignores these; kept here so dumps don't silently lose their indexes.
			const fields: string[] = (d.definition ?? []).map(columnName).filter(Boolean);
			if (fields.length) {
				table.indices.push({ name: d.index || `${table.name}_index_${table.indices.length}`, unique: false, fields });
				reindex(table.indices);
			}
		}
	}

	for (const opt of e.table_options ?? []) {
		if (String(opt?.keyword ?? '').toLowerCase() === 'comment' && typeof opt.value === 'string') {
			table.comment = opt.value.replace(/^["']|["']$/g, '');
		}
	}

	state.tables.push(table);
}

function createIndex(e: AstNode, state: ImportState) {
	const name = tableName(e.table);
	const table = state.tables.find((t) => t.name === name);
	if (!table) return;
	table.indices.push({
		name: typeof e.index === 'string' ? e.index : columnName(e.index),
		unique: String(e.index_type ?? '').toLowerCase() === 'unique',
		fields: (e.index_columns ?? []).map(columnName)
	});
	reindex(table.indices);
}

function alterTable(e: AstNode, state: ImportState) {
	if (!Array.isArray(e.expr)) return;
	const startTable = state.tables.find((t) => t.name === tableName(e.table));
	for (const expr of e.expr) {
		const def = expr?.create_definitions;
		if (
			expr?.action === 'add' &&
			String(def?.constraint_type ?? '').toLowerCase() === 'foreign key' &&
			startTable
		) {
			addRelationshipFromReference(state, startTable, (def.definition ?? []).map(columnName), def.reference_definition);
		}
	}
}

/**
 * Visits every statement: plain arrays, single statements, and T-SQL `GO`
 * batches (`{ ast, go_next }` chains — web mssql.js:303).
 */
export function forEachStatement(ast: AstNode, fn: (e: AstNode) => void) {
	if (Array.isArray(ast)) {
		ast.forEach((e) => forEachStatement(e, fn));
	} else if (ast && typeof ast === 'object') {
		if (ast.type === undefined && ('ast' in ast || 'go_next' in ast)) {
			forEachStatement(ast.ast, fn);
			forEachStatement(ast.go_next, fn);
		} else {
			fn(ast);
		}
	}
}

/** Runs the shared CREATE/ALTER walk over `ast` with a dialect's config. */
export function convertAST(ast: AstNode, diagramDb: string, config: DialectConfig): ImportedDiagram {
	const state: ImportState = { tables: [], relationships: [], types: [], enums: [], diagramDb };

	forEachStatement(ast, (e) => {
		if (config.handleStatement?.(e, state, config)) return;
		if (e.type === 'create') {
			if (e.keyword === 'table') createTable(e, state, config);
			else if (e.keyword === 'index') createIndex(e, state);
		} else if (e.type === 'alter') {
			alterTable(e, state);
		}
	});

	const { tables, relationships, types, enums } = state;
	return { tables, relationships, types, enums };
}
