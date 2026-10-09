// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import { DB } from '../../data/constants';
import { arrangeTables } from '../arrangeTables';
import { fromMariaDB } from './mariadb';
import { fromMSSQL } from './mssql';
import { fromMySQL } from './mysql';
import { fromPostgres } from './postgres';
import { fromSQLite } from './sqlite';
import type { AstNode, ImportedDiagram } from './shared';

export type { ImportedDiagram } from './shared';
export { fromMariaDB, fromMSSQL, fromMySQL, fromPostgres, fromSQLite };
export { parseSQL, describeParseError, type ImportDialect, type SQLParseError } from './parse';
export { applyImportedDiagram, type ApplyImportHelpers, type ApplyImportOptions } from './apply';

/**
 * Source dialects the importer understands, in the order the IMPORT_SRC modal
 * offers them for a Generic diagram. Oracle (web: `oracle-sql-parser`, Beta) is
 * intentionally not ported yet.
 */
export const IMPORT_DIALECTS = [DB.MYSQL, DB.POSTGRES, DB.SQLITE, DB.MARIADB, DB.MSSQL] as const;

export function isImportSupported(db: string): boolean {
	return (IMPORT_DIALECTS as readonly string[]).includes(db);
}

/**
 * Dialect to parse with: the diagram's own engine, or for a Generic diagram the
 * one the user picked (web Modal.jsx:122 `database === DB.GENERIC ? importDb : database`).
 */
export function resolveImportDialect(diagramDb: string, picked: string): string {
	return diagramDb === DB.GENERIC ? picked : diagramDb;
}

/**
 * Converts a node-sql-parser AST into diagram data, with types normalised to
 * `diagramDb`, and lays the tables out (port of web importSQL/index.js).
 */
export function importSQL(ast: AstNode, toDb: string = DB.MYSQL, diagramDb: string = DB.GENERIC): ImportedDiagram {
	let diagram: ImportedDiagram;
	switch (toDb) {
		case DB.SQLITE:
			diagram = fromSQLite(ast, diagramDb);
			break;
		case DB.MYSQL:
			diagram = fromMySQL(ast, diagramDb);
			break;
		case DB.POSTGRES:
			diagram = fromPostgres(ast, diagramDb);
			break;
		case DB.MARIADB:
			diagram = fromMariaDB(ast, diagramDb);
			break;
		case DB.MSSQL:
			diagram = fromMSSQL(ast, diagramDb);
			break;
		default:
			diagram = { tables: [], relationships: [], types: [], enums: [] };
			break;
	}

	arrangeTables(diagram);

	return diagram;
}
