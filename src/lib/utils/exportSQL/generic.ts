import { DB, type CustomType, type Field, type Relationship, type Table } from '../../data/constants';
import { defaultTypes } from '../../data/datatypes';
import {
	escapeQuotes,
	exportFieldComment,
	getInlineForeignKeys,
	getTypeInfo,
	parseDefault,
	shouldEmitCheck,
	uniqueConstraintClause,
	getFkColumnNames,
	type Diagram
} from './shared';
import { appendViews } from '../views';

/**
 * Format a generic type string. No database-specific transformations.
 * Includes size in parentheses if provided and the type is sized/precision
 * (or not in the Generic type list, e.g. when used as the MSSQL/Oracle fallback).
 */
function genericType(field: Field): string {
	const info = getTypeInfo(DB.GENERIC, field.type);
	const sizable = info ? info.isSized || info.hasPrecision : true;
	if (sizable && field.size !== undefined && field.size !== '' && field.size !== null) {
		return `${field.type}(${field.size})`;
	}
	return field.type;
}

/**
 * Format a single field definition for generic SQL.
 * No database-specific features: no UNSIGNED, no AUTO_INCREMENT, no COMMENT.
 */
function formatField(field: Field): string {
	const comment = exportFieldComment(field.comment);

	let def = `${comment}\t"${field.name}" ${genericType(field)}`;

	if (field.notNull) {
		def += ' NOT NULL';
	}
	if (field.unique) {
		def += ' UNIQUE';
	}

	const defaultVal = parseDefault(field, DB.GENERIC);
	if (field.default !== '' && field.default !== undefined && field.default !== null) {
		def += ` DEFAULT ${defaultVal}`;
	}

	if (shouldEmitCheck(field, DB.GENERIC)) {
		def += ` CHECK(${field.check})`;
	}

	return def;
}

/**
 * Generate a CREATE TABLE statement for a single table in generic SQL syntax.
 */
function formatTable(table: Table): string {
	const tableComment =
		table.comment && table.comment !== '' ? `/* ${table.comment} */\n` : '';

	const fields = table.fields.map(formatField).join(',\n');

	const primaryKeys = table.fields.filter((f) => f.primary);
	const pkClause =
		primaryKeys.length > 0
			? `,\n\tPRIMARY KEY(${primaryKeys.map((f) => `"${f.name}"`).join(', ')})`
			: '';

	const ucClause = uniqueConstraintClause(table, (s) => `"${s}"`);

	let sql = `${tableComment}CREATE TABLE IF NOT EXISTS "${table.name}" (\n${fields}${pkClause}${ucClause}\n);\n`;

	// Indices
	if (table.indices && table.indices.length > 0) {
		const indexStatements = table.indices
			.map(
				(idx) =>
					`CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX "${idx.name}"\nON "${table.name}" (${idx.fields.map((f) => `"${f}"`).join(', ')});`
			)
			.join('\n');
		sql += '\n' + indexStatements + '\n';
	}

	return sql;
}

/**
 * Generate a complete generic SQL export for the given diagram.
 * Uses standard SQL syntax without any database-specific features.
 * Foreign keys are expressed as ALTER TABLE statements.
 */
export function exportGenericSQL(diagram: Diagram): string {
	const tableStatements = diagram.tables.map(formatTable).join('\n');

	const fkStatements = diagram.relationships
		.map((r) => {
			const startTable = diagram.tables.find((t) => t.id === r.startTableId);
			const endTable = diagram.tables.find((t) => t.id === r.endTableId);
			if (!startTable || !endTable) return '';

			const { startColumns, endColumns } = getFkColumnNames(r, startTable, endTable);
			if (startColumns.some((c) => !c) || endColumns.some((c) => !c)) return '';

			return (
				`ALTER TABLE "${startTable.name}"\n` +
				`ADD FOREIGN KEY(${startColumns.map((c) => `"${c}"`).join(', ')}) ` +
				`REFERENCES "${endTable.name}"(${endColumns.map((c) => `"${c}"`).join(', ')})\n` +
				`ON UPDATE ${r.updateConstraint.toUpperCase()} ON DELETE ${r.deleteConstraint.toUpperCase()};`
			);
		})
		.filter(Boolean)
		.join('\n');

	const sql = [tableStatements.trim(), fkStatements.trim()].filter(Boolean).join('\n\n') + '\n';
	// Web utils/views.js:268-273 appends CREATE [MATERIALIZED] VIEW statements last.
	return appendViews(sql, diagram, DB.GENERIC);
}

// ===========================================================================
// Generic → dialect transpilers (web "Export source ▸" submenu for Generic
// diagrams). Port of drawdb-main/src/utils/exportSQL/generic.js:12-702
// (`getJsonType`, `generateSchema`, `getTypeString`, `getSQLiteType`,
// `jsonToMySQL/PostgreSQL/SQLite/MariaDB/SQLServer/OracleSQL`).
//
// Desktop deviations from the web original (all to avoid emitting DDL the
// target engine rejects; web output is kept wherever it is valid):
// - Types unknown to the Generic list (custom type names) never crash the
//   lookup (web dereferences `dbToTypes[db][type]` unconditionally).
// - Generic types web never mapped for a dialect get the closest native type
//   (`DIALECT_FALLBACKS` — e.g. VARCHAR2/NUMBER/CLOB outside Oracle).
// - Identifiers referenced in more than one statement (enum `*_t` types,
//   custom types, COMMENT ON targets) are quoted consistently, and literal
//   values are quote-escaped.
// - Relationships whose tables/columns no longer exist are skipped (as in the
//   other desktop exporters) instead of throwing.
// - Views ARE appended in `exportGenericSQL` (web `appendViews`, via utils/views.ts)
//   but NOT in the `exportGenericTo*` transpile targets below: MySQL/Postgres/
//   SQLite could reuse the same `viewDialects` entries, but MariaDB/MSSQL/Oracle
//   would need dialect-specific column quoting this transpiler doesn't share with
//   utils/views.ts. Left as a follow-up; views are skipped for all six targets here.
// ===========================================================================

/** Target dialects a Generic diagram can be transpiled to, in web menu order. */
export const GENERIC_EXPORT_TARGETS = [
	DB.MYSQL,
	DB.POSTGRES,
	DB.SQLITE,
	DB.MARIADB,
	DB.MSSQL,
	DB.ORACLESQL
] as const;

export type GenericExportTarget = (typeof GENERIC_EXPORT_TARGETS)[number];

function hasValue(v: unknown): boolean {
	return v !== '' && v !== undefined && v !== null;
}

/** Whether `type` is one of the built-in Generic types (web `Object.keys(defaultTypes).includes`). */
function isGenericType(type: string): boolean {
	return Object.prototype.hasOwnProperty.call(defaultTypes, type);
}

/** Field types of custom types are stored upper-cased (TablesTab.svelte:55), names are not. */
function findCustomType(diagram: Diagram, type: string): CustomType | undefined {
	const t = type.toLowerCase();
	return (diagram.types || []).find((ct) => ct.name.toLowerCase() === t);
}

function quotedValues(values: string[] | undefined): string {
	return (values ?? []).map((v) => `'${escapeQuotes(String(v))}'`).join(', ');
}

/**
 * Closest native type for Generic types the web mapping passes through
 * unchanged although the target engine has no such type.
 */
const DIALECT_FALLBACKS: Record<string, Record<string, string>> = {
	[DB.MYSQL]: { NUMBER: 'DECIMAL', VARCHAR2: 'VARCHAR', CLOB: 'LONGTEXT', NCLOB: 'LONGTEXT' },
	[DB.POSTGRES]: {
		NUMBER: 'numeric',
		VARCHAR2: 'varchar',
		BLOB: 'bytea',
		CLOB: 'text',
		NCLOB: 'text',
		BINARY: 'bytea',
		VARBINARY: 'bytea'
	},
	[DB.MSSQL]: { NUMBER: 'NUMERIC', VARCHAR2: 'NVARCHAR' },
	[DB.ORACLESQL]: { DOUBLE: 'DOUBLE PRECISION' }
};

/** web generic.js:12-40 — JSON-schema type for a custom-type attribute. */
export function getJsonType(f: Field): string {
	if (!isGenericType(f.type)) {
		return '{ "type" : "object", additionalProperties : true }';
	}
	const values = (f.values ?? []).map((v) => `"${v}"`).join(', ');
	switch (f.type) {
		case 'INT':
		case 'SMALLINT':
		case 'BIGINT':
		case 'DECIMAL':
		case 'NUMERIC':
		case 'REAL':
		case 'FLOAT':
			return '{ "type" : "number" }';
		case 'BOOLEAN':
			return '{ "type" : "boolean" }';
		case 'JSON':
			return '{ "type" : "object", "additionalProperties" : true }';
		case 'ENUM':
			return `{\n\t\t\t\t\t"type" : "string",\n\t\t\t\t\t"enum" : [${values}]\n\t\t\t\t}`;
		case 'SET':
			return `{\n\t\t\t\t\t"type": "array",\n\t\t\t\t\t"items": {\n\t\t\t\t\t\t"type": "string",\n\t\t\t\t\t\t"enum": [${values}]\n\t\t\t\t\t}\n\t\t\t\t}`;
		default:
			return '{ "type" : "string"}';
	}
}

/** web generic.js:42-48 — JSON schema for a custom type (MySQL/MariaDB JSON_SCHEMA_VALID check). */
export function generateSchema(type: CustomType): string {
	return `{\n\t\t\t"$schema": "http://json-schema.org/draft-04/schema#",\n\t\t\t"type": "object",\n\t\t\t"properties": {\n\t\t\t\t${(
		type.fields || []
	)
		.map((f) => `"${f.name}" : ${getJsonType(f)}`)
		.join(',\n\t\t\t\t')}\n\t\t\t},\n\t\t\t"additionalProperties": false\n\t\t}`;
}

/**
 * Map a Generic field type to a type string for `dbms` (web generic.js:50-191).
 * `currentDb` is the diagram's own engine (Generic) whose type metadata
 * (isSized/hasPrecision) decides whether `size` is appended. `baseType`
 * (MSSQL only) drops the inline ENUM CHECK, for `CREATE TYPE … FROM`.
 * MariaDB uses the MySQL mapping, as in web (generic.js:466).
 */
export function getTypeString(
	field: Field,
	currentDb: string = DB.GENERIC,
	dbms: string = DB.MYSQL,
	baseType = false
): string {
	const info = getTypeInfo(currentDb, field.type);
	const size = hasValue(field.size) ? String(field.size).trim() : '';
	const target = dbms === DB.MARIADB ? DB.MYSQL : dbms;
	const name = DIALECT_FALLBACKS[target]?.[field.type] ?? field.type;

	if (target === DB.MYSQL) {
		if (field.type === 'UUID') return 'VARCHAR(36)';
		if (info && (info.isSized || info.hasPrecision)) {
			return `${name}${size ? `(${size})` : ''}`;
		}
		if (field.type === 'SET' || field.type === 'ENUM') {
			// Single-quoted (web uses "…", which breaks under ANSI_QUOTES), like mysql.ts.
			return `${field.type}(${quotedValues(field.values)})`;
		}
		if (!isGenericType(field.type)) return 'JSON';
		return name;
	}

	if (target === DB.POSTGRES) {
		if (field.type === 'SMALLINT' && field.increment) return 'smallserial';
		if (field.type === 'INT' && field.increment) return 'serial';
		if (field.type === 'BIGINT' && field.increment) return 'bigserial';
		if (field.type === 'ENUM') return `"${field.name}_t"`;
		if (field.type === 'SET') return `"${field.name}_t"[]`;
		if (field.type === 'TIMESTAMP') return 'TIMESTAMPTZ';
		if (field.type === 'DATETIME') return 'timestamp';
		// Postgres rejects text(n) and double precision(p); web emits both when a size is set.
		if (field.type === 'TEXT') return 'text';
		if (field.type === 'DOUBLE') return 'double precision';
		if (info?.isSized && size) {
			const type =
				field.type === 'BINARY'
					? 'bit'
					: field.type === 'VARBINARY'
						? 'bit varying'
						: name.toLowerCase();
			return `${type}(${size})`;
		}
		if (info?.hasPrecision && size) {
			return `${name.toLowerCase()}(${size})`;
		}
		return name.toLowerCase();
	}

	if (target === DB.MSSQL) {
		let type = name;
		switch (field.type) {
			case 'ENUM':
				return baseType
					? 'NVARCHAR(255)'
					: `NVARCHAR(255) CHECK([${field.name}] in (${quotedValues(field.values)}))`;
			case 'VARCHAR':
				type = 'NVARCHAR';
				break;
			case 'UUID':
				type = 'UNIQUEIDENTIFIER';
				break;
			case 'DOUBLE':
				type = 'FLOAT';
				break;
			case 'BOOLEAN':
				return 'BIT';
			case 'SET':
				return 'NVARCHAR(255)';
			case 'BLOB':
				return 'VARBINARY(MAX)';
			case 'JSON':
			case 'CLOB':
			case 'NCLOB':
				return 'NVARCHAR(MAX)';
			case 'TEXT':
				return 'TEXT';
		}
		// Web only sizes isSized types and emits "(undefined)" when no size is set;
		// precision types (DECIMAL(10,2), …) keep their size here.
		if (info && (info.isSized || info.hasPrecision) && size) {
			return `${type}(${size})`;
		}
		return type;
	}

	if (target === DB.ORACLESQL) {
		let oracleType: string;
		switch (field.type) {
			case 'BIGINT':
				oracleType = 'NUMBER';
				break;
			case 'VARCHAR':
				oracleType = 'VARCHAR2';
				break;
			case 'TEXT':
				oracleType = 'CLOB';
				break;
			case 'TIME':
			case 'DATETIME':
				oracleType = 'TIMESTAMP';
				break;
			case 'BINARY':
			case 'VARBINARY':
				oracleType = 'RAW';
				break;
			case 'UUID':
				return 'RAW(16)';
			case 'SET':
			case 'ENUM':
				// Quoted to match `CREATE DOMAIN "<name>_t"` (Oracle folds bare names to upper case).
				return `"${field.name}_t"`;
			default:
				oracleType = name;
				break;
		}
		// Web looks the mapped name up in the Generic list only (crashing on RAW);
		// prefer Oracle's own metadata for the mapped name.
		const typeInfo = getTypeInfo(DB.ORACLESQL, oracleType) ?? getTypeInfo(currentDb, oracleType);
		if (typeInfo && (typeInfo.isSized || typeInfo.hasPrecision)) {
			if (oracleType === 'NUMBER') {
				return `${oracleType}${size ? `(${size})` : '(38,0)'}`;
			}
			return `${oracleType}${size ? `(${size})` : ''}`;
		}
		return oracleType;
	}

	return field.type;
}

/** web generic.js:383-414 — SQLite storage-class mapping for a Generic type. */
export function getSQLiteType(field: Field): string {
	switch (field.type) {
		case 'INT':
		case 'SMALLINT':
		case 'BIGINT':
		case 'BOOLEAN':
			return 'INTEGER';
		case 'DECIMAL':
		case 'NUMERIC':
		case 'FLOAT':
		case 'DOUBLE':
		case 'REAL':
			return 'REAL';
		// NUMBER/VARCHAR2/CLOB/NCLOB were added to the Generic list after this
		// mapping was written and fall to BLOB in web; give them their affinity.
		case 'NUMBER':
			return 'NUMERIC';
		case 'CHAR':
		case 'VARCHAR':
		case 'VARCHAR2':
		case 'CLOB':
		case 'NCLOB':
		case 'UUID':
		case 'TEXT':
		case 'DATE':
		case 'TIME':
		case 'TIMESTAMP':
		case 'DATETIME':
		case 'BINARY':
		case 'VARBINARY':
			return 'TEXT';
		case 'ENUM':
			return `TEXT CHECK("${field.name}" in (${quotedValues(field.values)}))`;
		default:
			return 'BLOB';
	}
}

/** ` DEFAULT …` clause, using the Generic type metadata for quoting (web parseDefault(field, obj.database)). */
function defaultClause(field: Field): string {
	return hasValue(field.default) ? ` DEFAULT ${parseDefault(field, DB.GENERIC)}` : '';
}

function checkClause(field: Field, open = 'CHECK('): string {
	return shouldEmitCheck(field, DB.GENERIC) ? ` ${open}${field.check})` : '';
}

/**
 * Resolve each relationship to its tables and column names, skipping dangling
 * ones; `render` formats the dialect's ALTER TABLE statement.
 */
function foreignKeyStatements(
	diagram: Diagram,
	render: (r: Relationship, start: Table, end: Table, startCols: string[], endCols: string[]) => string
): string {
	return diagram.relationships
		.map((r) => {
			const start = diagram.tables.find((t) => t.id === r.startTableId);
			const end = diagram.tables.find((t) => t.id === r.endTableId);
			if (!start || !end) return '';
			const { startColumns, endColumns } = getFkColumnNames(r, start, end);
			if (startColumns.some((c) => !c) || endColumns.some((c) => !c)) return '';
			return render(r, start, end, startColumns, endColumns);
		})
		.filter(Boolean)
		.join('\n');
}

function joinSections(sections: string[]): string {
	return (
		sections
			.map((s) => s.trim())
			.filter(Boolean)
			.join('\n\n') + '\n'
	);
}

function primaryKeyClause(table: Table, quote: (s: string) => string, indent = '\t'): string {
	const pks = table.fields.filter((f) => f.primary);
	return pks.length > 0 ? `,\n${indent}PRIMARY KEY(${pks.map((f) => quote(f.name)).join(', ')})` : '';
}

// --- MySQL / MariaDB (web generic.js:193-257, 457-523) ---------------------

function mysqlFamilyCheck(field: Field, diagram: Diagram): string {
	// web generic.js:209-218: custom-type columns are validated with a JSON schema.
	if (!isGenericType(field.type)) {
		const type = findCustomType(diagram, field.type);
		return type
			? ` CHECK(\n\t\tJSON_SCHEMA_VALID('${escapeQuotes(generateSchema(type))}', \`${field.name}\`))`
			: '';
	}
	return checkClause(field);
}

function tablesToMySQLFamily(diagram: Diagram, createTable: string): string {
	const q = (s: string) => `\`${s}\``;
	const tables = diagram.tables
		.map((table) => {
			const fields = table.fields
				.map(
					(field) =>
						`\t${q(field.name)} ${getTypeString(field, DB.GENERIC, DB.MYSQL)}` +
						`${field.notNull ? ' NOT NULL' : ''}` +
						`${field.increment ? ' AUTO_INCREMENT' : ''}` +
						`${field.unique ? ' UNIQUE' : ''}` +
						defaultClause(field) +
						mysqlFamilyCheck(field, diagram) +
						`${field.comment ? ` COMMENT '${escapeQuotes(field.comment)}'` : ''}`
				)
				.join(',\n');
			const tableComment = table.comment ? ` COMMENT='${escapeQuotes(table.comment)}'` : '';
			let sql = `${createTable} ${q(table.name)} (\n${fields}${primaryKeyClause(table, q)}${uniqueConstraintClause(table, q)}\n)${tableComment};`;
			if (table.indices && table.indices.length > 0) {
				sql +=
					'\n' +
					table.indices
						.map(
							(i) =>
								`CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${q(i.name)}\nON ${q(table.name)} (${i.fields.map(q).join(', ')});`
						)
						.join('\n');
			}
			return sql;
		})
		.join('\n\n');

	const fks = foreignKeyStatements(
		diagram,
		(r, start, end, sc, ec) =>
			`ALTER TABLE ${q(start.name)}\nADD FOREIGN KEY(${sc.map(q).join(', ')}) REFERENCES ${q(end.name)}(${ec.map(q).join(', ')})\n` +
			`ON UPDATE ${r.updateConstraint.toUpperCase()} ON DELETE ${r.deleteConstraint.toUpperCase()};`
	);
	return joinSections([tables, fks]);
}

/** Transpile a Generic diagram to MySQL DDL (web `jsonToMySQL`). */
export function exportGenericToMySQL(diagram: Diagram): string {
	return tablesToMySQLFamily(diagram, 'CREATE TABLE IF NOT EXISTS');
}

/** Transpile a Generic diagram to MariaDB DDL (web `jsonToMariaDB`). */
export function exportGenericToMariaDB(diagram: Diagram): string {
	return tablesToMySQLFamily(diagram, 'CREATE OR REPLACE TABLE');
}

// --- PostgreSQL (web generic.js:259-381) -----------------------------------

function pgEnumTypes(fields: Field[]): string {
	return fields
		.filter((f) => f.type === 'ENUM' || f.type === 'SET')
		.map((f) => `CREATE TYPE "${f.name}_t" AS ENUM (${quotedValues(f.values)});`)
		.join('\n');
}

function pgFieldType(field: Field, diagram: Diagram): string {
	const custom = isGenericType(field.type) ? undefined : findCustomType(diagram, field.type);
	return custom ? `"${custom.name}"` : getTypeString(field, DB.GENERIC, DB.POSTGRES);
}

/** Transpile a Generic diagram to PostgreSQL DDL (web `jsonToPostgreSQL`). */
export function exportGenericToPostgres(diagram: Diagram): string {
	const typeStatements = (diagram.types || [])
		.map((type) => {
			const fields = type.fields || [];
			const composite = `CREATE TYPE "${type.name}" AS (\n${fields
				.map((f) => `\t"${f.name}" ${pgFieldType(f, diagram)}`)
				.join(',\n')}\n);`;
			const comment =
				type.comment && type.comment.trim() !== ''
					? `\n\nCOMMENT ON TYPE "${type.name}" IS '${escapeQuotes(type.comment)}';`
					: '';
			return [pgEnumTypes(fields), composite + comment].filter(Boolean).join('\n');
		})
		.join('\n\n');

	const tableStatements = diagram.tables
		.map((table) => {
			const fields = table.fields
				.map(
					(field) =>
						`${exportFieldComment(field.comment)}\t"${field.name}" ${pgFieldType(field, diagram)}` +
						`${field.notNull ? ' NOT NULL' : ''}` +
						`${field.unique ? ' UNIQUE' : ''}` +
						defaultClause(field) +
						checkClause(field)
				)
				.join(',\n');
			const create = `CREATE TABLE IF NOT EXISTS "${table.name}" (\n${fields}${primaryKeyClause(table, (s) => `"${s}"`)}${uniqueConstraintClause(table, (s) => `"${s}"`)}\n);`;
			const comments = [
				table.comment && table.comment.trim() !== ''
					? `COMMENT ON TABLE "${table.name}" IS '${escapeQuotes(table.comment)}';`
					: '',
				...table.fields.map((field) =>
					field.comment && field.comment.trim() !== ''
						? `COMMENT ON COLUMN "${table.name}"."${field.name}" IS '${escapeQuotes(field.comment)}';`
						: ''
				)
			]
				.filter(Boolean)
				.join('\n');
			const indices = (table.indices || [])
				.map(
					(i) =>
						`CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX "${i.name}"\nON "${table.name}" (${i.fields.map((f) => `"${f}"`).join(', ')});`
				)
				.join('\n');
			return [pgEnumTypes(table.fields), create, comments, indices].filter(Boolean).join('\n\n');
		})
		.join('\n\n');

	const fks = foreignKeyStatements(
		diagram,
		(r, start, end, sc, ec) =>
			`ALTER TABLE "${start.name}"\nADD FOREIGN KEY(${sc.map((c) => `"${c}"`).join(', ')}) REFERENCES "${end.name}"(${ec.map((c) => `"${c}"`).join(', ')})\n` +
			`ON UPDATE ${r.updateConstraint.toUpperCase()} ON DELETE ${r.deleteConstraint.toUpperCase()};`
	);
	return joinSections([typeStatements, tableStatements, fks]);
}

// --- SQLite (web generic.js:416-455) ---------------------------------------

/** Transpile a Generic diagram to SQLite DDL (web `jsonToSQLite`); FKs are inline. */
export function exportGenericToSQLite(diagram: Diagram): string {
	const q = (s: string) => `"${s}"`;
	return joinSections([
		diagram.tables
			.map((table) => {
				const inlineFK = getInlineForeignKeys(table, diagram, q);
				const fields = table.fields
					.map(
						(field) =>
							`${exportFieldComment(field.comment)}\t${q(field.name)} ${getSQLiteType(field)}` +
							`${field.notNull ? ' NOT NULL' : ''}` +
							`${field.unique ? ' UNIQUE' : ''}` +
							defaultClause(field) +
							checkClause(field)
					)
					.join(',\n');
				const comment = table.comment ? `/* ${table.comment} */\n` : '';
				let sql = `${comment}CREATE TABLE IF NOT EXISTS ${q(table.name)} (\n${fields}${primaryKeyClause(table, q)}${inlineFK ? ',\n' + inlineFK : ''}${uniqueConstraintClause(table, q)}\n);`;
				if (table.indices && table.indices.length > 0) {
					sql +=
						'\n' +
						table.indices
							.map(
								(i) =>
									`\nCREATE ${i.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${q(i.name)}\nON ${q(table.name)} (${i.fields.map(q).join(', ')});`
							)
							.join('\n');
				}
				return sql;
			})
			.join('\n\n')
	]);
}

// --- SQL Server (web generic.js:525-601) -----------------------------------

/** Transpile a Generic diagram to SQL Server (T-SQL) DDL (web `jsonToSQLServer`). */
export function exportGenericToMSSQL(diagram: Diagram): string {
	const q = (s: string) => `[${s}]`;
	const types = (diagram.types || [])
		.filter((type) => (type.fields || []).length > 0)
		.map(
			(type) =>
				`${type.comment ? `/**\n${type.comment}\n*/\n` : ''}CREATE TYPE ${q(type.name)} FROM ${getTypeString(type.fields[0], DB.GENERIC, DB.MSSQL, true)};\nGO`
		)
		.join('\n\n');

	const tables = diagram.tables
		.map((table) => {
			const fields = table.fields
				.map((field) => {
					const custom = isGenericType(field.type) ? undefined : findCustomType(diagram, field.type);
					const type = custom ? q(custom.name) : getTypeString(field, DB.GENERIC, DB.MSSQL);
					return (
						`${exportFieldComment(field.comment)}\t${q(field.name)} ${type}` +
						`${field.notNull ? ' NOT NULL' : ''}` +
						`${field.increment ? ' IDENTITY' : ''}` +
						`${field.unique ? ' UNIQUE' : ''}` +
						defaultClause(field) +
						checkClause(field)
					);
				})
				.join(',\n');
			const comment = table.comment ? `/**\n${table.comment}\n*/\n` : '';
			let sql = `${comment}CREATE TABLE ${q(table.name)} (\n${fields}${primaryKeyClause(table, q)}${uniqueConstraintClause(table, q)}\n);\nGO`;
			for (const i of table.indices || []) {
				sql += `\n\nCREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${q(i.name)}\nON ${q(table.name)} (${i.fields.map(q).join(', ')});\nGO`;
			}
			return sql;
		})
		.join('\n\n');

	const fks = foreignKeyStatements(
		diagram,
		(r, start, end, sc, ec) =>
			`ALTER TABLE ${q(start.name)}\nADD FOREIGN KEY(${sc.map(q).join(', ')}) REFERENCES ${q(end.name)}(${ec.map(q).join(', ')})\n` +
			`ON UPDATE ${r.updateConstraint.toUpperCase()} ON DELETE ${r.deleteConstraint.toUpperCase()};\nGO`
	);
	return joinSections([types, tables, fks]);
}

// --- Oracle (web generic.js:603-678) ---------------------------------------

/** Transpile a Generic diagram to Oracle DDL (web `jsonToOracleSQL`). */
export function exportGenericToOracle(diagram: Diagram): string {
	const q = (s: string) => `"${s}"`;
	const tables = diagram.tables
		.map((table) => {
			const domains = table.fields
				.filter((f) => f.type === 'ENUM' || f.type === 'SET')
				.map((f) => `CREATE DOMAIN "${f.name}_t" AS ENUM (${quotedValues(f.values)});`)
				.join('\n');
			const fields = table.fields
				.map(
					(field) =>
						`${field.comment ? `  -- ${field.comment.split('\n').join('\n  -- ')}\n` : ''}  ${q(field.name)} ${getTypeString(field, DB.GENERIC, DB.ORACLESQL)}` +
						// Identity clause before inline constraints: Oracle's column grammar
						// rejects web's "NOT NULL GENERATED ALWAYS AS IDENTITY" order.
						`${field.increment ? ' GENERATED ALWAYS AS IDENTITY' : ''}` +
						`${field.notNull ? ' NOT NULL' : ''}` +
						`${field.unique ? ' UNIQUE' : ''}` +
						defaultClause(field) +
						checkClause(field, 'CHECK (')
				)
				.join(',\n');
			const comment = table.comment ? `/* ${table.comment} */\n` : '';
			const pks = table.fields.filter((f) => f.primary);
			const pk = pks.length > 0 ? `,\n  PRIMARY KEY (${pks.map((f) => q(f.name)).join(', ')})` : '';
			let sql = `${comment}CREATE TABLE ${q(table.name)} (\n${fields}${pk}${uniqueConstraintClause(table, q)}\n);`;
			for (const i of table.indices || []) {
				sql += `\n\nCREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${q(i.name)}\n  ON ${q(table.name)} (${i.fields.map(q).join(', ')});`;
			}
			return [domains, sql].filter(Boolean).join('\n\n');
		})
		.join('\n\n');

	// Oracle has no ON UPDATE clause; web emits a named constraint without referential actions.
	const fks = foreignKeyStatements(
		diagram,
		(r, start, end, sc, ec) =>
			`ALTER TABLE ${q(start.name)}\nADD ${r.name ? `CONSTRAINT ${q(r.name)} ` : ''}FOREIGN KEY (${sc.map(q).join(', ')}) REFERENCES ${q(end.name)}(${ec.map(q).join(', ')});`
	);
	return joinSections([tables, fks]);
}

/**
 * Transpile a Generic diagram to `target`'s DDL — the entry point for an
 * "Export source ▸ <dialect>" picker. Unknown targets (incl. Generic itself)
 * get the plain Generic export.
 */
export function transpileGeneric(target: string, diagram: Diagram): string {
	switch (target) {
		case DB.MYSQL:
			return exportGenericToMySQL(diagram);
		case DB.POSTGRES:
			return exportGenericToPostgres(diagram);
		case DB.SQLITE:
			return exportGenericToSQLite(diagram);
		case DB.MARIADB:
			return exportGenericToMariaDB(diagram);
		case DB.MSSQL:
			return exportGenericToMSSQL(diagram);
		case DB.ORACLESQL:
			return exportGenericToOracle(diagram);
		default:
			return exportGenericSQL(diagram);
	}
}
