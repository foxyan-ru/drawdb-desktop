import { describe, expect, test } from 'bun:test';
import {
	calcCompositePath,
	calcPath,
	fieldAnchorY,
	getRelationshipFieldPairs,
	getVisibleFieldIndex,
	getVisibleFields,
	isFieldLinked
} from './calcPath';
import {
	Cardinality,
	Constraint,
	tableColorStripHeight,
	tableFieldHeight,
	tableHeaderHeight,
	type Field,
	type Relationship,
	type Table
} from '../data/constants';

function field(id: string): Field {
	return {
		id,
		name: id,
		type: 'INTEGER',
		default: '',
		check: '',
		primary: false,
		unique: false,
		notNull: false,
		increment: false,
		comment: ''
	};
}

function table(id: string, fieldIds: string[], collapsed = false): Table {
	return {
		id,
		name: id,
		x: 0,
		y: 0,
		fields: fieldIds.map(field),
		comment: '',
		indices: [],
		uniqueConstraints: [],
		color: '#175e7a',
		collapsed,
		locked: false
	};
}

function rel(
	startTableId: string,
	startFieldId: string,
	endTableId: string,
	endFieldId: string,
	fields?: { startFieldId: string; endFieldId: string }[]
): Relationship {
	return {
		id: `${startTableId}.${startFieldId}->${endTableId}.${endFieldId}`,
		name: 'r',
		startTableId,
		startFieldId,
		endTableId,
		endFieldId,
		cardinality: Cardinality.MANY_TO_ONE,
		updateConstraint: Constraint.NONE,
		deleteConstraint: Constraint.NONE,
		fields
	};
}

// Row centre for index i on a table at y = 0.
const rowY = (i: number) => tableColorStripHeight + tableHeaderHeight + i * tableFieldHeight + tableFieldHeight / 2;

describe('visible field helpers', () => {
	const orders = table('orders', ['id', 'note', 'user_id', 'created_at']);
	const users = table('users', ['id', 'email']);
	const rels = [rel('orders', 'user_id', 'users', 'id')];

	test('expanded table: visible index equals the raw index', () => {
		expect(getVisibleFieldIndex(orders, 'user_id', rels)).toBe(2);
		expect(getVisibleFields(orders, rels)).toHaveLength(4);
	});

	test('collapsed table: index is counted over linked fields only', () => {
		const collapsed = { ...orders, collapsed: true };
		expect(getVisibleFields(collapsed, rels).map((f) => f.id)).toEqual(['user_id']);
		// Raw index is 2, but it is the first (and only) rendered row.
		expect(getVisibleFieldIndex(collapsed, 'user_id', rels)).toBe(0);
		// Unlinked fields aren't rendered at all.
		expect(getVisibleFieldIndex(collapsed, 'note', rels)).toBe(-1);
	});

	test('a field is only linked on the side of the relationship it belongs to', () => {
		expect(isFieldLinked('users', 'id', rels)).toBe(true);
		expect(isFieldLinked('orders', 'id', rels)).toBe(false);
		expect(getVisibleFieldIndex({ ...users, collapsed: true }, 'id', rels)).toBe(0);
	});

	test('every column of a composite FK counts as linked', () => {
		const lines = table('lines', ['id', 'order_id', 'order_rev'], true);
		const head = table('head', ['id', 'rev']);
		const composite = rel('lines', 'order_id', 'head', 'id', [
			{ startFieldId: 'order_id', endFieldId: 'id' },
			{ startFieldId: 'order_rev', endFieldId: 'rev' }
		]);
		expect(getVisibleFields(lines, [composite]).map((f) => f.id)).toEqual(['order_id', 'order_rev']);
		expect(getRelationshipFieldPairs(composite)).toHaveLength(2);
		expect(getRelationshipFieldPairs(rels[0])).toEqual([{ startFieldId: 'user_id', endFieldId: 'id' }]);
	});
});

describe('fieldAnchorY', () => {
	test('centres on the row and clamps a missing field to the first row', () => {
		expect(fieldAnchorY({ y: 100 }, 1)).toBe(100 + rowY(1));
		expect(fieldAnchorY({ y: 0 }, -1)).toBe(rowY(0));
	});
});

describe('calcPath', () => {
	test('returns an empty path for missing input', () => {
		expect(calcPath(null)).toBe('');
	});

	test('aligned rows, start table on the left: straight line right edge → left edge', () => {
		const d = calcPath({
			startTable: { x: 0, y: 0, width: 220 },
			endTable: { x: 400, y: 0, width: 220 },
			startFieldIndex: 0,
			endFieldIndex: 0
		});
		expect(d).toBe(`M 220 ${rowY(0)} L 400 ${rowY(0) + 0.1}`);
	});

	test('aligned rows, start table on the right: straight line left edge → right edge', () => {
		const d = calcPath({
			startTable: { x: 400, y: 0, width: 220 },
			endTable: { x: 0, y: 0, width: 220 },
			startFieldIndex: 0,
			endFieldIndex: 0
		});
		expect(d).toBe(`M 400 ${rowY(0)} L 220 ${rowY(0) + 0.1}`);
	});

	test('different rows: starts and ends on the anchors of the given visible indices', () => {
		const d = calcPath({
			startTable: { x: 0, y: 0, width: 220 },
			endTable: { x: 400, y: 200, width: 220 },
			startFieldIndex: 2,
			endFieldIndex: 1
		});
		expect(d.startsWith(`M 220 ${rowY(2)} `)).toBe(true);
		expect(d.endsWith(`L 400 ${200 + rowY(1)}`)).toBe(true);
	});

	test('honours different start/end widths', () => {
		const d = calcPath({
			startTable: { x: 0, y: 0, width: 300 },
			endTable: { x: 500, y: 0, width: 220 },
			startFieldIndex: 0,
			endFieldIndex: 0
		});
		expect(d.startsWith('M 300 ')).toBe(true);
	});
});

describe('calcCompositePath', () => {
	test('returns null without field indices', () => {
		expect(
			calcCompositePath({
				startTable: { x: 0, y: 0, width: 220 },
				endTable: { x: 400, y: 0, width: 220 },
				startFieldIndices: [],
				endFieldIndices: []
			})
		).toBeNull();
	});

	test('forks every column into one trunk between facing edges', () => {
		const res = calcCompositePath({
			startTable: { x: 0, y: 0, width: 220 },
			endTable: { x: 400, y: 0, width: 220 },
			startFieldIndices: [0, 2],
			endFieldIndices: [0, 2]
		});
		expect(res).not.toBeNull();
		// 2 start branches + 1 trunk + 2 end branches.
		expect(res!.path.match(/M /g)).toHaveLength(5);
		// Collectors sit `fork` (24px) outside the facing edges, at the mid-height of the columns.
		const trunkY = (rowY(0) + rowY(2)) / 2;
		expect(res!.startCardinality).toEqual({ x: 220 + 24, y: trunkY });
		expect(res!.endCardinality).toEqual({ x: 400 - 24, y: trunkY });
		expect(res!.labelPoint).toEqual({ x: (244 + 376) / 2, y: trunkY });
	});

	test('mirrors when the start table is on the right', () => {
		const res = calcCompositePath({
			startTable: { x: 400, y: 0, width: 220 },
			endTable: { x: 0, y: 0, width: 220 },
			startFieldIndices: [0, 1],
			endFieldIndices: [0, 1]
		});
		expect(res!.startCardinality.x).toBe(400 - 24);
		expect(res!.endCardinality.x).toBe(220 + 24);
	});
});
