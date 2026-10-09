import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import {
	activeConnections,
	connect,
	connectionStatus,
	deleteConnection,
	describeConnection,
	deserializeConnections,
	disconnect,
	errorMessage,
	execute,
	introspect,
	introspectionResults,
	kindToDB,
	removeConnection,
	sanitizeSpec,
	saveConnection,
	savedConnections,
	serializeConnections,
	setInvoker,
	summarizeExecResult,
	testConnection,
	upsertConnection,
	validateSpec,
	withPassword,
	type ConnectionSpec,
	type SavedConnection
} from './connections';

const pgSpec: ConnectionSpec = {
	kind: 'postgres',
	host: ' db.local ',
	port: 5433,
	user: 'app',
	password: 'hunter2',
	database: 'shop',
	filePath: '/should/be/dropped.db'
};

describe('pure helpers', () => {
	test('sanitizeSpec drops the password and fields that do not apply to the kind', () => {
		expect(sanitizeSpec(pgSpec)).toEqual({ kind: 'postgres', host: 'db.local', port: 5433, user: 'app', database: 'shop' });
		expect(sanitizeSpec({ kind: 'sqlite', filePath: '/tmp/a.db', host: 'x', password: 'p' } as ConnectionSpec)).toEqual({
			kind: 'sqlite',
			filePath: '/tmp/a.db'
		});
	});

	test('serializeConnections never writes a password, even one smuggled in at runtime', () => {
		const sneaky = { id: 'a', name: 'A', spec: { ...pgSpec }, password: 'top' } as unknown as SavedConnection;
		const json = serializeConnections([sneaky]);
		expect(json).not.toContain('hunter2');
		expect(json).not.toContain('top');
		expect(json).not.toContain('password');
		expect(JSON.parse(json)[0].spec.host).toBe('db.local');
	});

	test('deserializeConnections ignores junk and strips passwords from stored data', () => {
		expect(deserializeConnections(null)).toEqual([]);
		expect(deserializeConnections('not json')).toEqual([]);
		expect(deserializeConnections('{"a":1}')).toEqual([]);
		const raw = JSON.stringify([
			{ id: '1', name: 'ok', spec: { kind: 'mysql', host: 'h', user: 'u', database: 'd', password: 'leak' } },
			{ id: '2', name: 'bad kind', spec: { kind: 'oracle' } },
			{ name: 'no id', spec: { kind: 'sqlite' } }
		]);
		const list = deserializeConnections(raw);
		expect(list).toEqual([{ id: '1', name: 'ok', spec: { kind: 'mysql', host: 'h', user: 'u', database: 'd' } }]);
	});

	test('validateSpec reports the missing required fields per kind', () => {
		expect(validateSpec({ kind: 'sqlite' })).toEqual(['filePath']);
		expect(validateSpec({ kind: 'sqlite', filePath: 'a.db' })).toEqual([]);
		expect(validateSpec({ kind: 'mysql', host: 'h' })).toEqual(['user', 'database']);
		expect(validateSpec(pgSpec)).toEqual([]);
	});

	test('withPassword attaches the transient password and a default port for network DBs only', () => {
		expect(withPassword({ kind: 'mysql', host: 'h', user: 'u', database: 'd' }, 'pw')).toEqual({
			kind: 'mysql',
			host: 'h',
			user: 'u',
			database: 'd',
			port: 3306,
			password: 'pw'
		});
		expect(withPassword({ kind: 'sqlite', filePath: 'a.db' }, 'pw')).toEqual({ kind: 'sqlite', filePath: 'a.db' });
	});

	test('describeConnection renders a readable label', () => {
		expect(describeConnection(sanitizeSpec(pgSpec))).toBe('postgres://app@db.local:5433/shop');
		expect(describeConnection({ kind: 'mysql', host: 'h', database: 'd' })).toBe('mysql://h:3306/d');
		expect(describeConnection({ kind: 'sqlite', filePath: 'C:\\x.db' })).toBe('C:\\x.db');
	});

	test('upsertConnection replaces by id and sanitizes; removeConnection filters', () => {
		const a: SavedConnection = { id: 'a', name: 'A', spec: { kind: 'sqlite', filePath: 'a.db' } };
		let list = upsertConnection([], a);
		list = upsertConnection(list, { id: 'b', name: 'B', spec: pgSpec });
		expect(list.map((c) => c.id)).toEqual(['a', 'b']);
		expect('password' in list[1].spec).toBe(false);
		list = upsertConnection(list, { ...a, name: 'A2' });
		expect(list.map((c) => c.name)).toEqual(['A2', 'B']);
		expect(removeConnection(list, 'a').map((c) => c.id)).toEqual(['b']);
	});

	test('summarizeExecResult counts successes and failures', () => {
		expect(
			summarizeExecResult({
				statements: [
					{ sql: 'a', success: true, rowsAffected: 0 },
					{ sql: 'b', success: false, error: 'boom' },
					{ sql: 'c', success: true }
				]
			})
		).toEqual({ total: 3, succeeded: 2, failed: 1 });
	});

	test('errorMessage normalizes Tauri string rejections and Errors', () => {
		expect(errorMessage('connection refused')).toBe('connection refused');
		expect(errorMessage(new Error('nope'))).toBe('nope');
		expect(errorMessage({ message: 'obj' })).toBe('obj');
	});

	test('kindToDB maps to the exportSQL dialect names', () => {
		expect(kindToDB('postgres')).toBe('postgresql');
		expect(kindToDB('mysql')).toBe('mysql');
		expect(kindToDB('sqlite')).toBe('sqlite');
	});
});

describe('IPC actions (fake invoker)', () => {
	type Call = { cmd: string; args?: Record<string, unknown> };
	const calls: Call[] = [];
	let failNext: string | null = null;
	let savedId = '';

	setInvoker(async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
		calls.push({ cmd, args });
		if (failNext) {
			const msg = failNext;
			failNext = null;
			throw msg;
		}
		switch (cmd) {
			case 'db_test':
				return true as T;
			case 'db_connect':
				return 'conn-1' as T;
			case 'db_introspect':
				return { tables: [] } as T;
			case 'db_execute':
				return { statements: [{ sql: 'CREATE TABLE x ()', success: true, rowsAffected: 0 }] } as T;
			default:
				return undefined as T;
		}
	});

	test('saved connections never hold a password; it only travels in the IPC call', async () => {
		const saved = saveConnection('Shop', pgSpec);
		savedId = saved.id;
		const stored = get(savedConnections).find((c) => c.id === saved.id)!;
		expect(JSON.stringify(stored)).not.toContain('hunter2');

		expect(await testConnection(saved.spec, 'hunter2')).toBe(true);
		expect((calls.at(-1)!.args!.spec as ConnectionSpec).password).toBe('hunter2');

		const id = await connect(saved.id, 'hunter2');
		expect(id).toBe('conn-1');
		expect(calls.at(-1)).toEqual({
			cmd: 'db_connect',
			args: { spec: { kind: 'postgres', host: 'db.local', port: 5433, user: 'app', database: 'shop', password: 'hunter2' } }
		});
		expect(get(activeConnections)[saved.id]).toBe('conn-1');
		expect(JSON.stringify(get(savedConnections))).not.toContain('hunter2');
		expect(JSON.stringify(get(connectionStatus))).not.toContain('hunter2');

		// connecting again reuses the handle instead of opening another
		const before = calls.length;
		await connect(saved.id, 'hunter2');
		expect(calls.length).toBe(before);
	});

	test('introspect and execute use the backend connection id', async () => {
		const saved = { id: savedId };
		const schema = await introspect(saved.id);
		expect(calls.at(-1)).toEqual({ cmd: 'db_introspect', args: { connectionId: 'conn-1' } });
		expect(get(introspectionResults)[saved.id]).toEqual(schema);

		const res = await execute(saved.id, 'CREATE TABLE x ()', { dryRun: true, useTransaction: true });
		expect(calls.at(-1)).toEqual({
			cmd: 'db_execute',
			args: { connectionId: 'conn-1', sql: 'CREATE TABLE x ()', opts: { dryRun: true, useTransaction: true } }
		});
		expect(res.statements[0].success).toBe(true);
	});

	test('backend errors surface in connectionStatus and reject', async () => {
		const saved = { id: savedId };
		failNext = 'syntax error at or near "x"';
		let caught: unknown;
		try {
			await execute(saved.id, 'x', { dryRun: false, useTransaction: true });
		} catch (e) {
			caught = e;
		}
		expect(caught).toBe('syntax error at or near "x"');
		expect(get(connectionStatus)[saved.id]).toEqual({ busy: null, error: 'syntax error at or near "x"' });
	});

	test('disconnect forgets the handle; actions then refuse to run', async () => {
		const saved = { id: savedId };
		await disconnect(saved.id);
		expect(calls.at(-1)).toEqual({ cmd: 'db_disconnect', args: { connectionId: 'conn-1' } });
		expect(get(activeConnections)[saved.id]).toBeUndefined();

		let caught: unknown;
		try {
			await introspect(saved.id);
		} catch (e) {
			caught = e;
		}
		expect(errorMessage(caught)).toBe('Not connected');
	});

	test('deleteConnection disconnects first and clears cached state', async () => {
		const saved = { id: savedId };
		await connect(saved.id, 'pw');
		await deleteConnection(saved.id);
		expect(calls.at(-1)!.cmd).toBe('db_disconnect');
		expect(get(savedConnections).find((c) => c.id === saved.id)).toBeUndefined();
		expect(get(introspectionResults)[saved.id]).toBeUndefined();
		expect(get(activeConnections)[saved.id]).toBeUndefined();
		setInvoker();
	});
});
