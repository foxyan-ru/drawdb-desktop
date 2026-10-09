// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import {
	DB,
	tableColorStripHeight,
	tableFieldHeight,
	tableHeaderHeight,
	tableWidth as defaultTableWidth,
	type Condition,
	type Field,
	type JoinOn,
	type Relationship,
	type Table,
	type View
} from '../data/constants';
import { databases } from '../data/databases';
import { getRelationshipFieldPairs } from './calcPath';
import { getTypeInfo, isFunction, isKeyword } from './exportSQL/shared';

/*
 * Database views: pure helpers behind the Views tab, the canvas View node and
 * SQL export. Port of drawdb-main/src/utils/views.js. The store-side wiring
 * (add/update/delete with undo) lives in stores/views.ts.
 */

export const JoinType = {
	INNER: 'INNER',
	LEFT: 'LEFT',
	RIGHT: 'RIGHT',
	FULL: 'FULL'
} as const;

export const ConditionOperator = {
	EQ: '=',
	NEQ: '<>',
	GT: '>',
	GTE: '>=',
	LT: '<',
	LTE: '<=',
	LIKE: 'LIKE',
	IN: 'IN',
	IS_NULL: 'IS NULL',
	IS_NOT_NULL: 'IS NOT NULL'
} as const;

const valuelessOperators = new Set<string>([ConditionOperator.IS_NULL, ConditionOperator.IS_NOT_NULL]);

/** Fallback for `databases[db].hasMaterializedViews` (web data/databases.js:26,54,67). */
const MATERIALIZED_VIEW_DBS = new Set<string>([DB.POSTGRES, DB.ORACLESQL, DB.GENERIC]);

/**
 * Whether the engine supports CREATE MATERIALIZED VIEW, which gates the
 * "Materialized" checkbox (web ViewInfo.jsx:216). Reads the
 * `hasMaterializedViews` flag if databases.ts carries it, else the web list.
 */
export function supportsMaterializedViews(database: string): boolean {
	const info = databases[database] as unknown as { hasMaterializedViews?: boolean } | undefined;
	return info?.hasMaterializedViews ?? MATERIALIZED_VIEW_DBS.has(database);
}

const quoteFor: Record<string, (s: string) => string> = {
	[DB.MYSQL]: (s) => `\`${s}\``,
	[DB.MARIADB]: (s) => `\`${s}\``,
	[DB.MSSQL]: (s) => `[${s}]`
};

const identifierQuote = (database: string) => quoteFor[database] ?? ((s: string) => `"${s}"`);

export function operatorTakesValue(operator: string): boolean {
	return !valuelessOperators.has(operator);
}

/** Base table + every joined table, in order (web views.js:52-56). */
export function viewTableIds(view: View): string[] {
	return [view.baseTableId, ...(view.joins ?? []).map((j) => j.tableId)].filter(
		(id): id is string => !!id
	);
}

export function viewScopeTables(view: View, tables: Table[] = []): Table[] {
	const byId = new Map(tables.map((t) => [t.id, t]));
	return viewTableIds(view)
		.map((id) => byId.get(id))
		.filter((t): t is Table => !!t);
}

export interface ColumnOption {
	label: string;
	value: string;
	tableId: string;
	fieldId: string;
}

/** `table.field` options for output-column / condition selects (web views.js:65-75). */
export function viewColumnOptions(view: View, tables: Table[] = []): ColumnOption[] {
	return viewScopeTables(view, tables).flatMap((table) =>
		table.fields.map((field) => ({
			label: `${table.name}.${field.name}`,
			value: `${table.id}:${field.id}`,
			tableId: table.id,
			fieldId: field.id
		}))
	);
}

function lookup(tables: Table[], tableId: string | null | undefined, fieldId: string | null | undefined) {
	const table = tables.find((t) => t.id === tableId);
	if (!table) return null;
	const field = table.fields.find((f) => f.id === fieldId);
	if (!field) return null;
	return { table, field };
}

export interface ResolvedViewColumn {
	id: string;
	name: string;
	type: string;
	size?: number | string;
	source: string;
}

/**
 * The columns a view outputs, for the canvas node (web views.js:85-117): the
 * explicit output columns (alias wins), or — when none are picked — every
 * field of every table in scope, mirroring `SELECT *`.
 */
export function resolveViewColumns(view: View, tables: Table[] = []): ResolvedViewColumn[] {
	if (!view.baseTableId) return [];

	const selected = view.columns ?? [];
	if (selected.length === 0) {
		return viewScopeTables(view, tables).flatMap((table) =>
			table.fields.map((field) => ({
				id: `${table.id}:${field.id}`,
				name: field.name,
				type: field.type,
				size: field.size,
				source: `${table.name}.${field.name}`
			}))
		);
	}

	return selected.flatMap((column) => {
		const resolved = lookup(tables, column.tableId, column.fieldId);
		if (!resolved) return [];
		const { table, field } = resolved;
		return [
			{
				id: column.id,
				name: column.alias?.trim() || field.name,
				type: field.type,
				size: field.size,
				source: `${table.name}.${field.name}`
			}
		];
	});
}

/**
 * Proposes the ON clause for joining `joinTableId` from an existing
 * relationship between it and a table already in the view's scope
 * (web views.js:118-145). Returns null when no relationship links them.
 */
export function suggestJoinCondition(
	view: View,
	tables: Table[],
	relationships: Relationship[],
	joinTableId: string
): JoinOn | null {
	const scope = new Set(viewTableIds(view));
	scope.delete(joinTableId);

	for (const relationship of relationships) {
		const pair = getRelationshipFieldPairs(relationship)[0];
		if (!pair) continue;

		const { startTableId, endTableId } = relationship;
		if (startTableId === joinTableId && scope.has(endTableId)) {
			return { leftTableId: endTableId, leftFieldId: pair.endFieldId, rightFieldId: pair.startFieldId };
		}
		if (endTableId === joinTableId && scope.has(startTableId)) {
			return { leftTableId: startTableId, leftFieldId: pair.startFieldId, rightFieldId: pair.endFieldId };
		}
	}

	return null;
}

function strHasQuotes(str: string): boolean {
	if (str.length < 2) return false;
	const first = str[0];
	return first === str[str.length - 1] && (first === "'" || first === '"' || first === '`');
}

/** Web views.js:147-154 — quote the literal only when the column type is string-like. */
function conditionValue(value: string | undefined, field: Field, database: string): string {
	const raw = String(value ?? '').trim();
	if (!raw) return "''";
	if (strHasQuotes(raw) || isKeyword(raw) || isFunction(raw)) return raw;
	if (raw.startsWith('(') && raw.endsWith(')')) return raw;
	if (!getTypeInfo(database, field?.type)?.hasQuotes) return raw;
	return `'${raw.replace(/'/g, "''")}'`;
}

/**
 * The SELECT body of a view (web views.js:156-221). Empty string when the
 * view has no (existing) base table, so callers can skip it.
 */
export function buildViewSQL(view: View, tables: Table[] = [], database: string = DB.GENERIC): string {
	if (!view.baseTableId) return '';

	const quote = identifierQuote(database);
	const baseTable = tables.find((t) => t.id === view.baseTableId);
	if (!baseTable) return '';

	const qualify = (tableId: string | null | undefined, fieldId: string | null | undefined) => {
		const resolved = lookup(tables, tableId, fieldId);
		if (!resolved) return null;
		return `${quote(resolved.table.name)}.${quote(resolved.field.name)}`;
	};

	const selectList = (view.columns ?? []).flatMap((column) => {
		const qualified = qualify(column.tableId, column.fieldId);
		if (!qualified) return [];
		return [column.alias?.trim() ? `${qualified} AS ${quote(column.alias.trim())}` : qualified];
	});

	const lines = [
		selectList.length ? `SELECT\n${selectList.map((c) => `  ${c}`).join(',\n')}` : 'SELECT *',
		`FROM ${quote(baseTable.name)}`
	];

	for (const join of view.joins ?? []) {
		const joinTable = tables.find((t) => t.id === join.tableId);
		if (!joinTable) continue;

		const left = join.on ? qualify(join.on.leftTableId, join.on.leftFieldId) : null;
		const right = join.on ? qualify(join.tableId, join.on.rightFieldId) : null;
		const onClause = left && right ? ` ON ${left} = ${right}` : '';
		lines.push(`${join.type} JOIN ${quote(joinTable.name)}${onClause}`);
	}

	const conditions = (view.conditions ?? []).flatMap((condition: Condition, index) => {
		const resolved = lookup(tables, condition.tableId, condition.fieldId);
		if (!resolved) return [];
		const qualified = `${quote(resolved.table.name)}.${quote(resolved.field.name)}`;
		const clause = operatorTakesValue(condition.operator)
			? `${qualified} ${condition.operator} ${conditionValue(condition.value, resolved.field, database)}`
			: `${qualified} ${condition.operator}`;
		// Web keys the connector off the condition's original position, so a
		// skipped (incomplete) first condition still leaves "AND …" on the next.
		return [index === 0 ? clause : `${condition.connector ?? 'AND'} ${clause}`];
	});

	if (conditions.length) {
		lines.push(`WHERE ${conditions.join('\n  ')}`);
	}

	return lines.join('\n');
}

interface ViewDialect {
	orReplace?: boolean;
	orAlter?: boolean;
	ifNotExists?: boolean;
	materialized?: boolean;
	commentOn?: boolean;
	batchSeparator?: string;
}

// Web views.js:223-231.
const viewDialects: Record<string, ViewDialect> = {
	[DB.MYSQL]: { orReplace: true },
	[DB.MARIADB]: { orReplace: true },
	[DB.POSTGRES]: { orReplace: true, materialized: true, commentOn: true },
	[DB.SQLITE]: { ifNotExists: true },
	[DB.MSSQL]: { orAlter: true, batchSeparator: '\nGO' },
	[DB.ORACLESQL]: { orReplace: true, materialized: true },
	[DB.GENERIC]: { orReplace: true }
};

function viewStatement(view: View, body: string, dialect: ViewDialect, quote: (s: string) => string): string {
	const materialized = !!view.materialized && !!dialect.materialized;
	const keyword = materialized ? 'MATERIALIZED VIEW' : 'VIEW';
	const prefix = materialized
		? 'CREATE'
		: dialect.orAlter
			? 'CREATE OR ALTER'
			: dialect.orReplace
				? 'CREATE OR REPLACE'
				: 'CREATE';
	const existsClause = !materialized && dialect.ifNotExists ? ' IF NOT EXISTS' : '';
	const name = quote(view.name);

	const statements: string[] = [];
	if (view.comment?.trim() && !dialect.commentOn) {
		statements.push(`/* ${view.comment} */`);
	}
	statements.push(`${prefix} ${keyword}${existsClause} ${name} AS\n${body};`);
	if (view.comment?.trim() && dialect.commentOn) {
		statements.push(`COMMENT ON ${keyword} ${name} IS '${view.comment.replace(/'/g, "''")}';`);
	}

	return statements.join('\n') + (dialect.batchSeparator ?? '');
}

/** All CREATE VIEW statements for a diagram; unnamed or base-less views are skipped. */
export function viewStatements(views: View[] | undefined, tables: Table[], database: string = DB.GENERIC): string {
	const dialect = viewDialects[database] ?? viewDialects[DB.GENERIC];
	const quote = identifierQuote(database);

	return (views ?? [])
		.filter((v) => v.name?.trim())
		.map((view) => {
			const body = buildViewSQL(view, tables, database);
			return body ? viewStatement(view, body, dialect, quote) : '';
		})
		.filter(Boolean)
		.join('\n\n');
}

/**
 * Appends the diagram's views to an exporter's DDL (web views.js:268-273),
 * called at the end of every exportSQL/* generator. Keeps the exporters'
 * trailing newline when it had one.
 */
export function appendViews(
	sql: string,
	obj: { views?: View[]; tables?: Table[]; database?: string } | undefined,
	database: string = obj?.database ?? DB.GENERIC
): string {
	const views = viewStatements(obj?.views, obj?.tables ?? [], database);
	if (!views) return sql;

	const trailing = sql.endsWith('\n') ? '\n' : '';
	return sql.trimEnd() ? `${sql.trimEnd()}\n\n${views}${trailing}` : views + trailing;
}

export function getViewWidth(view: View | undefined): number {
	const width = view?.width;
	return typeof width === 'number' && width > 0 ? width : defaultTableWidth;
}

/** Height of the one-line comment strip under the view header (desktop: fixed, see View.svelte). */
export const viewCommentHeight = 20;

/**
 * Canvas height of a view node. Same row metrics as Table.svelte (strip +
 * header + rows); web measures a multi-line comment (views.js:283-290), the
 * desktop node shows it as one clamped line of fixed height instead.
 */
export function getViewHeight(view: View, columnCount: number, showComments = true): number {
	return (
		tableColorStripHeight +
		tableHeaderHeight +
		columnCount * tableFieldHeight +
		(showComments && view.comment?.trim() ? viewCommentHeight : 0)
	);
}

/** Minimum / maximum width a view can be resized to (web constants.js:22-23). */
export const minViewWidth = 180;
export const maxViewWidth = 480;

export function clampViewWidth(width: number): number {
	return Math.min(maxViewWidth, Math.max(minViewWidth, Math.round(width)));
}

/** Canvas bounds of a view, for selection, bulk-select and image export. */
export function getViewRect(view: View, tables: Table[], showComments = true) {
	return {
		x: view.x,
		y: view.y,
		width: getViewWidth(view),
		height: getViewHeight(view, resolveViewColumns(view, tables).length, showComments)
	};
}
