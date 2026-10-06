export const defaultBlue = '#175e7a';
export const defaultNoteTheme = '#fcf7ac';
export const defaultRelationshipColor = '#808080';
export const noteWidth = 180;
export const noteRadius = 3;
export const noteFold = 24;
export const tableHeaderHeight = 50;
export const tableWidth = 220;
export const gridSize = 24;
export const gridCircleRadius = 0.85;
export const tableFieldHeight = 36;
export const tableColorStripHeight = 7;
export const minAreaSize = 120;
export const keyboardPanStep = 60;

export const Cardinality = {
	ONE_TO_ONE: 'one_to_one',
	ONE_TO_MANY: 'one_to_many',
	MANY_TO_ONE: 'many_to_one'
} as const;

export const Constraint = {
	NONE: 'No action',
	RESTRICT: 'Restrict',
	CASCADE: 'Cascade',
	SET_NULL: 'Set null',
	SET_DEFAULT: 'Set default'
} as const;

export const Tab = {
	TABLES: '1',
	RELATIONSHIPS: '2',
	AREAS: '3',
	NOTES: '4',
	TYPES: '5',
	ENUMS: '6'
} as const;

export const ObjectType = {
	NONE: 0,
	TABLE: 1,
	AREA: 2,
	NOTE: 3,
	RELATIONSHIP: 4,
	TYPE: 5,
	ENUM: 6
} as const;

export const Action = {
	ADD: 0,
	MOVE: 1,
	DELETE: 2,
	EDIT: 3
} as const;

export const State = {
	NONE: 0,
	SAVING: 1,
	SAVED: 2,
	LOADING: 3,
	ERROR: 4,
	FAILED_TO_LOAD: 5
} as const;

export const MODAL = {
	NONE: 0,
	IMG: 1,
	CODE: 2,
	IMPORT: 3,
	RENAME: 4,
	OPEN: 5,
	SAVEAS: 6,
	NEW: 7,
	IMPORT_SRC: 8,
	TABLE_WIDTH: 9,
	LANGUAGE: 10,
	EXPORT_SQL: 11
} as const;

export const DB = {
	MYSQL: 'mysql',
	POSTGRES: 'postgresql',
	MSSQL: 'transactsql',
	SQLITE: 'sqlite',
	MARIADB: 'mariadb',
	ORACLESQL: 'oraclesql',
	GENERIC: 'generic'
} as const;

export type DBType = (typeof DB)[keyof typeof DB];
export type CardinalityType = (typeof Cardinality)[keyof typeof Cardinality];
export type ConstraintType = (typeof Constraint)[keyof typeof Constraint];

export interface Field {
	id: string;
	name: string;
	type: string;
	default: string;
	check: string;
	primary: boolean;
	unique: boolean;
	notNull: boolean;
	increment: boolean;
	comment: string;
	size?: number | string;
	values?: string[];
	unsigned?: boolean;
}

export interface TableIndex {
	name: string;
	fields: string[];
	unique: boolean;
}

export interface Table {
	id: string;
	name: string;
	x: number;
	y: number;
	fields: Field[];
	comment: string;
	indices: TableIndex[];
	uniqueConstraints: { name: string; fields: string[] }[];
	color: string;
	collapsed: boolean;
	locked: boolean;
}

export interface Relationship {
	id: string;
	name: string;
	startTableId: string;
	startFieldId: string;
	endTableId: string;
	endFieldId: string;
	cardinality: CardinalityType;
	updateConstraint: string;
	deleteConstraint: string;
	fields?: { startFieldId: string; endFieldId: string }[];
	color?: string;
}

export interface Area {
	id: number;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color: string;
	locked: boolean;
}

export interface Note {
	id: number;
	x: number;
	y: number;
	title: string;
	content: string;
	color: string;
	height: number;
	width: number;
	locked: boolean;
}

export interface EnumType {
	id: string;
	name: string;
	values: string[];
}

export interface CustomType {
	id: string;
	name: string;
	fields: Field[];
	comment: string;
}
