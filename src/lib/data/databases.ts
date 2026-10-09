import { DB } from './constants';

export interface DatabaseInfo {
	name: string;
	label: string;
	/**
	 * Engine logo URL, or null for Generic (web `data/databases.js:1-6,62`).
	 * WHY a `static/` URL instead of a Vite asset import: the PNGs are copied
	 * verbatim from web `src/assets/*-icon.png` into `static/db-icons/`, which
	 * needs no `*.png` module typing for svelte-check and keeps this module
	 * importable from `bun test` without an asset loader.
	 */
	image: string | null;
	/** i18n key for a short blurb shown in the pick-database grid (web only has one, for Generic). */
	descriptionKey?: string;
	/** i18n key for the display name, when it is translated (web `databases.js:58-60`). */
	nameKey?: string;
	hasTypes: boolean;
	hasEnums?: boolean;
	hasArrays?: boolean;
	hasUnsignedTypes?: boolean;
	hasMaterializedViews?: boolean;
	/** Rendered as a "Beta" tag in the pick-database grid (web `Workspace.jsx:643-647`). */
	beta?: boolean;
}

export const databases: Record<string, DatabaseInfo> = {
	[DB.MYSQL]: {
		name: 'MySQL',
		label: DB.MYSQL,
		image: '/db-icons/mysql-icon.png',
		hasTypes: false,
		hasUnsignedTypes: true
	},
	[DB.POSTGRES]: {
		name: 'PostgreSQL',
		label: DB.POSTGRES,
		image: '/db-icons/postgres-icon.png',
		hasTypes: true,
		hasEnums: true,
		hasArrays: true,
		hasMaterializedViews: true
	},
	[DB.SQLITE]: {
		name: 'SQLite',
		label: DB.SQLITE,
		image: '/db-icons/sqlite-icon.png',
		hasTypes: false
	},
	[DB.MARIADB]: {
		name: 'MariaDB',
		label: DB.MARIADB,
		image: '/db-icons/mariadb-icon.png',
		hasTypes: false,
		hasUnsignedTypes: true
	},
	[DB.MSSQL]: {
		name: 'MSSQL',
		label: DB.MSSQL,
		image: '/db-icons/mssql-icon.png',
		hasTypes: false
	},
	[DB.ORACLESQL]: {
		name: 'Oracle SQL',
		label: DB.ORACLESQL,
		image: '/db-icons/oraclesql-icon.png',
		hasTypes: false,
		hasEnums: false,
		hasArrays: false,
		hasMaterializedViews: true,
		beta: true
	},
	[DB.GENERIC]: {
		name: 'Generic',
		nameKey: 'generic',
		label: DB.GENERIC,
		image: null,
		descriptionKey: 'generic_description',
		hasTypes: true,
		hasMaterializedViews: true
	}
};
