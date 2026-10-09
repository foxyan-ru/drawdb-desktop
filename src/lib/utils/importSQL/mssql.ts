import { DB } from '../../data/constants';
import { convertAST, makeTypeResolver, type AstNode, type ImportedDiagram } from './shared';

// Verbatim from drawdb-main/src/utils/importSQL/mssql.js:6-33 (unknown → TEXT).
const resolve = makeTypeResolver(
	{
		[DB.MSSQL]: { INT: 'INTEGER' },
		[DB.GENERIC]: {
			INTEGER: 'INT',
			TINYINT: 'SMALLINT',
			MEDIUMINT: 'INTEGER',
			BIT: 'BOOLEAN',
			DATETIME2: 'DATETIME',
			MONEY: 'NUMERIC',
			SMALLMONEY: 'NUMERIC',
			NCHAR: 'CHAR',
			NVARCHAR: 'VARCHAR',
			NTEXT: 'TEXT',
			IMAGE: 'BLOB',
			XML: 'BLOB',
			DATETIMEOFFSET: 'TEXT',
			SQL_VARIANT: 'TEXT',
			UNIQUEIDENTIFIER: 'UUID',
			SMALLDATETIME: 'DATETIME',
			CURSOR: 'BLOB'
		}
	},
	'TEXT'
);

/**
 * T-SQL AST (node-sql-parser `database: 'transactsql'`) → diagram. `GO`-separated
 * batches arrive as `{ ast, go_next }` chains; `convertAST` walks those.
 */
export function fromMSSQL(ast: AstNode, diagramDb: string = DB.GENERIC): ImportedDiagram {
	return convertAST(ast, diagramDb, {
		db: DB.MSSQL,
		resolveType: (dataType, state) => ({ type: resolve(dataType, state.diagramDb) })
	});
}
