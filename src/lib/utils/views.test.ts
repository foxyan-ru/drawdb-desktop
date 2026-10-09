import { describe, expect, test } from 'bun:test';
import {
	JoinType,
	ConditionOperator,
	operatorTakesValue,
	supportsMaterializedViews,
	viewTableIds,
	viewColumnOptions,
	resolveViewColumns,
	suggestJoinCondition,
	buildViewSQL,
	viewStatements,
	appendViews,
	clampViewWidth,
	minViewWidth,
	maxViewWidth,
	getViewWidth,
	getViewHeight
} from './views';
import {
	DB,
	tableColorStripHeight,
	tableFieldHeight,
	tableHeaderHeight,
	tableWidth as defaultTableWidth,
	type Field,
	type Relationship,
	type Table,
	type View
} from '../data/constants';

function field(id: string, extra: Partial<Field> = {}): Field {
	return {
		id,
		name: id,
		type: 'INTEGER',
		default: '',
		check: '',
		primary: false,
		unique: false,
		notNull: false,
		increment: false,
		comment: '',
		...extra
	};
}

function table(id: string, fields: Field[]): Table {
	return {
		id,
		name: id,
		x: 0,
		y: 0,
		fields,
		comment: '',
		indices: [],
		uniqueConstraints: [],
		color: '#175e7a',
		collapsed: false,
		locked: false
	};
}

function rel(startTableId: string, startFieldId: string, endTableId: string, endFieldId: string): Relationship {
	return {
		id: `${startTableId}_${endTableId}`,
		name: `${startTableId}_${endTableId}`,
		startTableId,
		startFieldId,
		endTableId,
		endFieldId,
		cardinality: 'many_to_one',
		updateConstraint: 'No action',
		deleteConstraint: 'No action'
	};
}

function view(overrides: Partial<View> = {}): View {
	return {
		id: 'v1',
		name: 'v1',
		x: 0,
		y: 0,
		baseTableId: null,
		joins: [],
		columns: [],
		conditions: [],
		comment: '',
		materialized: false,
		color: '#175e7a',
		locked: false,
		...overrides
	};
}

const users = table('users', [field('u_id', { primary: true }), field('u_name', { type: 'VARCHAR', size: 100 })]);
const posts = table('posts', [field('p_id', { primary: true }), field('p_user_id'), field('p_title', { type: 'VARCHAR', size: 200 })]);
const tables = [users, posts];
const relationships = [rel('posts', 'p_user_id', 'users', 'u_id')];

describe('operatorTakesValue', () => {
	test('IS NULL / IS NOT NULL take no value, everything else does', () => {
		expect(operatorTakesValue(ConditionOperator.IS_NULL)).toBe(false);
		expect(operatorTakesValue(ConditionOperator.IS_NOT_NULL)).toBe(false);
		expect(operatorTakesValue(ConditionOperator.EQ)).toBe(true);
		expect(operatorTakesValue(ConditionOperator.LIKE)).toBe(true);
	});
});

describe('supportsMaterializedViews', () => {
	test('matches the web list when databases.ts has no explicit flag, and prefers the flag otherwise', () => {
		expect(supportsMaterializedViews(DB.POSTGRES)).toBe(true);
		expect(supportsMaterializedViews(DB.MYSQL)).toBe(false);
		expect(supportsMaterializedViews(DB.GENERIC)).toBe(true);
	});
});

describe('viewTableIds / viewColumnOptions', () => {
	test('includes the base table and every joined table, in order', () => {
		const v = view({ baseTableId: 'users', joins: [{ id: 'j1', type: JoinType.INNER, tableId: 'posts', on: null }] });
		expect(viewTableIds(v)).toEqual(['users', 'posts']);
	});

	test('lists every field of every in-scope table as table.field options', () => {
		const v = view({ baseTableId: 'users', joins: [{ id: 'j1', type: JoinType.INNER, tableId: 'posts', on: null }] });
		const opts = viewColumnOptions(v, tables);
		expect(opts.map((o) => o.label)).toEqual(['users.u_id', 'users.u_name', 'posts.p_id', 'posts.p_user_id', 'posts.p_title']);
	});
});

describe('suggestJoinCondition', () => {
	test('proposes the ON clause from an existing relationship', () => {
		const v = view({ baseTableId: 'users', joins: [] });
		const on = suggestJoinCondition(v, tables, relationships, 'posts');
		expect(on).toEqual({ leftTableId: 'users', leftFieldId: 'u_id', rightFieldId: 'p_user_id' });
	});

	test('returns null when no relationship links the two tables', () => {
		const v = view({ baseTableId: 'posts', joins: [] });
		expect(suggestJoinCondition(v, tables, [], 'users')).toBeNull();
	});
});

describe('resolveViewColumns', () => {
	test('falls back to every field of every in-scope table when no output columns are chosen', () => {
		const v = view({ baseTableId: 'users' });
		const cols = resolveViewColumns(v, tables);
		expect(cols.map((c) => c.name)).toEqual(['u_id', 'u_name']);
	});

	test('uses the alias when one is set, else the field name', () => {
		const v = view({
			baseTableId: 'users',
			columns: [
				{ id: 'c1', tableId: 'users', fieldId: 'u_id', alias: 'id' },
				{ id: 'c2', tableId: 'users', fieldId: 'u_name', alias: '' }
			]
		});
		const cols = resolveViewColumns(v, tables);
		expect(cols.map((c) => c.name)).toEqual(['id', 'u_name']);
	});

	test('is empty when there is no base table', () => {
		expect(resolveViewColumns(view(), tables)).toEqual([]);
	});
});

describe('buildViewSQL', () => {
	test('builds SELECT/FROM for a plain view with no columns chosen (SELECT *)', () => {
		const v = view({ baseTableId: 'users' });
		expect(buildViewSQL(v, tables, DB.GENERIC)).toBe('SELECT *\nFROM "users"');
	});

	test('builds an explicit SELECT list with aliases, a JOIN with ON, and a WHERE clause', () => {
		const v = view({
			baseTableId: 'users',
			joins: [
				{
					id: 'j1',
					type: JoinType.LEFT,
					tableId: 'posts',
					on: { leftTableId: 'users', leftFieldId: 'u_id', rightFieldId: 'p_user_id' }
				}
			],
			columns: [
				{ id: 'c1', tableId: 'users', fieldId: 'u_name', alias: 'name' },
				{ id: 'c2', tableId: 'posts', fieldId: 'p_title', alias: '' }
			],
			conditions: [
				{ id: 'w1', connector: 'AND', tableId: 'posts', fieldId: 'p_title', operator: ConditionOperator.IS_NOT_NULL, value: '' }
			]
		});
		const sql = buildViewSQL(v, tables, DB.GENERIC);
		expect(sql).toBe(
			'SELECT\n  "users"."u_name" AS "name",\n  "posts"."p_title"\n' +
				'FROM "users"\n' +
				'LEFT JOIN "posts" ON "users"."u_id" = "posts"."p_user_id"\n' +
				'WHERE "posts"."p_title" IS NOT NULL'
		);
	});

	test('a second-and-later condition is joined with its connector', () => {
		const v = view({
			baseTableId: 'users',
			conditions: [
				{ id: 'w1', connector: 'AND', tableId: 'users', fieldId: 'u_id', operator: '>', value: '1' },
				{ id: 'w2', connector: 'OR', tableId: 'users', fieldId: 'u_name', operator: 'LIKE', value: 'a%' }
			]
		});
		const sql = buildViewSQL(v, tables, DB.GENERIC);
		expect(sql).toContain('WHERE "users"."u_id" > 1\n  OR "users"."u_name" LIKE \'a%\'');
	});

	test('is empty for a view without a (resolvable) base table', () => {
		expect(buildViewSQL(view(), tables, DB.GENERIC)).toBe('');
		expect(buildViewSQL(view({ baseTableId: 'nope' }), tables, DB.GENERIC)).toBe('');
	});
});

describe('viewStatements / appendViews', () => {
	test('skips unnamed views and views without a resolvable base table', () => {
		expect(viewStatements([view({ name: '', baseTableId: 'users' })], tables, DB.GENERIC)).toBe('');
		expect(viewStatements([view({ baseTableId: null })], tables, DB.GENERIC)).toBe('');
	});

	test('MySQL: CREATE OR REPLACE VIEW, backtick-quoted', () => {
		const sql = viewStatements([view({ name: 'active_users', baseTableId: 'users' })], tables, DB.MYSQL);
		expect(sql).toBe('CREATE OR REPLACE VIEW `active_users` AS\nSELECT *\nFROM `users`;');
	});

	test('SQLite: CREATE VIEW IF NOT EXISTS', () => {
		const sql = viewStatements([view({ name: 'active_users', baseTableId: 'users' })], tables, DB.SQLITE);
		expect(sql).toBe('CREATE VIEW IF NOT EXISTS "active_users" AS\nSELECT *\nFROM "users";');
	});

	test('PostgreSQL: materialized view uses COMMENT ON instead of an inline comment', () => {
		const sql = viewStatements(
			[view({ name: 'active_users', baseTableId: 'users', materialized: true, comment: "it's active" })],
			tables,
			DB.POSTGRES
		);
		expect(sql).toBe(
			'CREATE MATERIALIZED VIEW "active_users" AS\nSELECT *\nFROM "users";\n' +
				`COMMENT ON MATERIALIZED VIEW "active_users" IS 'it''s active';`
		);
	});

	test('a non-materialized comment is emitted as a leading SQL comment', () => {
		const sql = viewStatements([view({ name: 'v', baseTableId: 'users', comment: 'hello' })], tables, DB.GENERIC);
		expect(sql).toBe('/* hello */\nCREATE OR REPLACE VIEW "v" AS\nSELECT *\nFROM "users";');
	});

	test('appendViews appends after existing SQL with a blank line, and is a no-op with no views', () => {
		const base = 'CREATE TABLE "users" (...);\n';
		const withViews = appendViews(base, { views: [view({ name: 'v', baseTableId: 'users' })], tables }, DB.GENERIC);
		expect(withViews).toBe(base.trimEnd() + '\n\nCREATE OR REPLACE VIEW "v" AS\nSELECT *\nFROM "users";\n');
		expect(appendViews(base, { views: [], tables })).toBe(base);
		expect(appendViews(base, undefined)).toBe(base);
	});
});

describe('view sizing', () => {
	test('getViewWidth falls back to the default table width', () => {
		expect(getViewWidth(view())).toBe(defaultTableWidth);
		expect(getViewWidth(view({ width: 300 }))).toBe(300);
	});

	test('getViewHeight sums the strip, header and one row per column', () => {
		expect(getViewHeight(view(), 3, false)).toBe(tableColorStripHeight + tableHeaderHeight + 3 * tableFieldHeight);
	});

	test('clampViewWidth stays within [minViewWidth, maxViewWidth]', () => {
		expect(clampViewWidth(10)).toBe(minViewWidth);
		expect(clampViewWidth(10000)).toBe(maxViewWidth);
		expect(clampViewWidth(250)).toBe(250);
	});
});
