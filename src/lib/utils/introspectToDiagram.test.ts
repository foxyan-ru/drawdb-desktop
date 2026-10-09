import { describe, expect, test } from 'bun:test';
import {
	applyIntrospectedDiagram,
	findNameConflicts,
	introspectToDiagram,
	normalizeColumnType,
	normalizeDefault,
	placementOrigin
} from './introspectToDiagram';
import type { SchemaJson } from '../stores/connections';
import type { Relationship, Table } from '../data/constants';

const schema: SchemaJson = {
	tables: [
		{
			name: 'users',
			columns: [
				{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, defaultValue: "nextval('users_id_seq'::regclass)" },
				{ name: 'email', dataType: 'character varying(255)', nullable: false, isPrimaryKey: false, defaultValue: null },
				{ name: 'status', dataType: 'text', nullable: true, isPrimaryKey: false, defaultValue: "'active'::text" },
				{ name: 'created_at', dataType: 'timestamp without time zone', nullable: false, isPrimaryKey: false, defaultValue: 'now()' }
			],
			primaryKey: ['id'],
			foreignKeys: [],
			indexes: [
				{ name: 'users_pkey', columns: ['id'], unique: true },
				{ name: 'users_email_key', columns: ['email'], unique: true },
				{ name: 'users_status_created_idx', columns: ['status', 'created_at'], unique: false }
			]
		},
		{
			name: 'profiles',
			columns: [
				{ name: 'user_id', dataType: 'integer', nullable: false, isPrimaryKey: true, defaultValue: null },
				{ name: 'bio', dataType: 'text', nullable: true, isPrimaryKey: false, defaultValue: null }
			],
			primaryKey: ['user_id'],
			foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }],
			indexes: []
		},
		{
			name: 'orders',
			columns: [
				{ name: 'id', dataType: 'bigint', nullable: false, isPrimaryKey: true, defaultValue: null },
				{ name: 'buyer_id', dataType: 'integer', nullable: false, isPrimaryKey: false, defaultValue: null },
				{ name: 'seller_id', dataType: 'integer', nullable: true, isPrimaryKey: false, defaultValue: null },
				{ name: 'total', dataType: 'numeric(10,2)', nullable: false, isPrimaryKey: false, defaultValue: '0' },
				{ name: 'warehouse_id', dataType: 'integer', nullable: true, isPrimaryKey: false, defaultValue: null }
			],
			primaryKey: ['id'],
			foreignKeys: [
				{ column: 'buyer_id', refTable: 'users', refColumn: 'id' },
				{ column: 'seller_id', refTable: 'users', refColumn: 'id' },
				{ column: 'warehouse_id', refTable: 'warehouses', refColumn: 'id' }
			],
			indexes: []
		},
		{
			name: 'order_items',
			columns: [
				{ name: 'order_id', dataType: 'bigint', nullable: false, isPrimaryKey: true, defaultValue: null },
				{ name: 'line_no', dataType: 'integer', nullable: false, isPrimaryKey: true, defaultValue: null }
			],
			primaryKey: ['order_id', 'line_no'],
			foreignKeys: [{ column: 'order_id', refTable: 'orders', refColumn: 'id' }],
			indexes: []
		},
		{
			name: 'shipments',
			columns: [
				{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, defaultValue: null },
				{ name: 'item_order_id', dataType: 'bigint', nullable: false, isPrimaryKey: false, defaultValue: null },
				{ name: 'item_line_no', dataType: 'integer', nullable: false, isPrimaryKey: false, defaultValue: null }
			],
			primaryKey: ['id'],
			foreignKeys: [
				{ column: 'item_order_id', refTable: 'order_items', refColumn: 'order_id' },
				{ column: 'item_line_no', refTable: 'order_items', refColumn: 'line_no' }
			],
			indexes: []
		}
	]
};

function byName(tables: Table[], name: string): Table {
	const t = tables.find((x) => x.name === name);
	if (!t) throw new Error(`missing table ${name}`);
	return t;
}

function fieldName(tables: Table[], tableId: string, fieldId: string): string {
	const t = tables.find((x) => x.id === tableId)!;
	return `${t.name}.${t.fields.find((f) => f.id === fieldId)!.name}`;
}

describe('normalizeColumnType', () => {
	test('maps Postgres verbose names and keeps meaningful sizes', () => {
		expect(normalizeColumnType('character varying(255)', 'postgresql')).toEqual({ type: 'VARCHAR', size: 255 });
		expect(normalizeColumnType('numeric(10, 2)', 'postgresql')).toEqual({ type: 'NUMERIC', size: '10,2' });
		expect(normalizeColumnType('timestamp(6) without time zone', 'postgresql')).toEqual({ type: 'TIMESTAMP' });
		expect(normalizeColumnType('timestamp with time zone', 'postgresql').type).toBe('TIMESTAMPTZ');
		expect(normalizeColumnType('double precision', 'postgresql').type).toBe('DOUBLE PRECISION');
		expect(normalizeColumnType('integer[]', 'postgresql').type).toBe('INTEGER[]');
	});

	test('treats Postgres serial pseudo-types as auto-increment integers', () => {
		expect(normalizeColumnType('bigserial', 'postgresql')).toEqual({ type: 'BIGINT', increment: true });
	});

	test('handles MySQL display widths, unsigned, booleans and enums', () => {
		expect(normalizeColumnType('int(10) unsigned', 'mysql')).toEqual({ type: 'INTEGER', unsigned: true });
		expect(normalizeColumnType('tinyint(1)', 'mysql')).toEqual({ type: 'BOOLEAN' });
		expect(normalizeColumnType("enum('a','b','it''s')", 'mysql')).toEqual({ type: 'ENUM', values: ['a', 'b', "it's"] });
		expect(normalizeColumnType('double', 'mysql').type).toBe('DOUBLE');
	});

	test('uses INT for the generic dialect and BLOB for untyped SQLite columns', () => {
		expect(normalizeColumnType('INTEGER', 'generic').type).toBe('INT');
		expect(normalizeColumnType('', 'sqlite').type).toBe('BLOB');
		expect(normalizeColumnType('VARCHAR(50)', 'sqlite')).toEqual({ type: 'VARCHAR', size: 50 });
	});
});

describe('normalizeDefault', () => {
	test('detects sequences and strips casts and quotes', () => {
		expect(normalizeDefault("nextval('t_id_seq'::regclass)")).toEqual({ value: '', increment: true });
		expect(normalizeDefault("'active'::character varying")).toEqual({ value: 'active', increment: false });
		expect(normalizeDefault("'it''s'")).toEqual({ value: "it's", increment: false });
		expect(normalizeDefault('0::integer').value).toBe('0');
	});

	test('passes functions/keywords through and blanks NULLs', () => {
		expect(normalizeDefault('now()').value).toBe('now()');
		expect(normalizeDefault('CURRENT_TIMESTAMP').value).toBe('CURRENT_TIMESTAMP');
		expect(normalizeDefault("(datetime('now'))").value).toBe("datetime('now')");
		expect(normalizeDefault('NULL::character varying').value).toBe('');
		expect(normalizeDefault(null).value).toBe('');
	});
});

describe('introspectToDiagram', () => {
	const result = introspectToDiagram(schema, { database: 'postgresql', origin: { x: 100, y: 50 } });

	test('creates one table per schema table with fresh ids and default chrome', () => {
		expect(result.tables.map((t) => t.name)).toEqual(['users', 'profiles', 'orders', 'order_items', 'shipments']);
		expect(new Set(result.tables.map((t) => t.id)).size).toBe(5);
		const users = byName(result.tables, 'users');
		expect(users.x).toBe(100);
		expect(users.y).toBe(50);
		expect(users.locked).toBe(false);
		expect(users.collapsed).toBe(false);
	});

	test('lays tables out in a grid without overlap', () => {
		const positions = result.tables.map((t) => `${t.x},${t.y}`);
		expect(new Set(positions).size).toBe(positions.length);
	});

	test('maps column types, PK, nullability, defaults and auto-increment', () => {
		const users = byName(result.tables, 'users');
		const [id, email, status, created] = users.fields;
		expect(id).toMatchObject({ name: 'id', type: 'INTEGER', primary: true, notNull: true, increment: true, default: '' });
		expect(email).toMatchObject({ type: 'VARCHAR', size: 255, notNull: true, unique: true, primary: false });
		expect(status).toMatchObject({ type: 'TEXT', notNull: false, default: 'active' });
		expect(created).toMatchObject({ type: 'TIMESTAMP', default: 'now()' });

		const total = byName(result.tables, 'orders').fields.find((f) => f.name === 'total')!;
		expect(total).toMatchObject({ type: 'NUMERIC', size: '10,2', default: '0' });
	});

	test('keeps composite indexes but folds PK and single-column unique indexes into fields', () => {
		const users = byName(result.tables, 'users');
		expect(users.indices).toEqual([{ name: 'users_status_created_idx', fields: ['status', 'created_at'], unique: false }]);
	});

	test('maps FKs child→parent with cardinality from uniqueness', () => {
		const rels = result.relationships;
		const fmt = (r: Relationship) =>
			`${fieldName(result.tables, r.startTableId, r.startFieldId)}->${fieldName(result.tables, r.endTableId, r.endFieldId)}:${r.cardinality}`;
		const described = rels.map(fmt);

		expect(described).toContain('profiles.user_id->users.id:one_to_one');
		expect(described).toContain('orders.buyer_id->users.id:many_to_one');
		expect(described).toContain('orders.seller_id->users.id:many_to_one');
		expect(described).toContain('order_items.order_id->orders.id:many_to_one');

		const buyer = rels.find((r) => r.name === 'fk_orders_buyer_id_users')!;
		expect(buyer.updateConstraint).toBe('No action');
		expect(buyer.deleteConstraint).toBe('No action');
	});

	test('rebuilds a composite FK that targets a multi-column primary key', () => {
		const shipments = byName(result.tables, 'shipments');
		const composite = result.relationships.filter((r) => r.startTableId === shipments.id);
		expect(composite.length).toBe(1);
		expect(composite[0].fields!.length).toBe(2);
		const pairs = composite[0].fields!.map(
			(p) =>
				`${fieldName(result.tables, shipments.id, p.startFieldId)}->${fieldName(result.tables, composite[0].endTableId, p.endFieldId)}`
		);
		expect(pairs).toEqual(['shipments.item_order_id->order_items.order_id', 'shipments.item_line_no->order_items.line_no']);
	});

	test('reports FKs to tables outside the schema instead of inventing them', () => {
		expect(result.skippedForeignKeys).toEqual([
			{ table: 'orders', column: 'warehouse_id', refTable: 'warehouses', refColumn: 'id' }
		]);
		expect(result.relationships.length).toBe(5);
	});

	test('models sqlite autoindexes as unique constraints', () => {
		const r = introspectToDiagram(
			{
				tables: [
					{
						name: 'pairs',
						columns: [
							{ name: 'a', dataType: 'INTEGER', nullable: true, isPrimaryKey: false, defaultValue: null },
							{ name: 'b', dataType: 'INTEGER', nullable: true, isPrimaryKey: false, defaultValue: null }
						],
						primaryKey: [],
						foreignKeys: [],
						indexes: [{ name: 'sqlite_autoindex_pairs_1', columns: ['a', 'b'], unique: true }]
					}
				]
			},
			{ database: 'sqlite' }
		);
		expect(r.tables[0].uniqueConstraints).toEqual([{ name: 'pairs_unique_0', fields: ['a', 'b'] }]);
		expect(r.tables[0].indices).toEqual([]);
	});
});

describe('helpers', () => {
	test('findNameConflicts is case-insensitive', () => {
		expect(findNameConflicts([{ name: 'Users' }, { name: 'orders' }], [{ name: 'users' }])).toEqual(['Users']);
	});

	test('placementOrigin uses the pan point for an empty diagram, else goes right of existing tables', () => {
		expect(placementOrigin([], { x: 5, y: 6 })).toEqual({ x: 5, y: 6 });
		expect(placementOrigin([{ x: 0, y: 40 }, { x: 300, y: 10 }], { x: 0, y: 0 }, 220, 100)).toEqual({ x: 620, y: 10 });
	});

	test('applyIntrospectedDiagram feeds tables then relationships through the store helpers', () => {
		const result = introspectToDiagram(schema, { database: 'postgresql' });
		const calls: string[] = [];
		applyIntrospectedDiagram(result, {
			addTable: ({ table }) => calls.push(`table:${table.name}`),
			addRelationship: (rel, addToHistory) => calls.push(`rel:${rel.name}:${addToHistory}`)
		});
		expect(calls.slice(0, 5)).toEqual([
			'table:users',
			'table:profiles',
			'table:orders',
			'table:order_items',
			'table:shipments'
		]);
		expect(calls.slice(5).every((c) => c.startsWith('rel:') && c.endsWith(':false'))).toBe(true);
		expect(calls.length).toBe(5 + result.relationships.length);
	});
});
