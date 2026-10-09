import { DB } from '../../data/constants';
import type { AstNode } from './shared';

/** node-sql-parser dialect names; they equal this app's `DB` values for these engines. */
export type ImportDialect =
	| typeof DB.MYSQL
	| typeof DB.POSTGRES
	| typeof DB.SQLITE
	| typeof DB.MARIADB
	| typeof DB.MSSQL;

/*
 * WHY per-dialect builds: web imports the full `node-sql-parser` bundle
 * (Modal.jsx:10), which ships every grammar (~15 dialects). The package also
 * publishes one build per dialect (`node-sql-parser/build/<dialect>`, each with
 * its own .d.ts), so only the grammar actually used is loaded — lazily, on the
 * first import, keeping it out of the startup bundle. The import specifiers must
 * stay string literals so Vite can code-split them.
 */
const loaders: Record<ImportDialect, () => Promise<unknown>> = {
	[DB.MYSQL]: () => import('node-sql-parser/build/mysql'),
	[DB.POSTGRES]: () => import('node-sql-parser/build/postgresql'),
	[DB.SQLITE]: () => import('node-sql-parser/build/sqlite'),
	[DB.MARIADB]: () => import('node-sql-parser/build/mariadb'),
	[DB.MSSQL]: () => import('node-sql-parser/build/transactsql')
};

interface ParserLike {
	astify(sql: string, opt?: { database?: string }): AstNode;
}

type ParserCtor = new () => ParserLike;

async function loadParser(dialect: ImportDialect): Promise<ParserCtor> {
	const load = loaders[dialect];
	if (!load) throw new Error(`Unsupported SQL dialect: ${dialect}`);
	const mod = (await load()) as { Parser?: ParserCtor; default?: { Parser?: ParserCtor } };
	// The builds are UMD/CommonJS: depending on the bundler's interop the class is
	// a named export or hangs off `default`.
	const Parser = mod.Parser ?? mod.default?.Parser;
	if (!Parser) throw new Error(`node-sql-parser build for ${dialect} has no Parser export`);
	return Parser;
}

/**
 * Parses `sql` with the given dialect (web Modal.jsx:131-135). Throws the
 * parser's own error on invalid SQL — see `describeParseError`.
 */
export async function parseSQL(sql: string, dialect: string): Promise<AstNode> {
	const Parser = await loadParser(dialect as ImportDialect);
	// `database` must be passed even to a single-dialect build: the parser
	// defaults to 'mysql', which the non-MySQL builds don't contain.
	return new Parser().astify(sql, { database: dialect });
}

export interface SQLParseError {
	name: string;
	message: string;
	/** 1-based, present for grammar (peggy SyntaxError) failures. */
	line?: number;
	column?: number;
}

/** Normalises a thrown parse error (web Modal.jsx:137-145 reads `error.location.start`). */
export function describeParseError(err: unknown): SQLParseError {
	const e = (err ?? {}) as { name?: unknown; message?: unknown; location?: { start?: { line?: unknown; column?: unknown } } };
	const out: SQLParseError = {
		name: typeof e.name === 'string' ? e.name : 'Error',
		message: typeof e.message === 'string' ? e.message : String(err)
	};
	const start = e.location?.start;
	if (start && typeof start.line === 'number' && typeof start.column === 'number') {
		out.line = start.line;
		out.column = start.column;
	}
	return out;
}
