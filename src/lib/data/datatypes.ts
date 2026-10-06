import { DB } from './constants';

export interface DataTypeInfo {
	type: string;
	color: string;
	hasCheck: boolean;
	isSized: boolean;
	hasPrecision: boolean;
	canIncrement?: boolean;
	defaultSize?: number;
	hasQuotes?: boolean;
	noDefault?: boolean;
	signed?: boolean;
}

const intColor = 'text-yellow-500';
const decimalColor = 'text-lime-500';
const stringColor = 'text-orange-500';
const dateColor = 'text-cyan-500';
const booleanColor = 'text-violet-500';
const binaryColor = 'text-emerald-500';
const enumSetColor = 'text-sky-500';
const documentColor = 'text-indigo-500';
const networkIdColor = 'text-rose-500';
const geometricColor = 'text-fuchsia-500';
const otherColor = 'text-zinc-500';

const mysqlTypes: Record<string, DataTypeInfo> = {
	TINYINT: { type: 'TINYINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, signed: true },
	SMALLINT: { type: 'SMALLINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, signed: true },
	MEDIUMINT: { type: 'MEDIUMINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, signed: true },
	INTEGER: { type: 'INTEGER', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, signed: true },
	BIGINT: { type: 'BIGINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, signed: true },
	DECIMAL: { type: 'DECIMAL', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	FLOAT: { type: 'FLOAT', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	DOUBLE: { type: 'DOUBLE', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	BOOLEAN: { type: 'BOOLEAN', color: booleanColor, hasCheck: false, isSized: false, hasPrecision: false },
	CHAR: { type: 'CHAR', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	VARCHAR: { type: 'VARCHAR', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	TEXT: { type: 'TEXT', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	BLOB: { type: 'BLOB', color: binaryColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	DATE: { type: 'DATE', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIME: { type: 'TIME', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATETIME: { type: 'DATETIME', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIMESTAMP: { type: 'TIMESTAMP', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	YEAR: { type: 'YEAR', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false },
	ENUM: { type: 'ENUM', color: enumSetColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	SET: { type: 'SET', color: enumSetColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	JSON: { type: 'JSON', color: documentColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	BINARY: { type: 'BINARY', color: binaryColor, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 1 },
	VARBINARY: { type: 'VARBINARY', color: binaryColor, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 255 }
};

const postgresTypes: Record<string, DataTypeInfo> = {
	SMALLINT: { type: 'SMALLINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	INTEGER: { type: 'INTEGER', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	BIGINT: { type: 'BIGINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	SERIAL: { type: 'SERIAL', color: intColor, hasCheck: true, isSized: false, hasPrecision: false },
	BIGSERIAL: { type: 'BIGSERIAL', color: intColor, hasCheck: true, isSized: false, hasPrecision: false },
	DECIMAL: { type: 'DECIMAL', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	NUMERIC: { type: 'NUMERIC', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	REAL: { type: 'REAL', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	'DOUBLE PRECISION': { type: 'DOUBLE PRECISION', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	CHAR: { type: 'CHAR', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	VARCHAR: { type: 'VARCHAR', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	TEXT: { type: 'TEXT', color: stringColor, hasCheck: true, isSized: false, hasPrecision: false, hasQuotes: true },
	BYTEA: { type: 'BYTEA', color: binaryColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATE: { type: 'DATE', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIME: { type: 'TIME', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIMESTAMP: { type: 'TIMESTAMP', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIMESTAMPTZ: { type: 'TIMESTAMPTZ', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	BOOLEAN: { type: 'BOOLEAN', color: booleanColor, hasCheck: false, isSized: false, hasPrecision: false },
	UUID: { type: 'UUID', color: networkIdColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	JSON: { type: 'JSON', color: documentColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	JSONB: { type: 'JSONB', color: documentColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	POINT: { type: 'POINT', color: geometricColor, hasCheck: false, isSized: false, hasPrecision: false },
	INET: { type: 'INET', color: networkIdColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	MACADDR: { type: 'MACADDR', color: networkIdColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true }
};

const sqliteTypes: Record<string, DataTypeInfo> = {
	INTEGER: { type: 'INTEGER', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	REAL: { type: 'REAL', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	TEXT: { type: 'TEXT', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	BLOB: { type: 'BLOB', color: binaryColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	BOOLEAN: { type: 'BOOLEAN', color: booleanColor, hasCheck: false, isSized: false, hasPrecision: false },
	DATE: { type: 'DATE', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATETIME: { type: 'DATETIME', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIMESTAMP: { type: 'TIMESTAMP', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true }
};

const genericTypes: Record<string, DataTypeInfo> = {
	INT: { type: 'INT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	SMALLINT: { type: 'SMALLINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	BIGINT: { type: 'BIGINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	DECIMAL: { type: 'DECIMAL', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	FLOAT: { type: 'FLOAT', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	DOUBLE: { type: 'DOUBLE', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
	CHAR: { type: 'CHAR', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	VARCHAR: { type: 'VARCHAR', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	TEXT: { type: 'TEXT', color: stringColor, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	BOOLEAN: { type: 'BOOLEAN', color: booleanColor, hasCheck: false, isSized: false, hasPrecision: false },
	DATE: { type: 'DATE', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIME: { type: 'TIME', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATETIME: { type: 'DATETIME', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIMESTAMP: { type: 'TIMESTAMP', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	BLOB: { type: 'BLOB', color: binaryColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	JSON: { type: 'JSON', color: documentColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	UUID: { type: 'UUID', color: networkIdColor, hasCheck: false, isSized: false, hasPrecision: false },
	ENUM: { type: 'ENUM', color: enumSetColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true }
};

export const dbToTypes: Record<string, Record<string, DataTypeInfo>> = {
	[DB.GENERIC]: genericTypes,
	[DB.MYSQL]: mysqlTypes,
	[DB.POSTGRES]: postgresTypes,
	[DB.SQLITE]: sqliteTypes,
	[DB.MSSQL]: {
		TINYINT: { type: 'TINYINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
		SMALLINT: { type: 'SMALLINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
		INTEGER: { type: 'INTEGER', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
		BIGINT: { type: 'BIGINT', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
		DECIMAL: { type: 'DECIMAL', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
		FLOAT: { type: 'FLOAT', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
		CHAR: { type: 'CHAR', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
		VARCHAR: { type: 'VARCHAR', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
		TEXT: { type: 'TEXT', color: stringColor, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
		DATE: { type: 'DATE', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
		DATETIME: { type: 'DATETIME', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
		BIT: { type: 'BIT', color: binaryColor, hasCheck: true, isSized: false, hasPrecision: true },
		XML: { type: 'XML', color: documentColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
		JSON: { type: 'JSON', color: documentColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
		UNIQUEIDENTIFIER: { type: 'UNIQUEIDENTIFIER', color: networkIdColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true }
	},
	[DB.MARIADB]: { ...mysqlTypes },
	[DB.ORACLESQL]: {
		INTEGER: { type: 'INTEGER', color: intColor, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
		NUMBER: { type: 'NUMBER', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
		FLOAT: { type: 'FLOAT', color: decimalColor, hasCheck: true, isSized: false, hasPrecision: true },
		VARCHAR2: { type: 'VARCHAR2', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
		CHAR: { type: 'CHAR', color: stringColor, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
		CLOB: { type: 'CLOB', color: stringColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
		BLOB: { type: 'BLOB', color: binaryColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
		DATE: { type: 'DATE', color: dateColor, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
		TIMESTAMP: { type: 'TIMESTAMP', color: dateColor, hasCheck: false, isSized: false, hasPrecision: true, hasQuotes: true },
		BOOLEAN: { type: 'BOOLEAN', color: booleanColor, hasCheck: false, isSized: false, hasPrecision: false },
		JSON: { type: 'JSON', color: documentColor, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true }
	}
};

export function getTypesForDB(db: string): Record<string, DataTypeInfo> {
	return dbToTypes[db] || genericTypes;
}

export function getTypeColor(db: string, typeName: string): string {
	const types = getTypesForDB(db);
	return types[typeName]?.color || otherColor;
}

export function getTypeNames(db: string): string[] {
	return Object.keys(getTypesForDB(db));
}
