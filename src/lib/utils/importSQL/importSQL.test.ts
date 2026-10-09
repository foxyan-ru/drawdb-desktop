import { describe, expect, test } from 'bun:test';
import { Cardinality, DB, type CustomType, type EnumType, type Relationship, type Table } from '../../data/constants';
import { arrangeTables } from '../arrangeTables';
import {
	applyImportedDiagram,
	describeParseError,
	fromMSSQL,
	fromMySQL,
	fromPostgres,
	fromSQLite,
	importSQL,
	isImportSupported,
	parseSQL,
	resolveImportDialect,
	type ApplyImportHelpers,
	type ImportedDiagram
} from './index';
import { buildSQLFromAST, columnName, parseDefault, tableName } from './shared';

// ---------------------------------------------------------------------------
// Hand-built AST fixtures (shapes as read by drawdb-main/src/utils/importSQL/*.js)
// ---------------------------------------------------------------------------

const col = (name: string, dataType: string, extra: Record<string, unknown> = {}, definition: Record<string, unknown> = {}) => ({
	resource: 'column',
	column: { type: 'column_ref', table: null, column: name },
	definition: { dataType, ...definition },
	...extra
});

const ref = (table: string, cols: string[], onAction: { type: string; value: string }[] = []) => ({
	table: [{ db: null, table }],
	definition: cols.map((c) => ({ type: 'column_ref', table: null, column: c })),
	on_action: onAction.map((a) => ({ type: a.type, value: { type: 'origin', value: a.value } }))
});

const createTable = (name: string, defs: unknown[], extra: Record<string, unknown> = {}) => ({
	type: 'create',
	keyword: 'table',
	table: [{ db: null, table: name }],
	create_definitions: defs,
	...extra
});

const usersTable = createTable(
	'users',
	[
		col('id', 'INT', { primary_key: 'primary key', auto_increment: 'auto_increment', nullable: { type: 'not null', value: 'not null' } }),
		col('email', 'VARCHAR', { unique: 'unique', nullable: { type: 'not null', value: 'not null' } }, { length: 255 }),
		col('nickname', 'VARCHAR', { nullable: { type: 'null', value: 'null' } }, { length: 50 }),
		col('status', 'ENUM', { default_val: { type: 'default', value: { type: 'single_quote_string', value: 'active' } } }, {
			expr: { type: 'expr_list', value: [{ value: 'active' }, { value: 'banned' }] }
		}),
		col('balance', 'DECIMAL', { comment: { type: 'comment', value: { type: 'single_quote_string', value: 'in cents' } } }, { length: 10, scale: 2 }),
		col('created_at', 'TIMESTAMP', {
			default_val: { type: 'default', value: { type: 'function', name: { name: [{ type: 'default', value: 'CURRENT_TIMESTAMP' }] } } }
		})
	],
	{ table_options: [{ keyword: 'comment', symbol: '=', value: "'App users'" }] }
);

const postsTable = createTable('posts', [
	col('id', 'INT'),
	col('user_id', 'INT'),
	col('score', 'INT', { check: { type: 'check', definition: [{ type: 'binary_expr', operator: '>=', left: { type: 'column_ref', column: 'score' }, right: { type: 'number', value: 0 } }] } }),
	{ resource: 'constraint', constraint_type: 'primary key', definition: [{ type: 'column_ref', column: 'id' }] },
	{
		resource: 'constraint',
		constraint_type: 'FOREIGN KEY',
		definition: [{ type: 'column_ref', column: 'user_id' }],
		reference_definition: ref('users', ['id'], [
			{ type: 'on delete', value: 'cascade' },
			{ type: 'on update', value: 'SET NULL' }
		])
	},
	{ resource: 'constraint', constraint_type: 'unique key', constraint: 'uq_posts', definition: [{ column: 'user_id' }, { column: 'score' }] },
	{ resource: 'index', index: 'idx_score', definition: [{ column: 'score' }] }
]);

describe('AST accessors', () => {
	test('columnName handles MySQL, Postgres and bare shapes', () => {
		expect(columnName('id')).toBe('id');
		expect(columnName({ type: 'column_ref', column: 'id' })).toBe('id');
		expect(columnName({ column: { expr: { type: 'default', value: 'id' } } })).toBe('id');
		expect(columnName({ expr: { value: 'id' } })).toBe('id');
		expect(columnName(null)).toBe('');
	});

	test('tableName handles array, object and string', () => {
		expect(tableName([{ db: null, table: 'a' }])).toBe('a');
		expect(tableName({ table: 'b' })).toBe('b');
		expect(tableName('c')).toBe('c');
	});

	test('parseDefault covers literals, NULL, functions, casts and arrays', () => {
		expect(parseDefault({ value: { type: 'number', value: 0 } })).toBe('0');
		expect(parseDefault({ value: { type: 'single_quote_string', value: 'x' } })).toBe('x');
		expect(parseDefault({ value: { type: 'null', value: null } })).toBe('NULL');
		expect(parseDefault({ value: { type: 'function', name: { name: [{ value: 'now' }] }, args: { value: [] } } })).toBe('now()');
		expect(
			parseDefault({ value: { type: 'function', name: 'COALESCE', args: { value: [{ type: 'single_quote_string', value: 'a' }, { type: 'number', value: 1 }] } } })
		).toBe("COALESCE('a', 1)");
		expect(parseDefault({ value: { type: 'cast', expr: { value: 'draft' } } })).toBe('draft');
		expect(parseDefault({ value: { type: 'array', expr_list: { value: [{ value: 1 }, { value: 2 }] } } })).toBe('ARRAY[1, 2]');
	});

	test('buildSQLFromAST quotes columns per dialect', () => {
		const expr = { type: 'binary_expr', operator: '>', left: { type: 'column_ref', column: 'age' }, right: { type: 'number', value: 18 } };
		expect(buildSQLFromAST(expr, DB.MYSQL)).toBe('`age` > 18');
		expect(buildSQLFromAST(expr, DB.POSTGRES)).toBe('"age" > 18');
		expect(buildSQLFromAST(expr, DB.MSSQL)).toBe('[age] > 18');
	});
});

describe('fromMySQL (AST fixtures)', () => {
	const result = fromMySQL([usersTable, postsTable], DB.MYSQL);
	const users = result.tables[0];
	const posts = result.tables[1];
	const field = (t: Table, name: string) => t.fields.find((f) => f.name === name)!;

	test('creates tables with desktop Table shape', () => {
		expect(result.tables.map((t) => t.name)).toEqual(['users', 'posts']);
		expect(users.comment).toBe('App users');
		expect(users.collapsed).toBe(false);
		expect(users.locked).toBe(false);
		expect(typeof users.id).toBe('string');
	});

	test('maps column flags, sizes, defaults, enums and comments', () => {
		const id = field(users, 'id');
		expect(id.type).toBe('INTEGER'); // MySQL affinity INT → INTEGER
		expect(id.primary).toBe(true);
		expect(id.increment).toBe(true);
		expect(id.notNull).toBe(true);

		const email = field(users, 'email');
		expect(email.type).toBe('VARCHAR');
		expect(email.size).toBe(255);
		expect(email.unique).toBe(true);
		expect(email.notNull).toBe(true);

		// explicit NULL must not become NOT NULL
		expect(field(users, 'nickname').notNull).toBe(false);

		const status = field(users, 'status');
		expect(status.type).toBe('ENUM');
		expect(status.values).toEqual(['active', 'banned']);
		expect(status.default).toBe('active');

		const balance = field(users, 'balance');
		expect(balance.size).toBe('10,2');
		expect(balance.comment).toBe('in cents');

		expect(field(users, 'created_at').default).toBe('CURRENT_TIMESTAMP');
	});

	test('table-level PRIMARY KEY, UNIQUE, KEY and CHECK', () => {
		expect(field(posts, 'id').primary).toBe(true);
		expect(posts.uniqueConstraints).toEqual([{ name: 'uq_posts', fields: ['user_id', 'score'] }]);
		expect(posts.indices).toEqual([{ id: 0, name: 'idx_score', unique: false, fields: ['score'] }]);
		expect(field(posts, 'score').check).toBe('`score` >= 0');
	});

	test('table-level FOREIGN KEY with ON DELETE / ON UPDATE', () => {
		expect(result.relationships).toHaveLength(1);
		const rel = result.relationships[0];
		expect(rel.name).toBe('fk_posts_user_id_users');
		expect(rel.startTableId).toBe(posts.id);
		expect(rel.endTableId).toBe(users.id);
		expect(rel.startFieldId).toBe(field(posts, 'user_id').id);
		expect(rel.endFieldId).toBe(field(users, 'id').id);
		expect(rel.deleteConstraint).toBe('Cascade');
		expect(rel.updateConstraint).toBe('Set null');
		expect(rel.cardinality).toBe(Cardinality.MANY_TO_ONE);
		expect(rel.fields).toEqual([{ startFieldId: rel.startFieldId, endFieldId: rel.endFieldId }]);
	});

	test('CREATE INDEX and ALTER TABLE ADD FOREIGN KEY', () => {
		const r = fromMySQL(
			[
				usersTable,
				createTable('comments', [col('id', 'INT'), col('author_id', 'INT', { unique: 'unique' })]),
				{ type: 'create', keyword: 'index', index: 'idx_author', index_type: 'unique', table: { db: null, table: 'comments' }, index_columns: [{ type: 'column_ref', column: 'author_id' }] },
				{
					type: 'alter',
					table: [{ db: null, table: 'comments' }],
					expr: [
						// ADD COLUMN has no constraint — must be ignored, not crash
						{ action: 'add', resource: 'column', column: { column: 'x' } },
						{
							action: 'add',
							resource: 'constraint',
							create_definitions: {
								constraint_type: 'FOREIGN KEY',
								definition: [{ column: 'author_id' }],
								reference_definition: ref('users', ['id'])
							}
						}
					]
				}
			],
			DB.MYSQL
		);
		const comments = r.tables[1];
		expect(comments.indices).toEqual([{ id: 0, name: 'idx_author', unique: true, fields: ['author_id'] }]);
		expect(r.relationships).toHaveLength(1);
		expect(r.relationships[0].deleteConstraint).toBe('No action');
		// unique FK column → one-to-one (web mysql.js:172)
		expect(r.relationships[0].cardinality).toBe(Cardinality.ONE_TO_ONE);
	});

	test('composite FOREIGN KEY keeps every column pair; unresolved references are skipped', () => {
		const r = fromMySQL(
			[
				createTable('parent', [col('a', 'INT'), col('b', 'INT')]),
				createTable('child', [
					col('pa', 'INT'),
					col('pb', 'INT'),
					{ resource: 'constraint', constraint_type: 'foreign key', definition: [{ column: 'pa' }, { column: 'pb' }], reference_definition: ref('parent', ['a', 'b']) },
					{ resource: 'constraint', constraint_type: 'foreign key', definition: [{ column: 'pa' }], reference_definition: ref('missing', ['id']) },
					{ resource: 'constraint', constraint_type: 'foreign key', definition: [{ column: 'pa' }], reference_definition: ref('parent', ['nope']) }
				])
			],
			DB.MYSQL
		);
		expect(r.relationships).toHaveLength(1);
		expect(r.relationships[0].fields).toHaveLength(2);
	});

	test('self-referencing FK resolves to the table being created', () => {
		const r = fromMySQL(
			[
				createTable('node', [
					col('id', 'INT'),
					col('parent_id', 'INT'),
					{ resource: 'constraint', constraint_type: 'foreign key', definition: [{ column: 'parent_id' }], reference_definition: ref('node', ['id']) }
				])
			],
			DB.MYSQL
		);
		expect(r.relationships).toHaveLength(1);
		expect(r.relationships[0].startTableId).toBe(r.relationships[0].endTableId);
	});

	test('types are normalised for a Generic diagram (web mysql.js affinity)', () => {
		const r = fromMySQL([createTable('t', [col('a', 'INTEGER'), col('b', 'TINYINT'), col('c', 'BIT'), col('d', 'GEOMETRY'), col('e', 'INT')])], DB.GENERIC);
		expect(r.tables[0].fields.map((f) => f.type)).toEqual(['INT', 'SMALLINT', 'BOOLEAN', 'BLOB', 'INT']);
	});

	test('ignores statements it does not model', () => {
		const r = fromMySQL([{ type: 'select' }, { type: 'insert' }, { type: 'drop' }, null], DB.MYSQL);
		expect(r).toEqual({ tables: [], relationships: [], types: [], enums: [] });
	});
});

describe('fromPostgres (AST fixtures)', () => {
	const pgCol = (name: string, dataType: string, extra: Record<string, unknown> = {}) => ({
		resource: 'column',
		column: { type: 'column_ref', table: null, column: { expr: { type: 'default', value: name } } },
		definition: { dataType },
		...extra
	});

	const ast = [
		{ type: 'create', keyword: 'type', resource: 'enum', name: { schema: null, name: 'mood' }, create_definitions: { type: 'expr_list', value: [{ value: 'happy' }, { value: 'sad' }] } },
		{ type: 'create', keyword: 'type', name: { schema: null, name: 'address' }, create_definitions: [pgCol('street', 'VARCHAR', {}), pgCol('zip', 'INT')] },
		createTable('person', [
			pgCol('id', 'SERIAL', { primary_key: 'primary key' }),
			pgCol('feeling', 'mood'),
			pgCol('home', '"address"')
		]),
		createTable('pet', [
			pgCol('id', 'SERIAL'),
			pgCol('owner_id', 'INT', {
				reference_definition: {
					table: [{ table: 'person' }],
					definition: [{ column: { expr: { value: 'id' } } }],
					on_action: [{ type: 'on delete', value: { value: 'set null' } }]
				}
			}),
			{ resource: 'constraint', constraint_type: 'primary key', definition: [{ column: { expr: { value: 'id' } } }] }
		]),
		{ type: 'comment', target: { type: 'table', name: { table: 'person' } }, expr: { expr: { value: 'People' } } },
		{ type: 'comment', target: { type: 'column', name: { table: 'pet', column: { expr: { value: 'owner_id' } } } }, expr: { expr: { value: 'owner' } } }
	];

	test('CREATE TYPE AS ENUM and composite types', () => {
		const r = fromPostgres(ast, DB.POSTGRES);
		expect(r.enums).toHaveLength(1);
		expect(r.enums[0].name).toBe('mood');
		expect(r.enums[0].values).toEqual(['happy', 'sad']);
		expect(r.types).toHaveLength(1);
		expect(r.types[0].name).toBe('address');
		expect(r.types[0].fields.map((f) => [f.name, f.type])).toEqual([
			['street', 'VARCHAR'],
			['zip', 'INTEGER']
		]);
	});

	test('columns typed with enums/composites keep the declared name; SERIAL implies increment', () => {
		const r = fromPostgres(ast, DB.POSTGRES);
		const person = r.tables[0];
		expect(person.fields.map((f) => f.type)).toEqual(['SERIAL', 'mood', 'address']);
		expect(person.fields[0].increment).toBe(true);
		expect(person.fields[0].primary).toBe(true);
	});

	test('inline REFERENCES, table PK and COMMENT ON', () => {
		const r = fromPostgres(ast, DB.POSTGRES);
		const [person, pet] = r.tables;
		expect(pet.fields[0].primary).toBe(true);
		expect(r.relationships).toHaveLength(1);
		expect(r.relationships[0].endTableId).toBe(person.id);
		expect(r.relationships[0].deleteConstraint).toBe('Set null');
		expect(person.comment).toBe('People');
		expect(pet.fields[1].comment).toBe('owner');
	});

	test('Generic diagram: SERIAL → INT with increment, CHARACTER VARYING → VARCHAR', () => {
		const r = fromPostgres([createTable('t', [pgCol('id', 'SERIAL'), pgCol('s', 'CHARACTER VARYING'), pgCol('u', 'UUID')])], DB.GENERIC);
		expect(r.tables[0].fields.map((f) => f.type)).toEqual(['INT', 'VARCHAR', 'UUID']);
		expect(r.tables[0].fields[0].increment).toBe(true);
	});
});

describe('fromSQLite / fromMSSQL (AST fixtures)', () => {
	test('SQLite affinity collapses integer types', () => {
		const r = fromSQLite([createTable('t', [col('a', 'BIGINT'), col('b', 'DOUBLE'), col('c', 'NVARCHAR')])], DB.SQLITE);
		expect(r.tables[0].fields.map((f) => f.type)).toEqual(['INTEGER', 'REAL', 'VARCHAR']);
	});

	test('MSSQL walks GO-separated batches and falls back to TEXT', () => {
		const ast = {
			go: 'go',
			ast: createTable('a', [col('id', 'INT'), col('x', 'HIERARCHYID')]),
			go_next: {
				go: 'go',
				ast: createTable('b', [col('a_id', 'INT', { reference_definition: ref('a', ['id']) })]),
				go_next: []
			}
		};
		const r = fromMSSQL(ast, DB.GENERIC);
		expect(r.tables.map((t) => t.name)).toEqual(['a', 'b']);
		expect(r.tables[0].fields[1].type).toBe('TEXT');
		expect(r.relationships).toHaveLength(1);
	});
});

describe('importSQL dispatch + layout', () => {
	test('dispatches by dialect and arranges tables', () => {
		const r = importSQL([usersTable, postsTable], DB.MYSQL, DB.MYSQL);
		expect(r.tables).toHaveLength(2);
		expect(r.tables[0].x).toBe(54);
		expect(r.tables[0].y).toBe(40);
	});

	test('unsupported dialect yields an empty diagram', () => {
		expect(importSQL([usersTable], DB.ORACLESQL, DB.ORACLESQL)).toEqual({ tables: [], relationships: [], types: [], enums: [] });
	});

	test('dialect resolution and support list', () => {
		expect(resolveImportDialect(DB.GENERIC, DB.POSTGRES)).toBe(DB.POSTGRES);
		expect(resolveImportDialect(DB.SQLITE, DB.POSTGRES)).toBe(DB.SQLITE);
		expect(isImportSupported(DB.MSSQL)).toBe(true);
		expect(isImportSupported(DB.ORACLESQL)).toBe(false);
		expect(isImportSupported(DB.GENERIC)).toBe(false);
	});
});

describe('arrangeTables (web arrangeTables.js)', () => {
	test('two rows: first half left→right, second half right→left below the tallest', () => {
		const mk = (n: number) => ({ x: -1, y: -1, fields: new Array(n).fill(0) });
		const d = { tables: [mk(2), mk(4), mk(1), mk(1)] };
		arrangeTables(d);
		// tallest of the first row: 4 fields → 4*36 + 50 + 7 = 201
		expect(d.tables.map((t) => [t.x, t.y])).toEqual([
			[54, 40],
			[308, 40],
			[308, 281],
			[54, 281]
		]);
	});

	test('no tables is a no-op', () => {
		const d = { tables: [] };
		arrangeTables(d);
		expect(d.tables).toEqual([]);
	});
});

describe('applyImportedDiagram (web Modal.jsx:167-195)', () => {
	const table = (id: string): Table => ({
		id,
		name: id,
		x: 0,
		y: 0,
		fields: [],
		comment: '',
		indices: [],
		uniqueConstraints: [],
		color: '#175e7a',
		collapsed: false,
		locked: false
	});
	const rel = (id: string): Relationship => ({
		id,
		name: id,
		startTableId: 'a',
		startFieldId: 'f',
		endTableId: 'b',
		endFieldId: 'g',
		cardinality: Cardinality.MANY_TO_ONE,
		updateConstraint: 'No action',
		deleteConstraint: 'No action'
	});
	const imported: ImportedDiagram = {
		tables: [table('t1')],
		relationships: [rel('r1')],
		types: [{ id: 'ty', name: 'ty', fields: [], comment: '' }],
		enums: [{ id: 'en', name: 'en', values: ['a'] }]
	};

	function fakeHelpers() {
		const calls: string[] = [];
		let loaded: Record<string, unknown> | null = null;
		const added = { tables: [] as Table[], rels: [] as Relationship[], types: [] as CustomType[], enums: [] as EnumType[] };
		const current = {
			title: 'd',
			tables: [table('old')],
			relationships: [rel('r1')],
			subjectAreas: [{ id: 0 }],
			notes: [{ id: 0 }],
			types: [] as CustomType[],
			enums: [{ id: 'keep', name: 'keep', values: [] }] as EnumType[],
			database: DB.POSTGRES
		};
		const helpers: ApplyImportHelpers = {
			exportDiagram: () => current,
			loadDiagram: (d) => {
				loaded = d;
				calls.push('load');
			},
			addTable: ({ table }) => {
				added.tables.push(table);
				calls.push('addTable');
			},
			addRelationship: (r, addToHistory) => {
				added.rels.push(r);
				calls.push(`addRel:${addToHistory}`);
			},
			addType: ({ type }) => {
				added.types.push(type);
				calls.push('addType');
			},
			addEnum: ({ enum: e }) => {
				added.enums.push(e);
				calls.push('addEnum');
			},
			clearHistory: () => calls.push('clearHistory'),
			resetPan: () => calls.push('resetPan')
		};
		return { helpers, calls, added, getLoaded: () => loaded, current };
	}

	test('overwrite replaces content, clears notes/areas, keeps database, resets pan, clears history', () => {
		const h = fakeHelpers();
		applyImportedDiagram(imported, { overwrite: true, hasTypes: true, hasEnums: true }, h.helpers);
		const loaded = h.getLoaded()!;
		expect(loaded.tables).toEqual(imported.tables);
		expect(loaded.relationships).toEqual(imported.relationships);
		expect(loaded.subjectAreas).toEqual([]);
		expect(loaded.notes).toEqual([]);
		expect(loaded.types).toEqual(imported.types);
		expect(loaded.enums).toEqual(imported.enums);
		expect(loaded.database).toBe(DB.POSTGRES);
		expect(h.calls).toEqual(['load', 'resetPan', 'clearHistory']);
	});

	test('overwrite keeps existing types/enums when the engine lacks them', () => {
		const h = fakeHelpers();
		applyImportedDiagram(imported, { overwrite: true, hasTypes: false, hasEnums: false }, h.helpers);
		expect(h.getLoaded()!.enums).toEqual(h.current.enums);
		expect(h.getLoaded()!.types).toEqual(h.current.types);
	});

	test('merge appends through add helpers, re-keys colliding relationship ids, clears history', () => {
		const h = fakeHelpers();
		applyImportedDiagram(imported, { overwrite: false, hasTypes: true, hasEnums: false }, h.helpers);
		expect(h.added.tables.map((t) => t.id)).toEqual(['t1']);
		expect(h.added.rels).toHaveLength(1);
		expect(h.added.rels[0].id).not.toBe('r1'); // collided with the existing 'r1'
		expect(h.added.types).toHaveLength(1);
		expect(h.added.enums).toHaveLength(0);
		expect(h.calls).toEqual(['addTable', 'addRel:false', 'addType', 'clearHistory']);
		expect(h.getLoaded()).toBeNull();
	});
});

describe('describeParseError', () => {
	test('extracts line/column from peggy-style errors', () => {
		const err = Object.assign(new Error('Expected "TABLE" but "TABL" found.'), {
			name: 'SyntaxError',
			location: { start: { line: 3, column: 8, offset: 40 }, end: { line: 3, column: 12, offset: 44 } }
		});
		expect(describeParseError(err)).toEqual({ name: 'SyntaxError', message: 'Expected "TABLE" but "TABL" found.', line: 3, column: 8 });
	});

	test('falls back to the message when there is no location', () => {
		expect(describeParseError(new Error('boom'))).toEqual({ name: 'Error', message: 'boom' });
		expect(describeParseError('weird')).toEqual({ name: 'Error', message: 'weird' });
	});
});

// ---------------------------------------------------------------------------
// End-to-end with the real parser (node-sql-parser per-dialect builds)
// ---------------------------------------------------------------------------

describe('parseSQL + importSQL (node-sql-parser)', () => {
	test('MySQL: tables, PK, FK, CREATE INDEX, ALTER TABLE', async () => {
		const sql = `
			CREATE TABLE users (
				id INT PRIMARY KEY AUTO_INCREMENT,
				email VARCHAR(255) NOT NULL UNIQUE,
				status ENUM('active','banned') DEFAULT 'active'
			);
			CREATE TABLE posts (
				id INT NOT NULL,
				user_id INT NOT NULL,
				editor_id INT,
				PRIMARY KEY (id),
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);
			CREATE INDEX idx_posts_user ON posts (user_id);
			ALTER TABLE posts ADD CONSTRAINT fk_editor FOREIGN KEY (editor_id) REFERENCES users(id);
		`;
		const ast = await parseSQL(sql, DB.MYSQL);
		const r = importSQL(ast, DB.MYSQL, DB.MYSQL);
		expect(r.tables.map((t) => t.name)).toEqual(['users', 'posts']);
		const [users, posts] = r.tables;
		const id = users.fields.find((f) => f.name === 'id')!;
		expect(id.primary).toBe(true);
		expect(id.increment).toBe(true);
		const email = users.fields.find((f) => f.name === 'email')!;
		expect(email.type).toBe('VARCHAR');
		expect(email.size).toBe(255);
		expect(email.notNull).toBe(true);
		expect(email.unique).toBe(true);
		const status = users.fields.find((f) => f.name === 'status')!;
		expect(status.values).toEqual(['active', 'banned']);
		expect(status.default).toBe('active');
		expect(posts.fields.find((f) => f.name === 'id')!.primary).toBe(true);
		expect(posts.indices.map((i) => i.name)).toEqual(['idx_posts_user']);
		expect(r.relationships).toHaveLength(2);
		expect(r.relationships[0].deleteConstraint).toBe('Cascade');
	});

	test('PostgreSQL: enum type, SERIAL, inline REFERENCES, COMMENT ON', async () => {
		const sql = `
			CREATE TYPE mood AS ENUM ('happy', 'sad');
			CREATE TABLE person (
				id SERIAL PRIMARY KEY,
				name VARCHAR(100) NOT NULL,
				feeling mood
			);
			CREATE TABLE pet (
				id SERIAL PRIMARY KEY,
				owner_id INTEGER REFERENCES person(id) ON DELETE SET NULL
			);
			COMMENT ON TABLE person IS 'People';
		`;
		const ast = await parseSQL(sql, DB.POSTGRES);
		const r = importSQL(ast, DB.POSTGRES, DB.POSTGRES);
		expect(r.enums.map((e) => e.name)).toEqual(['mood']);
		expect(r.enums[0].values).toEqual(['happy', 'sad']);
		expect(r.tables.map((t) => t.name)).toEqual(['person', 'pet']);
		const person = r.tables[0];
		expect(person.fields.find((f) => f.name === 'feeling')!.type).toBe('mood');
		expect(person.fields.find((f) => f.name === 'id')!.increment).toBe(true);
		expect(person.comment).toBe('People');
		expect(r.relationships).toHaveLength(1);
		expect(r.relationships[0].deleteConstraint).toBe('Set null');
	});

	test('SQLite: inline and table-level REFERENCES', async () => {
		const sql = `
			CREATE TABLE author (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
			CREATE TABLE book (
				id INTEGER PRIMARY KEY,
				author_id INTEGER REFERENCES author(id),
				co_author_id INTEGER,
				FOREIGN KEY (co_author_id) REFERENCES author(id)
			);
		`;
		const ast = await parseSQL(sql, DB.SQLITE);
		const r = importSQL(ast, DB.SQLITE, DB.SQLITE);
		expect(r.tables.map((t) => t.name)).toEqual(['author', 'book']);
		expect(r.relationships).toHaveLength(2);
	});

	test('MariaDB parses into tables + FK', async () => {
		const maria = importSQL(
			await parseSQL(
				'CREATE TABLE a (id INT PRIMARY KEY); CREATE TABLE b (id INT PRIMARY KEY, a_id INT, FOREIGN KEY (a_id) REFERENCES a(id));',
				DB.MARIADB
			),
			DB.MARIADB,
			DB.MARIADB
		);
		expect(maria.tables).toHaveLength(2);
		expect(maria.relationships).toHaveLength(1);
	});

	// node-sql-parser@5.4.0's `transactsql` (MSSQL) grammar cannot parse ANY
	// `REFERENCES table(column)` clause, inline or via ALTER TABLE ADD
	// CONSTRAINT — verified directly against the library: every variant raises
	// the same "Expected ... JOIN/LEFT/... but ')' found" parse error. This is
	// an upstream limitation, not a bug in our AST conversion, so this test
	// only covers what the parser can actually produce for MSSQL: table/column
	// parsing without a foreign key.
	test('MSSQL parses columns and PK (REFERENCES is an upstream parser limitation)', async () => {
		const mssql = importSQL(
			await parseSQL(
				'CREATE TABLE a (id INT PRIMARY KEY, name NVARCHAR(50) NOT NULL);',
				DB.MSSQL
			),
			DB.MSSQL,
			DB.MSSQL
		);
		expect(mssql.tables).toHaveLength(1);
		expect(mssql.tables[0].fields.map((f) => f.name)).toEqual(['id', 'name']);
	});

	test('invalid SQL rejects with a located syntax error', async () => {
		let caught: unknown = null;
		try {
			await parseSQL('CREATE TABL users (id INT);', DB.MYSQL);
		} catch (e) {
			caught = e;
		}
		expect(caught).not.toBeNull();
		const info = describeParseError(caught);
		expect(info.line).toBe(1);
		expect(typeof info.column).toBe('number');
	});
});
