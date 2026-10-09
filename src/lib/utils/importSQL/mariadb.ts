import { DB } from '../../data/constants';
import { convertAST, makeTypeResolver, type AstNode, type ImportedDiagram } from './shared';

// From drawdb-main/src/utils/importSQL/mariadb.js:6-21 (unknown → BLOB), except
// the GENERIC row: web has `INT: 'INTEGER'` there, which is dead (INT is a
// generic type, so the table is never consulted for it) and leaves INTEGER
// falling through to BLOB. Uses mysql.js's `INTEGER: 'INT'` instead.
const resolve = makeTypeResolver({
	[DB.MARIADB]: { INT: 'INTEGER' },
	[DB.GENERIC]: {
		INTEGER: 'INT',
		TINYINT: 'SMALLINT',
		MEDIUMINT: 'INTEGER',
		BIT: 'BOOLEAN',
		YEAR: 'INTEGER'
	}
});

/** MariaDB AST (node-sql-parser `database: 'mariadb'`) → diagram. */
export function fromMariaDB(ast: AstNode, diagramDb: string = DB.GENERIC): ImportedDiagram {
	return convertAST(ast, diagramDb, {
		db: DB.MARIADB,
		resolveType: (dataType, state) => ({ type: resolve(dataType, state.diagramDb) })
	});
}
