import { DB } from '../../data/constants';
import { convertAST, makeTypeResolver, type AstNode, type ImportedDiagram } from './shared';

// Verbatim from drawdb-main/src/utils/importSQL/sqlite.js:6-38 (unknown → BLOB).
const resolve = makeTypeResolver({
	[DB.SQLITE]: {
		INT: 'INTEGER',
		TINYINT: 'INTEGER',
		SMALLINT: 'INTEGER',
		MEDIUMINT: 'INTEGER',
		BIGINT: 'INTEGER',
		'UNSIGNED BIG INT': 'INTEGER',
		INT2: 'INTEGER',
		INT8: 'INTEGER',
		CHARACTER: 'TEXT',
		NCHARACTER: 'TEXT',
		NVARCHAR: 'VARCHAR',
		DOUBLE: 'REAL',
		FLOAT: 'REAL'
	},
	[DB.GENERIC]: {
		INTEGER: 'INT',
		TINYINT: 'SMALLINT',
		MEDIUMINT: 'INTEGER',
		INT2: 'INTEGER',
		INT8: 'INTEGER',
		CHARACTER: 'TEXT',
		NCHARACTER: 'TEXT',
		NVARCHAR: 'VARCHAR'
	}
});

/** SQLite AST (node-sql-parser `database: 'sqlite'`) → diagram. */
export function fromSQLite(ast: AstNode, diagramDb: string = DB.GENERIC): ImportedDiagram {
	return convertAST(ast, diagramDb, {
		db: DB.SQLITE,
		resolveType: (dataType, state) => ({ type: resolve(dataType, state.diagramDb) })
	});
}
