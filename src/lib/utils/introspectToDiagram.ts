import { nanoid } from 'nanoid';
// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import {
	Cardinality,
	Constraint,
	DB,
	defaultBlue,
	tableFieldHeight,
	tableHeaderHeight,
	tableWidth as defaultTableWidth,
	type Field,
	type Relationship,
	type Table,
	type TableIndex
} from '../data/constants';
import type { SchemaJson, SchemaTable } from '../stores/connections';

/*
 * Maps a live-database introspection result (`db_introspect`, CLAUDE.md §9)
 * onto this app's Table / Field / Relationship shapes. Pure: no store access.
 * Feeding the result into the diagram goes through `applyIntrospectedDiagram`,
 * which calls the normal `diagram.ts` add helpers so undo/selection/rendering
 * behave exactly as for hand-made tables.
 */

export interface IntrospectOptions {
	/** Dialect of the diagram receiving the tables (`database` store value). */
	database: string;
	/** Top-left of the first table. */
	origin?: { x: number; y: number };
	tableWidth?: number;
	/** Horizontal/vertical spacing between laid-out tables. */
	gap?: number;
}

export interface SkippedForeignKey {
	table: string;
	column: string;
	refTable: string;
	refColumn: string;
}

export interface IntrospectedDiagram {
	tables: Table[];
	relationships: Relationship[];
	/** FKs whose referenced table/column isn't in the schema (e.g. another schema). */
	skippedForeignKeys: SkippedForeignKey[];
}

export interface NormalizedType {
	type: string;
	size?: number | string;
	values?: string[];
	unsigned?: boolean;
	/** True for pseudo-types such as Postgres SERIAL that imply auto-increment. */
	increment?: boolean;
}

// Types whose parenthesised argument is meaningful to keep as `Field.size`.
// Display widths like MySQL `int(11)` and timestamp precisions are dropped.
const SIZED_TYPES = new Set(['VARCHAR', 'CHAR', 'BINARY', 'VARBINARY', 'DECIMAL', 'NUMERIC', 'BIT', 'VARBIT']);

const TYPE_ALIASES: Record<string, string> = {
	int: 'INTEGER',
	int4: 'INTEGER',
	integer: 'INTEGER',
	int2: 'SMALLINT',
	smallint: 'SMALLINT',
	int8: 'BIGINT',
	bigint: 'BIGINT',
	'character varying': 'VARCHAR',
	varchar: 'VARCHAR',
	nvarchar: 'VARCHAR',
	'varying character': 'VARCHAR',
	character: 'CHAR',
	char: 'CHAR',
	bpchar: 'CHAR',
	nchar: 'CHAR',
	'native character': 'CHAR',
	text: 'TEXT',
	tinytext: 'TEXT',
	mediumtext: 'TEXT',
	longtext: 'TEXT',
	clob: 'TEXT',
	float4: 'REAL',
	real: 'REAL',
	float: 'FLOAT',
	bool: 'BOOLEAN',
	boolean: 'BOOLEAN',
	'timestamp without time zone': 'TIMESTAMP',
	'timestamp with time zone': 'TIMESTAMPTZ',
	timestamptz: 'TIMESTAMPTZ',
	'time without time zone': 'TIME',
	'time with time zone': 'TIMETZ',
	'bit varying': 'VARBIT',
	tinyblob: 'BLOB',
	mediumblob: 'BLOB',
	longblob: 'BLOB'
};

const SERIAL_TYPES: Record<string, string> = {
	smallserial: 'SMALLINT',
	serial2: 'SMALLINT',
	serial: 'INTEGER',
	serial4: 'INTEGER',
	bigserial: 'BIGINT',
	serial8: 'BIGINT'
};

/** Parses `'a','b','it''s'` (the inside of ENUM(...)/SET(...)) into values. */
function parseQuotedList(inner: string): string[] {
	const values: string[] = [];
	const re = /'((?:[^']|'')*)'/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(inner)) !== null) values.push(m[1].replace(/''/g, "'"));
	return values;
}

/**
 * Normalizes an engine-reported column type (e.g. `character varying(255)`,
 * `int(10) unsigned`, `numeric(10,2)`, `enum('a','b')`) to the upper-case type
 * names used by `data/datatypes.ts`, splitting out size / enum values.
 */
export function normalizeColumnType(dataType: string, database: string): NormalizedType {
	let raw = (dataType ?? '').trim();
	// SQLite allows untyped columns; their affinity is BLOB.
	if (raw === '') return { type: 'BLOB' };

	const out: NormalizedType = { type: '' };

	if (/\bunsigned\b/i.test(raw)) out.unsigned = true;
	raw = raw.replace(/\b(unsigned|zerofill|signed)\b/gi, '').trim();

	const enumMatch = /^(enum|set)\s*\(([\s\S]*)\)$/i.exec(raw);
	if (enumMatch) {
		out.type = enumMatch[1].toUpperCase();
		out.values = parseQuotedList(enumMatch[2]);
		return out;
	}

	// Pull the first "(...)" argument out, wherever it sits
	// (`timestamp(6) without time zone`, `varchar(20)`).
	let arg: string | undefined;
	const argMatch = /\(([^)]*)\)/.exec(raw);
	if (argMatch) {
		arg = argMatch[1].replace(/\s+/g, '');
		raw = (raw.slice(0, argMatch.index) + ' ' + raw.slice(argMatch.index + argMatch[0].length)).trim();
	}

	let isArray = false;
	if (raw.endsWith('[]')) {
		isArray = true;
		raw = raw.slice(0, -2).trim();
	}

	const base = raw.toLowerCase().replace(/\s+/g, ' ');

	// MySQL reports BOOLEAN columns as tinyint(1).
	if (base === 'tinyint' && arg === '1' && (database === DB.MYSQL || database === DB.MARIADB)) {
		return { type: 'BOOLEAN' };
	}

	let type: string;
	if (SERIAL_TYPES[base]) {
		type = SERIAL_TYPES[base];
		out.increment = true;
	} else if (base === 'double precision' || base === 'float8' || base === 'double') {
		type = database === DB.POSTGRES ? 'DOUBLE PRECISION' : 'DOUBLE';
	} else {
		type = TYPE_ALIASES[base] ?? base.toUpperCase();
	}

	// The generic dialect's integer type is INT (see `genericTypes` in data/datatypes.ts).
	if (type === 'INTEGER' && database === DB.GENERIC) type = 'INT';

	if (arg && SIZED_TYPES.has(type)) {
		out.size = /^\d+$/.test(arg) ? Number(arg) : arg;
	}

	out.type = isArray ? `${type}[]` : type;
	return out;
}

/** Strips one layer of wrapping parentheses if they enclose the whole string. */
function stripOuterParens(s: string): string {
	if (!s.startsWith('(') || !s.endsWith(')')) return s;
	let depth = 0;
	let inQuote = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "'") inQuote = !inQuote;
		if (inQuote) continue;
		if (ch === '(') depth++;
		else if (ch === ')') {
			depth--;
			if (depth === 0 && i < s.length - 1) return s; // closes before the end: not a wrapper
		}
	}
	return s.slice(1, -1).trim();
}

/**
 * Converts an engine-reported column default into `Field.default` text.
 * - Postgres `nextval('…'::regclass)` → no default, auto-increment.
 * - Postgres casts (`'x'::character varying`) are dropped.
 * - Quoted string literals are unquoted (the SQL exporters re-quote them via
 *   `parseDefault` in utils/exportSQL/shared.ts).
 * - NULL defaults become empty.
 */
export function normalizeDefault(raw: string | null | undefined): { value: string; increment: boolean } {
	if (raw === null || raw === undefined) return { value: '', increment: false };
	let s = String(raw).trim();
	if (s === '') return { value: '', increment: false };

	if (/^nextval\s*\(/i.test(s)) return { value: '', increment: true };

	s = stripOuterParens(s);

	if (s.startsWith("'")) {
		// Find the closing quote of the literal, honouring '' escapes.
		let i = 1;
		while (i < s.length) {
			if (s[i] === "'") {
				if (s[i + 1] === "'") {
					i += 2;
					continue;
				}
				break;
			}
			i++;
		}
		const literal = s.slice(1, i).replace(/''/g, "'");
		const rest = s.slice(i + 1).trim();
		// Anything after the literal must be a cast (`::type`) for us to unwrap it.
		if (rest === '' || /^(::\s*[\w\s".]+(\(\d+(,\d+)?\))?(\[\])?\s*)+$/.test(rest)) {
			return { value: literal, increment: false };
		}
		return { value: s, increment: false };
	}

	// Unquoted value with a trailing cast, e.g. `0::integer`, `NULL::character varying`.
	s = s.replace(/(::\s*[\w\s".]+(\(\d+(,\d+)?\))?(\[\])?\s*)+$/, '').trim();
	if (/^null$/i.test(s)) return { value: '', increment: false };
	return { value: s, increment: false };
}

function sameSet(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const sb = new Set(b);
	return a.every((x) => sb.has(x));
}

function pkColumns(t: SchemaTable): string[] {
	if (t.primaryKey && t.primaryKey.length > 0) return t.primaryKey;
	return t.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
}

function estimateTableHeight(t: SchemaTable): number {
	return tableHeaderHeight + t.columns.length * tableFieldHeight;
}

function mapTable(t: SchemaTable, database: string, x: number, y: number): Table {
	const pk = pkColumns(t);
	const indexes = (t.indexes ?? []).filter((idx) => Array.isArray(idx.columns) && idx.columns.length > 0);

	// Single-column UNIQUE indexes become the field's `unique` flag; the PK's own
	// backing index is redundant with `primary` and is dropped.
	const uniqueCols = new Set<string>();
	for (const idx of indexes) {
		if (idx.unique && idx.columns.length === 1 && !sameSet(idx.columns, pk)) uniqueCols.add(idx.columns[0]);
	}

	const fields: Field[] = t.columns.map((c) => {
		const nt = normalizeColumnType(c.dataType, database);
		const def = normalizeDefault(c.defaultValue);
		const primary = c.isPrimaryKey || pk.includes(c.name);
		const field: Field = {
			id: nanoid(),
			name: c.name,
			type: nt.type,
			default: def.value,
			check: '',
			primary,
			unique: uniqueCols.has(c.name),
			notNull: !c.nullable || primary,
			increment: !!(nt.increment || def.increment),
			comment: ''
		};
		if (nt.size !== undefined) field.size = nt.size;
		if (nt.values) field.values = nt.values;
		if (nt.unsigned) field.unsigned = true;
		return field;
	});

	const indices: TableIndex[] = [];
	const uniqueConstraints: { name: string; fields: string[] }[] = [];
	for (const idx of indexes) {
		if (sameSet(idx.columns, pk)) continue;
		if (idx.unique && idx.columns.length === 1) continue;
		// SQLite auto-creates `sqlite_autoindex_*` to back UNIQUE constraints; they
		// can't be recreated by name, so model them as unique constraints instead
		// (naming mirrors drawdb-main/src/utils/importSQL/mysql.js `${table}_unique_${n}`).
		if (idx.name.startsWith('sqlite_autoindex_')) {
			uniqueConstraints.push({ name: `${t.name}_unique_${uniqueConstraints.length}`, fields: [...idx.columns] });
			continue;
		}
		indices.push({ name: idx.name, fields: [...idx.columns], unique: idx.unique });
	}

	return {
		id: nanoid(),
		name: t.name,
		x,
		y,
		locked: false,
		fields,
		comment: '',
		indices,
		uniqueConstraints,
		color: defaultBlue,
		collapsed: false
	};
}

function findTable<T extends { name: string }>(list: T[], name: string): T | undefined {
	return list.find((t) => t.name === name) ?? list.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

export function introspectToDiagram(schema: SchemaJson, opts: IntrospectOptions): IntrospectedDiagram {
	const width = opts.tableWidth ?? defaultTableWidth;
	const gap = opts.gap ?? 80;
	const origin = opts.origin ?? { x: 0, y: 0 };
	const schemaTables = schema.tables ?? [];

	// Simple grid layout: roughly square, each row as tall as its tallest table.
	const cols = Math.max(1, Math.ceil(Math.sqrt(schemaTables.length)));
	const tables: Table[] = [];
	let y = origin.y;
	for (let row = 0; row * cols < schemaTables.length; row++) {
		const rowTables = schemaTables.slice(row * cols, row * cols + cols);
		rowTables.forEach((t, i) => {
			tables.push(mapTable(t, opts.database, origin.x + i * (width + gap), y));
		});
		y += Math.max(...rowTables.map(estimateTableHeight)) + gap;
	}

	const relationships: Relationship[] = [];
	const skippedForeignKeys: SkippedForeignKey[] = [];

	schemaTables.forEach((st, ti) => {
		const child = tables[ti];
		const fks = st.foreignKeys ?? [];

		// The contract reports FKs one column per row with no constraint name, so
		// composite FKs are reconstructed heuristically: several rows to the same
		// table whose distinct ref columns are exactly that table's multi-column PK.
		const byRef = new Map<string, typeof fks>();
		for (const fk of fks) {
			const key = fk.refTable;
			if (!byRef.has(key)) byRef.set(key, []);
			byRef.get(key)!.push(fk);
		}

		for (const [refName, group] of byRef) {
			const refSchema = findTable(schemaTables, refName);
			const parent = refSchema ? tables[schemaTables.indexOf(refSchema)] : undefined;
			const refPk = refSchema ? pkColumns(refSchema) : [];
			const refCols = group.map((g) => g.refColumn);
			const composite =
				group.length > 1 && refPk.length > 1 && new Set(refCols).size === group.length && sameSet(refCols, refPk);
			const sets = composite ? [group] : group.map((g) => [g]);

			for (const set of sets) {
				const pairs: { startFieldId: string; endFieldId: string }[] = [];
				for (const fk of set) {
					const sf = child.fields.find((f) => f.name === fk.column);
					const ef = parent?.fields.find((f) => f.name === fk.refColumn);
					if (!sf || !ef) break;
					pairs.push({ startFieldId: sf.id, endFieldId: ef.id });
				}
				if (!parent || pairs.length !== set.length) {
					for (const fk of set) skippedForeignKeys.push({ table: st.name, ...fk });
					continue;
				}

				const startCols = set.map((fk) => fk.column);
				const childPk = pkColumns(st);
				const startField = child.fields.find((f) => f.id === pairs[0].startFieldId)!;
				// Same rule as drawdb-main/src/utils/importSQL/mysql.js:172 — a unique
				// FK column means one-to-one; otherwise many-to-one.
				const oneToOne = (set.length === 1 && startField.unique) || (childPk.length > 0 && sameSet(startCols, childPk));

				relationships.push({
					id: nanoid(),
					// Naming mirrors drawdb-main/src/utils/importSQL/mysql.js:143.
					name: `fk_${st.name}_${set[0].column}_${parent.name}`,
					startTableId: child.id,
					startFieldId: pairs[0].startFieldId,
					endTableId: parent.id,
					endFieldId: pairs[0].endFieldId,
					fields: pairs,
					cardinality: oneToOne ? Cardinality.ONE_TO_ONE : Cardinality.MANY_TO_ONE,
					// The introspection contract carries no ON UPDATE/DELETE actions.
					updateConstraint: Constraint.NONE,
					deleteConstraint: Constraint.NONE
				});
			}
		}
	});

	return { tables, relationships, skippedForeignKeys };
}

/** Names of introspected tables that already exist in the diagram (case-insensitive). */
export function findNameConflicts(incoming: { name: string }[], existing: { name: string }[]): string[] {
	const have = new Set(existing.map((t) => t.name.toLowerCase()));
	return incoming.filter((t) => have.has(t.name.toLowerCase())).map((t) => t.name);
}

/**
 * Where to place introspected tables: at the viewport centre on an empty
 * diagram, otherwise to the right of everything already there.
 */
export function placementOrigin(
	existing: { x: number; y: number }[],
	pan: { x: number; y: number },
	width: number = defaultTableWidth,
	gap = 120
): { x: number; y: number } {
	if (existing.length === 0) return { x: pan.x, y: pan.y };
	const maxX = Math.max(...existing.map((t) => t.x));
	const minY = Math.min(...existing.map((t) => t.y));
	return { x: maxX + width + gap, y: minY };
}

export interface DiagramAddHelpers {
	addTable: (data: { table: Table; index?: number }) => void;
	addRelationship: (rel: Relationship, addToHistory?: boolean) => void;
}

/**
 * Feeds an introspected diagram through the regular `diagram.ts` mutation
 * helpers (passed in, so this stays unit-testable without the store graph).
 * Each table add records its own undo snapshot (that's what `addTable` does);
 * relationships ride on the last table's snapshot so one undo removes the
 * last table together with every FK line.
 */
export function applyIntrospectedDiagram(result: IntrospectedDiagram, helpers: DiagramAddHelpers) {
	for (const table of result.tables) helpers.addTable({ table });
	for (const rel of result.relationships) helpers.addRelationship(rel, false);
}
