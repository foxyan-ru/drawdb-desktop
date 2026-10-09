/**
 * Per-engine datatype catalog.
 *
 * Port of drawdb.app `src/data/datatypes.js` (web reference, 2259 lines).
 * The type lists, flags and `checkDefault` validators are kept equivalent to
 * the web file — including its quirks (e.g. MSSQL `SMALLMONEY.type === 'MONEY'`,
 * generic `VARCHAR2.defaultSize === 225`) — so diagrams round-trip identically
 * between web and desktop. Shared validators are hoisted into named helpers
 * instead of being repeated inline per type; the per-type data is unchanged.
 *
 * Web uses `new Proxy(obj, { get: … ? … : false })` so a missing key reads as
 * `false`; plain records return `undefined`, which is equally falsy for every
 * call site (`dbToTypes[db][type]?.isSized` etc.).
 */
import { DB } from './constants';

/** The subset of a `Field` that the default-value validators read. */
export interface DefaultCheckField {
	default: string;
	size?: number | string;
	values?: string[];
}

export type CheckDefault = (field: DefaultCheckField) => boolean;

export interface DataTypeInfo {
	type: string;
	color: string;
	checkDefault: CheckDefault;
	hasCheck: boolean;
	isSized: boolean;
	hasPrecision: boolean;
	canIncrement?: boolean;
	defaultSize?: number | null;
	hasQuotes?: boolean;
	noDefault?: boolean;
	/** MySQL/MariaDB integer types that may be declared UNSIGNED. */
	signed?: boolean;
	/** PostgreSQL: integer types that may reference each other in FKs. */
	compatibleWith?: string[];
}

export type TypeMap = Record<string, DataTypeInfo>;

// Color tokens — web `data/constants.js:8-19`. Kept local because only this
// module (and the type-coloured UI that reads `getTypeColor`) consumes them.
export const stringColor = 'text-orange-500';
export const intColor = 'text-yellow-500';
export const decimalColor = 'text-lime-500';
export const booleanColor = 'text-violet-500';
export const binaryColor = 'text-emerald-500';
export const enumSetColor = 'text-sky-500';
export const documentColor = 'text-indigo-500';
export const networkIdColor = 'text-rose-500';
export const geometricColor = 'text-fuchsia-500';
export const vectorColor = 'text-slate-500';
export const otherColor = 'text-zinc-500';
export const dateColor = 'text-cyan-500';

/** web `utils/utils.js:29` — true if the string is wrapped in matching ', " or ` quotes. */
export function strHasQuotes(str: string): boolean {
	if (str.length < 2) return false;
	return (
		(str[0] === str[str.length - 1] && str[0] === "'") ||
		(str[0] === str[str.length - 1] && str[0] === '"') ||
		(str[0] === str[str.length - 1] && str[0] === '`')
	);
}

// ---------------------------------------------------------------------------
// Validators (web datatypes.js:18-20 regexes + the repeated inline closures)
// ---------------------------------------------------------------------------

const intRegex = /^-?\d*$/;
// Faithful to web: the unescaped `.` means "any char" (web datatypes.js:19).
const doubleRegex = /^-?\d*.?\d+$/;
const binaryRegex = /^[01]+$/;
const timeRegex = /^(?:[01]?\d|2[0-3]):[0-5]?\d:[0-5]?\d$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// JS `<=` coerces `size` (number | numeric string | undefined) the same way
// `Number()` does, so the explicit cast keeps web semantics under TS.
const size = (f: DefaultCheckField) => Number(f.size);

const checkAny: CheckDefault = () => true;
const checkInt: CheckDefault = (f) => intRegex.test(f.default);
const checkDouble: CheckDefault = (f) => doubleRegex.test(f.default);
const checkNumber: CheckDefault = (f) => /^-?\d+(\.\d+)?$/.test(f.default);
const checkBit: CheckDefault = (f) => f.default === '1' || f.default === '0';
const checkString: CheckDefault = (f) => {
	if (strHasQuotes(f.default)) {
		return f.default.length - 2 <= size(f);
	}
	return f.default.length <= size(f);
};
const checkBinary: CheckDefault = (f) => f.default.length <= size(f) && binaryRegex.test(f.default);
const checkTime: CheckDefault = (f) => timeRegex.test(f.default);
const checkDate: CheckDefault = (f) => dateRegex.test(f.default);
const checkTimestamp: CheckDefault = (f) => {
	if (f.default.toUpperCase() === 'CURRENT_TIMESTAMP') return true;
	if (!dateTimeRegex.test(f.default)) return false;
	const year = Number.parseInt(f.default.split(' ')[0].split('-')[0]);
	return year >= 1970 && year <= 2038;
};
const checkDateTime: CheckDefault = (f) => {
	if (f.default.toUpperCase() === 'CURRENT_TIMESTAMP') return true;
	if (!dateTimeRegex.test(f.default)) return false;
	const year = Number.parseInt(f.default.split(' ')[0].split('-')[0]);
	return year >= 1000 && year <= 9999;
};
const checkBoolean: CheckDefault = (f) =>
	f.default.toLowerCase() === 'false' ||
	f.default.toLowerCase() === 'true' ||
	f.default === '0' ||
	f.default === '1';
const checkEnum: CheckDefault = (f) => (f.values ?? []).includes(f.default);
const checkSet: CheckDefault = (f) => {
	const defaultValues = f.default.split(',');
	for (let i = 0; i < defaultValues.length; i++) {
		if (!(f.values ?? []).includes(defaultValues[i].trim())) return false;
	}
	return true;
};
// pgvector VECTOR/HALFVEC — web datatypes.js:1278-1294.
const checkVector: CheckDefault = (f) => {
	let elementsStr = f.default;
	try {
		if (strHasQuotes(f.default)) {
			elementsStr = f.default.slice(1, -1);
		}
		const elements = JSON.parse(elementsStr);
		return (
			Array.isArray(elements) &&
			elements.length === size(f) &&
			elements.every((e: unknown) => Number.isFinite(e))
		);
	} catch {
		return false;
	}
};
// pgvector SPARSEVEC `'{1:1,3:2}/5'` — web datatypes.js:1328-1336.
const checkSparseVector: CheckDefault = (f) => {
	let elementsStr = f.default;
	if (strHasQuotes(f.default)) {
		elementsStr = f.default.slice(1, -1);
	}
	const lengthStr = elementsStr.split('/')[1];
	return Number.parseInt(lengthStr) === size(f);
};

// ---------------------------------------------------------------------------
// Generic (web datatypes.js:23 `defaultTypesBase`) — 27 types
// ---------------------------------------------------------------------------

export const defaultTypes: TypeMap = {
	INT: { type: 'INT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	SMALLINT: { type: 'SMALLINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	BIGINT: { type: 'BIGINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	DECIMAL: { type: 'DECIMAL', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	NUMERIC: { type: 'NUMERIC', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	NUMBER: { type: 'NUMBER', color: decimalColor, checkDefault: checkNumber, hasCheck: true, isSized: false, hasPrecision: true, canIncrement: false },
	FLOAT: { type: 'FLOAT', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	DOUBLE: { type: 'DOUBLE', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	REAL: { type: 'REAL', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: false },
	CHAR: { type: 'CHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	VARCHAR: { type: 'VARCHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	// 225 (not 255) is verbatim from web datatypes.js:160.
	VARCHAR2: { type: 'VARCHAR2', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 225, hasQuotes: true },
	TEXT: { type: 'TEXT', color: stringColor, checkDefault: checkAny, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	TIME: { type: 'TIME', color: dateColor, checkDefault: checkTime, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIMESTAMP: { type: 'TIMESTAMP', color: dateColor, checkDefault: checkTimestamp, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATE: { type: 'DATE', color: dateColor, checkDefault: checkDate, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATETIME: { type: 'DATETIME', color: dateColor, checkDefault: checkDateTime, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	BOOLEAN: { type: 'BOOLEAN', color: booleanColor, checkDefault: checkBoolean, hasCheck: false, isSized: false, hasPrecision: false },
	BINARY: { type: 'BINARY', color: binaryColor, checkDefault: checkBinary, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	VARBINARY: { type: 'VARBINARY', color: binaryColor, checkDefault: checkBinary, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	BLOB: { type: 'BLOB', color: binaryColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	CLOB: { type: 'CLOB', color: stringColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	NCLOB: { type: 'NCLOB', color: stringColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	JSON: { type: 'JSON', color: documentColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	UUID: { type: 'UUID', color: networkIdColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: false },
	ENUM: { type: 'ENUM', color: enumSetColor, checkDefault: checkEnum, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	SET: { type: 'SET', color: enumSetColor, checkDefault: checkSet, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true }
};

// ---------------------------------------------------------------------------
// MySQL (web datatypes.js:355 `mysqlTypesBase`) — 39 types
// ---------------------------------------------------------------------------

const geometry = (type: string): DataTypeInfo => ({
	type,
	color: geometricColor,
	checkDefault: checkAny,
	hasCheck: false,
	isSized: false,
	hasPrecision: false,
	noDefault: true
});

export const mysqlTypes: TypeMap = {
	TINYINT: { type: 'TINYINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, signed: true },
	SMALLINT: { type: 'SMALLINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, signed: true },
	MEDIUMINT: { type: 'MEDIUMINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, signed: true },
	INTEGER: { type: 'INTEGER', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, signed: true },
	BIGINT: { type: 'BIGINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, signed: true },
	DECIMAL: { type: 'DECIMAL', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	NUMERIC: { type: 'NUMERIC', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	FLOAT: { type: 'FLOAT', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	DOUBLE: { type: 'DOUBLE', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	BIT: { type: 'BIT', color: binaryColor, checkDefault: checkBit, hasCheck: true, isSized: false, hasPrecision: true },
	BOOLEAN: { type: 'BOOLEAN', color: booleanColor, checkDefault: checkBoolean, hasCheck: false, isSized: false, hasPrecision: false },
	TIME: { type: 'TIME', color: dateColor, checkDefault: checkTime, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIMESTAMP: { type: 'TIMESTAMP', color: dateColor, checkDefault: checkTimestamp, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATE: { type: 'DATE', color: dateColor, checkDefault: checkDate, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATETIME: { type: 'DATETIME', color: dateColor, checkDefault: checkDateTime, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	YEAR: { type: 'YEAR', color: dateColor, checkDefault: (f) => /^\d{4}$/.test(f.default), hasCheck: false, isSized: false, hasPrecision: false },
	CHAR: { type: 'CHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	VARCHAR: { type: 'VARCHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	BINARY: { type: 'BINARY', color: binaryColor, checkDefault: checkBinary, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	VARBINARY: { type: 'VARBINARY', color: binaryColor, checkDefault: checkBinary, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	TINYBLOB: { type: 'TINYBLOB', color: binaryColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	BLOB: { type: 'BLOB', color: binaryColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	MEDIUMBLOB: { type: 'MEDIUMBLOB', color: binaryColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	LONGBLOB: { type: 'LONGBLOB', color: binaryColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	TINYTEXT: { type: 'TINYTEXT', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	TEXT: { type: 'TEXT', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	MEDIUMTEXT: { type: 'MEDIUMTEXT', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	LONGTEXT: { type: 'LONGTEXT', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	ENUM: { type: 'ENUM', color: enumSetColor, checkDefault: checkEnum, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	SET: { type: 'SET', color: enumSetColor, checkDefault: checkSet, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	GEOMETRY: geometry('GEOMETRY'),
	POINT: geometry('POINT'),
	LINESTRING: geometry('LINESTRING'),
	POLYGON: geometry('POLYGON'),
	MULTIPOINT: geometry('MULTIPOINT'),
	MULTILINESTRING: geometry('MULTILINESTRING'),
	MULTIPOLYGON: geometry('MULTIPOLYGON'),
	GEOMETRYCOLLECTION: geometry('GEOMETRYCOLLECTION'),
	JSON: { type: 'JSON', color: documentColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true }
};

// ---------------------------------------------------------------------------
// PostgreSQL (web datatypes.js:820 `postgresTypesBase`) — 44 types
// ---------------------------------------------------------------------------

const pgDateSpecials = ['epoch', 'infinity', '-infinity', 'now', 'today', 'tomorrow', 'yesterday', 'current_date', 'current_timestamp', 'current_time'];
const pgTimestampSpecials = ['epoch', 'infinity', '-infinity', 'now', 'today', 'tomorrow', 'yesterday', 'current_timestamp'];
const pgTimeSpecials = ['now', 'allballs'];
const pgPathRegex = /^\((\d+(\.\d+)?,\d+(\.\d+)?(,\d+(\.\d+)?,\d+(\.\d+)?)*?)\)$/;
const pgLineRegex = /^(\(\d+,\d+\),)+\(\d+,\d+\)$/;

export const postgresTypes: TypeMap = {
	SMALLINT: { type: 'SMALLINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, compatibleWith: ['SMALLSERIAL', 'SERIAL', 'BIGSERIAL', 'INTEGER', 'BIGINT'] },
	INTEGER: { type: 'INTEGER', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, compatibleWith: ['SMALLSERIAL', 'SERIAL', 'BIGSERIAL', 'SMALLINT', 'BIGINT'] },
	BIGINT: { type: 'BIGINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true, compatibleWith: ['SMALLSERIAL', 'SERIAL', 'BIGSERIAL', 'INTEGER', 'SMALLINT'] },
	DECIMAL: { type: 'DECIMAL', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	NUMERIC: { type: 'NUMERIC', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	REAL: { type: 'REAL', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	'DOUBLE PRECISION': { type: 'DOUBLE PRECISION', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	SMALLSERIAL: { type: 'SMALLSERIAL', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, compatibleWith: ['INTEGER', 'SERIAL', 'BIGSERIAL', 'SMALLINT', 'BIGINT'] },
	SERIAL: { type: 'SERIAL', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, compatibleWith: ['INTEGER', 'SMALLSERIAL', 'BIGSERIAL', 'SMALLINT', 'BIGINT'] },
	BIGSERIAL: { type: 'BIGSERIAL', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, compatibleWith: ['INTEGER', 'SERIAL', 'SMALLSERIAL', 'SMALLINT', 'BIGINT'] },
	MONEY: { type: 'MONEY', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	CHAR: { type: 'CHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	VARCHAR: { type: 'VARCHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	// Web validates TEXT against `size` even though it is not sized (datatypes.js:991).
	TEXT: { type: 'TEXT', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: false, hasPrecision: false, hasQuotes: true },
	BYTEA: { type: 'BYTEA', color: binaryColor, checkDefault: (f) => /^[0-9a-fA-F]*$/.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, defaultSize: null, hasQuotes: true },
	DATE: {
		type: 'DATE',
		color: dateColor,
		checkDefault: (f) => dateRegex.test(f.default) || pgDateSpecials.includes(f.default.toLowerCase()),
		hasCheck: false,
		isSized: false,
		hasPrecision: false,
		hasQuotes: true
	},
	TIME: {
		type: 'TIME',
		color: dateColor,
		checkDefault: (f) => timeRegex.test(f.default) || pgTimeSpecials.includes(f.default.toLowerCase()),
		hasCheck: false,
		isSized: false,
		hasPrecision: false,
		hasQuotes: true
	},
	TIMETZ: {
		type: 'TIMETZ',
		color: dateColor,
		checkDefault: (f) =>
			/^(?:[01]?\d|2[0-3]):[0-5]?\d:[0-5]?\d([+-]\d{2}:\d{2})?$/.test(f.default) ||
			pgTimeSpecials.includes(f.default.toLowerCase()),
		hasCheck: false,
		isSized: false,
		hasPrecision: false,
		hasQuotes: true
	},
	TIMESTAMP: {
		type: 'TIMESTAMP',
		color: dateColor,
		// Faithful to web (datatypes.js:1074): the year-range test is OR-ed, not AND-ed.
		checkDefault: (f) => {
			const year = Number.parseInt(f.default.split(' ')[0].split('-')[0]);
			return (
				dateTimeRegex.test(f.default) ||
				(year >= 1970 && year <= 2038) ||
				pgTimestampSpecials.includes(f.default.toLowerCase())
			);
		},
		hasCheck: false,
		isSized: false,
		hasPrecision: false,
		hasQuotes: true
	},
	TIMESTAMPTZ: {
		type: 'TIMESTAMPTZ',
		color: dateColor,
		checkDefault: (f) =>
			/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2})?$/.test(f.default) ||
			pgTimestampSpecials.includes(f.default.toLowerCase()),
		hasCheck: false,
		isSized: false,
		hasPrecision: false,
		hasQuotes: true
	},
	INTERVAL: { type: 'INTERVAL', color: dateColor, checkDefault: (f) => /^['"\d\s\\-]+$/.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	BOOLEAN: { type: 'BOOLEAN', color: booleanColor, checkDefault: (f) => /^(true|false)$/i.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: false },
	POINT: { type: 'POINT', color: geometricColor, checkDefault: (f) => /^\(\d+,\d+\)$/.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: false },
	LINE: { type: 'LINE', color: geometricColor, checkDefault: (f) => pgLineRegex.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: false },
	LSEG: { type: 'LSEG', color: geometricColor, checkDefault: (f) => pgLineRegex.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: false },
	BOX: {
		type: 'BOX',
		color: geometricColor,
		checkDefault: (f) => /^\(\d+(\.\d+)?,\d+(\.\d+)?\),\(\d+(\.\d+)?,\d+(\.\d+)?\)$/.test(f.default),
		hasCheck: false,
		isSized: false,
		hasPrecision: false,
		hasQuotes: true
	},
	PATH: { type: 'PATH', color: geometricColor, checkDefault: (f) => pgPathRegex.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	POLYGON: { type: 'POLYGON', color: geometricColor, checkDefault: (f) => pgPathRegex.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	CIRCLE: {
		type: 'CIRCLE',
		color: geometricColor,
		checkDefault: (f) => /^<\(\d+(\.\d+)?,\d+(\.\d+)?\),\d+(\.\d+)?\\>$/.test(f.default),
		hasCheck: false,
		isSized: false,
		hasPrecision: false,
		hasQuotes: true
	},
	CIDR: { type: 'CIDR', color: networkIdColor, checkDefault: (f) => /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	INET: { type: 'INET', color: networkIdColor, checkDefault: (f) => /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	MACADDR: { type: 'MACADDR', color: networkIdColor, checkDefault: (f) => /^([A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	MACADDR8: { type: 'MACADDR8', color: networkIdColor, checkDefault: (f) => /^([A-Fa-f0-9]{2}:){7}[A-Fa-f0-9]{2}$/.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	BIT: { type: 'BIT', color: binaryColor, checkDefault: (f) => /^[01]{1,}$/.test(f.default), hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: false },
	VARBIT: { type: 'VARBIT', color: binaryColor, checkDefault: (f) => /^[01]*$/.test(f.default), hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: false },
	VECTOR: { type: 'VECTOR', color: vectorColor, checkDefault: checkVector, hasCheck: true, isSized: true, hasPrecision: false, hasQuotes: true },
	HALFVEC: { type: 'HALFVEC', color: vectorColor, checkDefault: checkVector, hasCheck: true, isSized: true, hasPrecision: false, hasQuotes: true },
	SPARSEVEC: { type: 'SPARSEVEC', color: vectorColor, checkDefault: checkSparseVector, hasCheck: true, isSized: true, hasPrecision: false, hasQuotes: true },
	TSVECTOR: { type: 'TSVECTOR', color: otherColor, checkDefault: (f) => /^[A-Za-z0-9: ]*$/.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: false },
	TSQUERY: { type: 'TSQUERY', color: otherColor, checkDefault: (f) => /^[A-Za-z0-9: &|!()]*$/.test(f.default), hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: false },
	JSON: { type: 'JSON', color: documentColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true, noDefault: true },
	JSONB: { type: 'JSONB', color: documentColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true, noDefault: true },
	UUID: {
		type: 'UUID',
		color: networkIdColor,
		checkDefault: (f) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(f.default),
		hasCheck: false,
		isSized: false,
		hasPrecision: false,
		hasQuotes: true,
		noDefault: false
	},
	XML: { type: 'XML', color: documentColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true, noDefault: true }
};

// ---------------------------------------------------------------------------
// SQLite (web datatypes.js:1409 `sqliteTypesBase`) — 11 types
// ---------------------------------------------------------------------------

export const sqliteTypes: TypeMap = {
	INTEGER: { type: 'INTEGER', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	REAL: { type: 'REAL', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	NUMERIC: { type: 'NUMERIC', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	BOOLEAN: { type: 'BOOLEAN', color: booleanColor, checkDefault: checkBoolean, hasCheck: false, isSized: false, hasPrecision: false },
	VARCHAR: { type: 'VARCHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	TEXT: { type: 'TEXT', color: stringColor, checkDefault: checkAny, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	BLOB: { type: 'BLOB', color: binaryColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	TIME: { type: 'TIME', color: dateColor, checkDefault: checkTime, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIMESTAMP: { type: 'TIMESTAMP', color: dateColor, checkDefault: checkTimestamp, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATE: { type: 'DATE', color: dateColor, checkDefault: checkDate, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATETIME: { type: 'DATETIME', color: dateColor, checkDefault: checkDateTime, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true }
};

// ---------------------------------------------------------------------------
// MSSQL / T-SQL (web datatypes.js:1558 `mssqlTypesBase`) — 33 types
// ---------------------------------------------------------------------------

export const mssqlTypes: TypeMap = {
	TINYINT: { type: 'TINYINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	SMALLINT: { type: 'SMALLINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	INTEGER: { type: 'INTEGER', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	BIGINT: { type: 'BIGINT', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	BIT: { type: 'BIT', color: binaryColor, checkDefault: checkBit, hasCheck: true, isSized: false, hasPrecision: true },
	DECIMAL: { type: 'DECIMAL', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	NUMERIC: { type: 'NUMERIC', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	FLOAT: { type: 'FLOAT', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	DOUBLE: { type: 'DOUBLE', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	REAL: { type: 'REAL', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: false },
	MONEY: { type: 'MONEY', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	// `type: 'MONEY'` (and NCHAR→CHAR, NVARCHAR→VARCHAR, NTEXT→TEXT below) is verbatim from web.
	SMALLMONEY: { type: 'MONEY', color: decimalColor, checkDefault: checkDouble, hasCheck: true, isSized: false, hasPrecision: true },
	DATE: { type: 'DATE', color: dateColor, checkDefault: checkDate, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATETIME: { type: 'DATETIME', color: dateColor, checkDefault: checkDateTime, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	DATETIME2: { type: 'DATETIME2', color: dateColor, checkDefault: checkDateTime, hasCheck: false, isSized: false, hasPrecision: true, hasQuotes: true },
	DATETIMEOFFSET: {
		type: 'DATETIMEOFFSET',
		color: dateColor,
		checkDefault: (f) => {
			if (f.default.toUpperCase() === 'CURRENT_TIMESTAMP') return true;
			if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,7})?([+-]\d{2}:\d{2})?$/.test(f.default)) return false;
			const year = Number.parseInt(f.default.split(' ')[0].split('-')[0]);
			return year >= 1000 && year <= 9999;
		},
		hasCheck: false,
		isSized: false,
		hasPrecision: true,
		hasQuotes: true
	},
	SMALLDATETIME: {
		type: 'SMALLDATETIME',
		color: dateColor,
		checkDefault: (f) => {
			if (f.default.toUpperCase() === 'CURRENT_TIMESTAMP') return true;
			if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(f.default)) return false;
			const year = Number.parseInt(f.default.split(' ')[0].split('-')[0]);
			return year >= 1900 && year <= 2079;
		},
		hasCheck: false,
		isSized: false,
		hasPrecision: false,
		hasQuotes: true
	},
	TIME: { type: 'TIME', color: dateColor, checkDefault: checkTime, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIMESTAMP: { type: 'TIMESTAMP', color: dateColor, checkDefault: checkTimestamp, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	CHAR: { type: 'CHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	VARCHAR: { type: 'VARCHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	TEXT: { type: 'TEXT', color: stringColor, checkDefault: checkAny, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	NCHAR: { type: 'CHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	NVARCHAR: { type: 'VARCHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	NTEXT: { type: 'TEXT', color: stringColor, checkDefault: checkAny, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 65535, hasQuotes: true },
	BINARY: { type: 'BINARY', color: binaryColor, checkDefault: checkBinary, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	VARBINARY: { type: 'VARBINARY', color: binaryColor, checkDefault: checkBinary, hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	IMAGE: { type: 'IMAGE', color: binaryColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true, noDefault: true },
	UNIQUEIDENTIFIER: { type: 'UNIQUEIDENTIFIER', color: networkIdColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	XML: { type: 'XML', color: documentColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true, noDefault: true },
	CURSOR: { type: 'CURSOR', color: otherColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: false, noDefault: true },
	SQL_VARIANT: { type: 'SQL_VARIANT', color: otherColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: false, noDefault: true },
	JSON: { type: 'JSON', color: documentColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true, noDefault: true }
};

// ---------------------------------------------------------------------------
// Oracle (web datatypes.js:1979 `oraclesqlTypesBase`) — 19 types
// ---------------------------------------------------------------------------

export const oraclesqlTypes: TypeMap = {
	INTEGER: { type: 'INTEGER', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	NUMBER: { type: 'NUMBER', color: decimalColor, checkDefault: checkNumber, hasCheck: true, isSized: false, hasPrecision: true, canIncrement: false },
	FLOAT: { type: 'FLOAT', color: decimalColor, checkDefault: checkNumber, hasCheck: true, isSized: false, hasPrecision: true },
	LONG: { type: 'LONG', color: intColor, checkDefault: checkInt, hasCheck: true, isSized: false, hasPrecision: false, canIncrement: true },
	VARCHAR2: { type: 'VARCHAR2', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	NVARCHAR2: { type: 'VARCHAR2', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: true },
	CHAR: { type: 'CHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	NCHAR: { type: 'NCHAR', color: stringColor, checkDefault: checkString, hasCheck: true, isSized: true, hasPrecision: false, defaultSize: 1, hasQuotes: true },
	CLOB: { type: 'CLOB', color: stringColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	NCLOB: { type: 'NCLOB', color: stringColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	BLOB: { type: 'BLOB', color: binaryColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	BFILE: { type: 'BFILE', color: otherColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	JSON: { type: 'JSON', color: documentColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	VECTOR: { type: 'VECTOR', color: vectorColor, checkDefault: checkAny, hasCheck: false, isSized: false, hasPrecision: false, noDefault: true },
	DATE: { type: 'DATE', color: dateColor, checkDefault: checkDate, hasCheck: false, isSized: false, hasPrecision: false, hasQuotes: true },
	TIMESTAMP: {
		type: 'TIMESTAMP',
		color: dateColor,
		checkDefault: (f) => {
			if (f.default.toUpperCase() === 'CURRENT_TIMESTAMP') return true;
			return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(f.default);
		},
		hasCheck: false,
		isSized: false,
		hasPrecision: true,
		hasQuotes: true
	},
	INTERVAL: {
		type: 'INTERVAL',
		color: dateColor,
		checkDefault: (f) => /^INTERVAL\s'\d+'(\s+DAY|HOUR|MINUTE|SECOND)?$/.test(f.default),
		hasCheck: false,
		isSized: false,
		hasPrecision: false,
		hasQuotes: true
	},
	BOOLEAN: {
		type: 'BOOLEAN',
		color: booleanColor,
		checkDefault: (f) =>
			f.default === '0' || f.default === '1' || f.default.toUpperCase() === 'TRUE' || f.default.toUpperCase() === 'FALSE',
		hasCheck: false,
		isSized: false,
		hasPrecision: false
	},
	RAW: { type: 'RAW', color: binaryColor, checkDefault: (f) => /^[0-9A-Fa-f]+$/.test(f.default), hasCheck: false, isSized: true, hasPrecision: false, defaultSize: 255, hasQuotes: false }
};

// ---------------------------------------------------------------------------
// MariaDB = MySQL + extras (web datatypes.js:2210-2245) — 39 + 3 = 42 types
// ---------------------------------------------------------------------------

export const mariadbExtraTypes: TypeMap = {
	UUID: { type: 'UUID', color: networkIdColor, checkDefault: checkAny, hasCheck: true, isSized: false, hasPrecision: false, noDefault: false },
	INET4: { type: 'INET4', color: networkIdColor, checkDefault: checkAny, hasCheck: true, isSized: false, hasPrecision: false, noDefault: false },
	INET6: { type: 'INET6', color: networkIdColor, checkDefault: checkAny, hasCheck: true, isSized: false, hasPrecision: false, noDefault: false }
};

export const mariadbTypes: TypeMap = { ...mysqlTypes, ...mariadbExtraTypes };

export const dbToTypes: Record<string, TypeMap> = {
	[DB.GENERIC]: defaultTypes,
	[DB.MYSQL]: mysqlTypes,
	[DB.POSTGRES]: postgresTypes,
	[DB.SQLITE]: sqliteTypes,
	[DB.MSSQL]: mssqlTypes,
	[DB.MARIADB]: mariadbTypes,
	[DB.ORACLESQL]: oraclesqlTypes
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function getTypesForDB(db: string): TypeMap {
	return dbToTypes[db] || defaultTypes;
}

export function getTypeColor(db: string, typeName: string): string {
	return getTypesForDB(db)[typeName]?.color || otherColor;
}

/** Built-in type names for an engine, in web's declaration order (the field type Select's options). */
export function getTypeNames(db: string): string[] {
	return Object.keys(getTypesForDB(db));
}

// web `utils/customTypes.js:77` — used when a field's type is unknown (e.g. a
// user enum/composite type name), so the UI treats it as an opaque value.
const BLOB_FALLBACK: DataTypeInfo = {
	type: 'BLOB',
	color: '',
	checkDefault: () => true,
	hasCheck: false,
	isSized: false,
	hasPrecision: false,
	canIncrement: false,
	noDefault: true
};

/**
 * Metadata for `typeName` on `db`, falling back to the engine's BLOB (or a
 * BLOB-like stub) for unknown names. Port of web `resolveType`
 * (`utils/customTypes.js:89`) minus the localStorage-backed user custom
 * types, which the desktop app does not have.
 */
export function resolveType(db: string, typeName: string): DataTypeInfo {
	const types = getTypesForDB(db);
	return types[typeName] || types['BLOB'] || BLOB_FALLBACK;
}
