import { DB } from './constants';

export interface DatabaseInfo {
	name: string;
	label: string;
	hasTypes: boolean;
	hasEnums?: boolean;
	hasArrays?: boolean;
	hasUnsignedTypes?: boolean;
}

export const databases: Record<string, DatabaseInfo> = {
	[DB.MYSQL]: {
		name: 'MySQL',
		label: DB.MYSQL,
		hasTypes: false,
		hasUnsignedTypes: true
	},
	[DB.POSTGRES]: {
		name: 'PostgreSQL',
		label: DB.POSTGRES,
		hasTypes: true,
		hasEnums: true,
		hasArrays: true
	},
	[DB.SQLITE]: {
		name: 'SQLite',
		label: DB.SQLITE,
		hasTypes: false
	},
	[DB.MARIADB]: {
		name: 'MariaDB',
		label: DB.MARIADB,
		hasTypes: false,
		hasUnsignedTypes: true
	},
	[DB.MSSQL]: {
		name: 'MSSQL',
		label: DB.MSSQL,
		hasTypes: false
	},
	[DB.ORACLESQL]: {
		name: 'Oracle SQL',
		label: DB.ORACLESQL,
		hasTypes: false,
		hasEnums: false,
		hasArrays: false
	},
	[DB.GENERIC]: {
		name: 'Generic',
		label: DB.GENERIC,
		hasTypes: true
	}
};
