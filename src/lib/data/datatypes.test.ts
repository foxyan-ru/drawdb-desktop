import { describe, expect, test } from 'bun:test';
import { DB } from './constants';
import {
	dbToTypes,
	getTypeColor,
	getTypeNames,
	getTypesForDB,
	otherColor,
	resolveType,
	strHasQuotes,
	vectorColor,
	type DefaultCheckField
} from './datatypes';

const check = (db: string, type: string, field: Partial<DefaultCheckField>) =>
	dbToTypes[db][type].checkDefault({ default: '', ...field });

describe('per-engine type lists (parity with drawdb.app data/datatypes.js)', () => {
	test('type counts match the web reference', () => {
		expect(getTypeNames(DB.GENERIC).length).toBe(27);
		expect(getTypeNames(DB.MYSQL).length).toBe(39);
		expect(getTypeNames(DB.POSTGRES).length).toBe(44);
		expect(getTypeNames(DB.SQLITE).length).toBe(11);
		expect(getTypeNames(DB.MSSQL).length).toBe(33);
		expect(getTypeNames(DB.ORACLESQL).length).toBe(19);
		// MariaDB = MySQL + UUID, INET4, INET6
		expect(getTypeNames(DB.MARIADB).length).toBe(42);
	});

	test('every engine is registered and keys are unique per engine', () => {
		for (const db of Object.values(DB)) {
			const names = getTypeNames(db);
			expect(names.length).toBeGreaterThan(0);
			expect(new Set(names).size).toBe(names.length);
		}
	});

	test('membership: engine-specific types live on the right engine', () => {
		expect(getTypeNames(DB.GENERIC)).toContain('INT');
		expect(getTypeNames(DB.GENERIC)).toContain('SET');
		expect(getTypeNames(DB.MYSQL)).toContain('MEDIUMINT');
		expect(getTypeNames(DB.MYSQL)).toContain('GEOMETRYCOLLECTION');
		expect(getTypeNames(DB.MYSQL)).not.toContain('UUID');
		expect(getTypeNames(DB.POSTGRES)).toContain('DOUBLE PRECISION');
		expect(getTypeNames(DB.POSTGRES)).toContain('JSONB');
		expect(getTypeNames(DB.POSTGRES)).toContain('SPARSEVEC');
		expect(getTypeNames(DB.POSTGRES)).not.toContain('INT');
		expect(getTypeNames(DB.SQLITE)).toEqual([
			'INTEGER',
			'REAL',
			'NUMERIC',
			'BOOLEAN',
			'VARCHAR',
			'TEXT',
			'BLOB',
			'TIME',
			'TIMESTAMP',
			'DATE',
			'DATETIME'
		]);
		expect(getTypeNames(DB.MSSQL)).toContain('UNIQUEIDENTIFIER');
		expect(getTypeNames(DB.MSSQL)).toContain('SQL_VARIANT');
		expect(getTypeNames(DB.ORACLESQL)).toContain('VARCHAR2');
		expect(getTypeNames(DB.ORACLESQL)).toContain('BFILE');
		for (const name of ['MEDIUMINT', 'UUID', 'INET4', 'INET6']) {
			expect(getTypeNames(DB.MARIADB)).toContain(name);
		}
	});

	test('unknown engine falls back to the generic list', () => {
		expect(getTypesForDB('nope')).toBe(dbToTypes[DB.GENERIC]);
	});
});

describe('type metadata', () => {
	test('sizing / precision / increment flags', () => {
		expect(dbToTypes[DB.MYSQL].VARCHAR.isSized).toBe(true);
		expect(dbToTypes[DB.MYSQL].VARCHAR.defaultSize).toBe(255);
		expect(dbToTypes[DB.MYSQL].DECIMAL.hasPrecision).toBe(true);
		expect(dbToTypes[DB.MYSQL].INTEGER.canIncrement).toBe(true);
		expect(dbToTypes[DB.MYSQL].INTEGER.signed).toBe(true);
		expect(dbToTypes[DB.MARIADB].BIGINT.signed).toBe(true);
		expect(dbToTypes[DB.POSTGRES].SERIAL.canIncrement).toBeUndefined();
		expect(dbToTypes[DB.POSTGRES].INTEGER.compatibleWith).toContain('SERIAL');
		expect(dbToTypes[DB.POSTGRES].JSONB.noDefault).toBe(true);
		expect(dbToTypes[DB.POSTGRES].VECTOR.color).toBe(vectorColor);
	});

	test('verbatim web quirks are preserved', () => {
		expect(dbToTypes[DB.MSSQL].SMALLMONEY.type).toBe('MONEY');
		expect(dbToTypes[DB.MSSQL].NVARCHAR.type).toBe('VARCHAR');
		expect(dbToTypes[DB.GENERIC].VARCHAR2.defaultSize).toBe(225);
	});

	test('getTypeColor / resolveType fall back for unknown types', () => {
		expect(getTypeColor(DB.MYSQL, 'INTEGER')).toBe('text-yellow-500');
		expect(getTypeColor(DB.MYSQL, 'NOT_A_TYPE')).toBe(otherColor);
		expect(resolveType(DB.MYSQL, 'MY_ENUM').type).toBe('BLOB');
		expect(resolveType(DB.MYSQL, 'MY_ENUM').noDefault).toBe(true);
		// Postgres has no BLOB → BLOB-like stub
		const pg = resolveType(DB.POSTGRES, 'mood');
		expect(pg.type).toBe('BLOB');
		expect(pg.canIncrement).toBe(false);
		expect(resolveType(DB.POSTGRES, 'VARCHAR').isSized).toBe(true);
	});
});

describe('checkDefault validators', () => {
	test('strHasQuotes', () => {
		expect(strHasQuotes("'a'")).toBe(true);
		expect(strHasQuotes('"a"')).toBe(true);
		expect(strHasQuotes('`a`')).toBe(true);
		expect(strHasQuotes("'a\"")).toBe(false);
		expect(strHasQuotes("'")).toBe(false);
	});

	test('integers', () => {
		expect(check(DB.MYSQL, 'INTEGER', { default: '42' })).toBe(true);
		expect(check(DB.MYSQL, 'INTEGER', { default: '-7' })).toBe(true);
		expect(check(DB.MYSQL, 'INTEGER', { default: '4.2' })).toBe(false);
		expect(check(DB.MYSQL, 'INTEGER', { default: 'abc' })).toBe(false);
	});

	test('sized strings honour size and ignore wrapping quotes', () => {
		expect(check(DB.MYSQL, 'VARCHAR', { default: 'abc', size: 3 })).toBe(true);
		expect(check(DB.MYSQL, 'VARCHAR', { default: "'abc'", size: 3 })).toBe(true);
		expect(check(DB.MYSQL, 'VARCHAR', { default: 'abcd', size: 3 })).toBe(false);
		expect(check(DB.MYSQL, 'CHAR', { default: 'ab', size: '2' })).toBe(true);
	});

	test('booleans', () => {
		expect(check(DB.MYSQL, 'BOOLEAN', { default: 'TRUE' })).toBe(true);
		expect(check(DB.MYSQL, 'BOOLEAN', { default: '0' })).toBe(true);
		expect(check(DB.MYSQL, 'BOOLEAN', { default: 'yes' })).toBe(false);
		// Postgres only accepts true/false
		expect(check(DB.POSTGRES, 'BOOLEAN', { default: 'false' })).toBe(true);
		expect(check(DB.POSTGRES, 'BOOLEAN', { default: '1' })).toBe(false);
	});

	test('dates and timestamps', () => {
		expect(check(DB.MYSQL, 'DATE', { default: '2024-01-31' })).toBe(true);
		expect(check(DB.MYSQL, 'DATE', { default: '31/01/2024' })).toBe(false);
		expect(check(DB.MYSQL, 'TIMESTAMP', { default: 'current_timestamp' })).toBe(true);
		expect(check(DB.MYSQL, 'TIMESTAMP', { default: '2024-01-31 10:00:00' })).toBe(true);
		expect(check(DB.MYSQL, 'TIMESTAMP', { default: '2040-01-31 10:00:00' })).toBe(false);
		expect(check(DB.MYSQL, 'DATETIME', { default: '2040-01-31 10:00:00' })).toBe(true);
		expect(check(DB.POSTGRES, 'DATE', { default: 'today' })).toBe(true);
		expect(check(DB.MYSQL, 'TIME', { default: '23:59:59' })).toBe(true);
		expect(check(DB.MYSQL, 'TIME', { default: '24:00:00' })).toBe(false);
	});

	test('enum and set values', () => {
		expect(check(DB.MYSQL, 'ENUM', { default: 'a', values: ['a', 'b'] })).toBe(true);
		expect(check(DB.MYSQL, 'ENUM', { default: 'c', values: ['a', 'b'] })).toBe(false);
		expect(check(DB.MYSQL, 'SET', { default: 'a, b', values: ['a', 'b'] })).toBe(true);
		expect(check(DB.MYSQL, 'SET', { default: 'a,c', values: ['a', 'b'] })).toBe(false);
		// Missing values array does not throw
		expect(check(DB.MYSQL, 'ENUM', { default: 'a' })).toBe(false);
	});

	test('binary, uuid and vector types', () => {
		expect(check(DB.MYSQL, 'BINARY', { default: '101', size: 3 })).toBe(true);
		expect(check(DB.MYSQL, 'BINARY', { default: '102', size: 3 })).toBe(false);
		expect(check(DB.POSTGRES, 'UUID', { default: '123e4567-e89b-12d3-a456-426614174000' })).toBe(true);
		expect(check(DB.POSTGRES, 'UUID', { default: 'not-a-uuid' })).toBe(false);
		expect(check(DB.POSTGRES, 'VECTOR', { default: "'[1,2,3]'", size: 3 })).toBe(true);
		expect(check(DB.POSTGRES, 'VECTOR', { default: '[1,2]', size: 3 })).toBe(false);
		expect(check(DB.POSTGRES, 'VECTOR', { default: 'garbage', size: 3 })).toBe(false);
		expect(check(DB.POSTGRES, 'SPARSEVEC', { default: "'{1:1,3:2}/5'", size: 5 })).toBe(true);
	});
});
