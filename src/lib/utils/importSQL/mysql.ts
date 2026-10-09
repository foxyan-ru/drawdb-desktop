import { DB } from '../../data/constants';
import { convertAST, makeTypeResolver, type AstNode, type ImportedDiagram } from './shared';

// Verbatim from drawdb-main/src/utils/importSQL/mysql.js:6-21 (unknown → BLOB).
const resolve = makeTypeResolver({
	[DB.MYSQL]: { INT: 'INTEGER' },
	[DB.GENERIC]: {
		INTEGER: 'INT',
		TINYINT: 'SMALLINT',
		MEDIUMINT: 'INTEGER',
		BIT: 'BOOLEAN',
		YEAR: 'INTEGER'
	}
});

/** MySQL AST (node-sql-parser `database: 'mysql'`) → diagram. */
export function fromMySQL(ast: AstNode, diagramDb: string = DB.GENERIC): ImportedDiagram {
	return convertAST(ast, diagramDb, {
		db: DB.MYSQL,
		resolveType: (dataType, state) => ({ type: resolve(dataType, state.diagramDb) })
	});
}
