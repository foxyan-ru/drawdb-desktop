import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { nanoid } from 'nanoid';
// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import { DB, type DBType } from '../data/constants';

/*
 * DB-client connection state (CLAUDE.md §9). Wire types mirror the Rust
 * `db_*` Tauri commands exactly (camelCase on the wire).
 *
 * SECURITY: passwords are NEVER held in these stores or persisted. A password
 * lives only in a component's transient input state and is passed straight
 * through to `db_connect` / `db_test` via the `password` argument of
 * `connect()` / `testConnection()`. Everything that reaches localStorage goes
 * through `serializeConnections()`, which strips it defensively.
 */

export type DbKind = 'sqlite' | 'postgres' | 'mysql';

export interface ConnectionSpec {
	kind: DbKind;
	host?: string;
	port?: number;
	user?: string;
	password?: string;
	database?: string;
	/** SQLite only: path of the database file. */
	filePath?: string;
}

/** A connection spec as it may be stored: same shape, minus the password. */
export type StoredSpec = Omit<ConnectionSpec, 'password'>;

export interface SavedConnection {
	id: string;
	name: string;
	spec: StoredSpec;
}

export interface SchemaColumn {
	name: string;
	dataType: string;
	nullable: boolean;
	isPrimaryKey: boolean;
	defaultValue: string | null;
}

export interface SchemaTable {
	name: string;
	columns: SchemaColumn[];
	primaryKey: string[];
	foreignKeys: Array<{ column: string; refTable: string; refColumn: string }>;
	indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
}

export interface SchemaJson {
	tables: SchemaTable[];
}

export interface ExecOptions {
	dryRun: boolean;
	useTransaction: boolean;
}

export interface ExecStatementResult {
	sql: string;
	success: boolean;
	rowsAffected?: number;
	error?: string;
}

export interface ExecResult {
	statements: ExecStatementResult[];
}

export type ConnectionBusy = 'connecting' | 'disconnecting' | 'introspecting' | 'executing';

export interface ConnectionStatus {
	busy: ConnectionBusy | null;
	error: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in connections.test.ts)
// ---------------------------------------------------------------------------

export const DB_KINDS: DbKind[] = ['sqlite', 'postgres', 'mysql'];

export function defaultPort(kind: DbKind): number | undefined {
	if (kind === 'postgres') return 5432;
	if (kind === 'mysql') return 3306;
	return undefined;
}

/** Maps a connection kind to the diagram dialect used by `utils/exportSQL`. */
export function kindToDB(kind: DbKind): DBType {
	if (kind === 'postgres') return DB.POSTGRES;
	if (kind === 'mysql') return DB.MYSQL;
	return DB.SQLITE;
}

/**
 * Returns a copy of `spec` with the password removed and only the fields that
 * apply to its kind kept (a sqlite spec has no host/user; a network spec has no
 * filePath). Empty strings are dropped so persisted JSON stays tidy.
 */
export function sanitizeSpec(spec: ConnectionSpec | StoredSpec): StoredSpec {
	const out: StoredSpec = { kind: spec.kind };
	const s = spec as ConnectionSpec;
	if (spec.kind === 'sqlite') {
		if (s.filePath?.trim()) out.filePath = s.filePath.trim();
		return out;
	}
	if (s.host?.trim()) out.host = s.host.trim();
	if (typeof s.port === 'number' && Number.isFinite(s.port) && s.port > 0) out.port = s.port;
	if (s.user?.trim()) out.user = s.user.trim();
	if (s.database?.trim()) out.database = s.database.trim();
	return out;
}

/** Field keys that must be filled before a spec can be tested/saved. */
export type SpecField = 'filePath' | 'host' | 'user' | 'database';

export function validateSpec(spec: ConnectionSpec | StoredSpec): SpecField[] {
	const s = spec as ConnectionSpec;
	if (spec.kind === 'sqlite') return s.filePath?.trim() ? [] : ['filePath'];
	const missing: SpecField[] = [];
	if (!s.host?.trim()) missing.push('host');
	if (!s.user?.trim()) missing.push('user');
	if (!s.database?.trim()) missing.push('database');
	return missing;
}

/** Builds the full spec sent over IPC: stored fields + the transient password. */
export function withPassword(spec: StoredSpec, password?: string): ConnectionSpec {
	const full: ConnectionSpec = { ...sanitizeSpec(spec) };
	if (spec.kind !== 'sqlite' && password) full.password = password;
	if (spec.kind !== 'sqlite' && full.port === undefined) full.port = defaultPort(spec.kind);
	return full;
}

/** Short human label for a saved connection, e.g. `postgres://app@db:5432/shop`. */
export function describeConnection(spec: StoredSpec): string {
	if (spec.kind === 'sqlite') return spec.filePath ?? '';
	const port = spec.port ?? defaultPort(spec.kind);
	const user = spec.user ? `${spec.user}@` : '';
	return `${spec.kind}://${user}${spec.host ?? ''}${port ? `:${port}` : ''}/${spec.database ?? ''}`;
}

export function upsertConnection(list: SavedConnection[], conn: SavedConnection): SavedConnection[] {
	const clean: SavedConnection = { id: conn.id, name: conn.name, spec: sanitizeSpec(conn.spec) };
	const idx = list.findIndex((c) => c.id === conn.id);
	if (idx === -1) return [...list, clean];
	const next = [...list];
	next[idx] = clean;
	return next;
}

export function removeConnection(list: SavedConnection[], id: string): SavedConnection[] {
	return list.filter((c) => c.id !== id);
}

/**
 * The ONLY path by which saved connections are serialized for storage.
 * Rebuilds every entry field-by-field so a stray `password` (or anything else)
 * that slipped into an object at runtime can never be written out.
 */
export function serializeConnections(list: SavedConnection[]): string {
	return JSON.stringify(
		list.map((c) => ({ id: String(c.id), name: String(c.name), spec: sanitizeSpec(c.spec) }))
	);
}

export function deserializeConnections(raw: string | null | undefined): SavedConnection[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(c) =>
					c &&
					typeof c.id === 'string' &&
					typeof c.name === 'string' &&
					c.spec &&
					DB_KINDS.includes(c.spec.kind)
			)
			.map((c) => ({ id: c.id, name: c.name, spec: sanitizeSpec(c.spec) }));
	} catch {
		return [];
	}
}

export function summarizeExecResult(result: ExecResult): { total: number; succeeded: number; failed: number } {
	const total = result.statements.length;
	const succeeded = result.statements.filter((s) => s.success).length;
	return { total, succeeded, failed: total - succeeded };
}

/** Tauri rejects with the Rust `Err(String)` as-is; normalize anything else. */
export function errorMessage(e: unknown): string {
	if (typeof e === 'string') return e;
	if (e instanceof Error) return e.message;
	if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
	try {
		return JSON.stringify(e);
	} catch {
		return String(e);
	}
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'drawdb_connections';

function readStorage(): SavedConnection[] {
	try {
		if (typeof localStorage === 'undefined') return [];
		return deserializeConnections(localStorage.getItem(STORAGE_KEY));
	} catch {
		return [];
	}
}

function writeStorage(list: SavedConnection[]) {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(STORAGE_KEY, serializeConnections(list));
	} catch {
		// storage unavailable — connections stay in memory for this session
	}
}

// Persisted the same way as `settings.ts` (localStorage, write-through on every
// change) — but always via `serializeConnections`, never raw JSON.stringify.
function createSavedConnectionsStore() {
	const { subscribe, set, update } = writable<SavedConnection[]>(readStorage());
	return {
		subscribe,
		set(value: SavedConnection[]) {
			set(value);
			writeStorage(value);
		},
		update(fn: (list: SavedConnection[]) => SavedConnection[]) {
			update((prev) => {
				const next = fn(prev);
				writeStorage(next);
				return next;
			});
		}
	};
}

export const savedConnections = createSavedConnectionsStore();

/** savedConnection.id → backend connection id returned by `db_connect`. */
export const activeConnections = writable<Record<string, string>>({});

/** savedConnection.id → last introspection result. */
export const introspectionResults = writable<Record<string, SchemaJson>>({});

/** savedConnection.id → in-flight operation / last error. */
export const connectionStatus = writable<Record<string, ConnectionStatus>>({});

export const activeConnectionCount = derived(activeConnections, ($a) => Object.keys($a).length);

function setStatus(id: string, patch: Partial<ConnectionStatus>) {
	connectionStatus.update((m) => {
		const prev = m[id] ?? { busy: null, error: null };
		return { ...m, [id]: { ...prev, ...patch } };
	});
}

// ---------------------------------------------------------------------------
// IPC actions
// ---------------------------------------------------------------------------

export type Invoker = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
const tauriInvoker: Invoker = <T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);
let invoker: Invoker = tauriInvoker;

/** Test seam: swap the Tauri `invoke` for a fake. Pass nothing to restore. */
export function setInvoker(fn?: Invoker) {
	invoker = fn ?? tauriInvoker;
}

function findSaved(id: string): SavedConnection {
	const conn = get(savedConnections).find((c) => c.id === id);
	if (!conn) throw new Error(`Unknown connection: ${id}`);
	return conn;
}

function requireActive(id: string): string {
	const connectionId = get(activeConnections)[id];
	if (!connectionId) throw new Error('Not connected');
	return connectionId;
}

/** Creates or updates a saved connection. The password is never stored. */
export function saveConnection(name: string, spec: ConnectionSpec | StoredSpec, id?: string): SavedConnection {
	const conn: SavedConnection = {
		id: id ?? nanoid(),
		name: name.trim() || describeConnection(sanitizeSpec(spec)),
		spec: sanitizeSpec(spec)
	};
	savedConnections.update((list) => upsertConnection(list, conn));
	return conn;
}

export async function deleteConnection(id: string) {
	if (get(activeConnections)[id]) {
		try {
			await disconnect(id);
		} catch {
			// still remove it locally; the backend handle is dropped on app exit
		}
	}
	savedConnections.update((list) => removeConnection(list, id));
	introspectionResults.update(({ [id]: _drop, ...rest }) => rest);
	connectionStatus.update(({ [id]: _drop, ...rest }) => rest);
}

/** Tests connectivity for an (unsaved) spec. Rejects with the backend's error string. */
export async function testConnection(spec: StoredSpec, password?: string): Promise<boolean> {
	return invoker<boolean>('db_test', { spec: withPassword(spec, password) });
}

export async function connect(id: string, password?: string): Promise<string> {
	const existing = get(activeConnections)[id];
	if (existing) return existing;
	const conn = findSaved(id);
	setStatus(id, { busy: 'connecting', error: null });
	try {
		const connectionId = await invoker<string>('db_connect', { spec: withPassword(conn.spec, password) });
		activeConnections.update((m) => ({ ...m, [id]: connectionId }));
		setStatus(id, { busy: null });
		return connectionId;
	} catch (e) {
		setStatus(id, { busy: null, error: errorMessage(e) });
		throw e;
	}
}

export async function disconnect(id: string) {
	const connectionId = get(activeConnections)[id];
	if (!connectionId) return;
	setStatus(id, { busy: 'disconnecting', error: null });
	try {
		await invoker<void>('db_disconnect', { connectionId });
		setStatus(id, { busy: null });
	} catch (e) {
		setStatus(id, { busy: null, error: errorMessage(e) });
		throw e;
	} finally {
		// Forget the handle either way — a failed disconnect means it's already gone server-side.
		activeConnections.update(({ [id]: _drop, ...rest }) => rest);
	}
}

/** Read-only schema introspection; result is cached in `introspectionResults`. */
export async function introspect(id: string): Promise<SchemaJson> {
	const connectionId = requireActive(id);
	setStatus(id, { busy: 'introspecting', error: null });
	try {
		const schema = await invoker<SchemaJson>('db_introspect', { connectionId });
		introspectionResults.update((m) => ({ ...m, [id]: schema }));
		setStatus(id, { busy: null });
		return schema;
	} catch (e) {
		setStatus(id, { busy: null, error: errorMessage(e) });
		throw e;
	}
}

/**
 * Executes SQL on an active connection. Callers MUST only pass
 * `dryRun: false` after an explicit user confirmation (CLAUDE.md §9 safety rules).
 */
export async function execute(id: string, sql: string, opts: ExecOptions): Promise<ExecResult> {
	const connectionId = requireActive(id);
	setStatus(id, { busy: 'executing', error: null });
	try {
		const result = await invoker<ExecResult>('db_execute', { connectionId, sql, opts });
		setStatus(id, { busy: null });
		return result;
	} catch (e) {
		setStatus(id, { busy: null, error: errorMessage(e) });
		throw e;
	}
}
