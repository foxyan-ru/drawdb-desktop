import { DB } from '../../data/constants';
import { exportMySQL } from './mysql';
import { exportPostgres } from './postgres';
import { exportSQLite } from './sqlite';
import { exportGenericSQL } from './generic';
import type { Diagram } from './shared';

/**
 * Generate a SQL string for the given diagram, using the exporter that
 * matches the specified database type.
 *
 * Supported databases: MySQL, MariaDB (uses MySQL syntax), PostgreSQL,
 * SQLite, and Generic. MSSQL and OracleSQL fall back to generic SQL.
 */
export function generateSQL(database: string, diagram: Diagram): string {
	switch (database) {
		case DB.MYSQL:
		case DB.MARIADB:
			return exportMySQL(diagram);
		case DB.POSTGRES:
			return exportPostgres(diagram);
		case DB.SQLITE:
			return exportSQLite(diagram);
		case DB.GENERIC:
		default:
			return exportGenericSQL(diagram);
	}
}

export { exportMySQL } from './mysql';
export { exportPostgres } from './postgres';
export { exportSQLite } from './sqlite';
export { exportGenericSQL } from './generic';
export type { Diagram } from './shared';
