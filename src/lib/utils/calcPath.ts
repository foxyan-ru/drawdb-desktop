import {
	tableHeaderHeight,
	tableFieldHeight,
	tableColorStripHeight,
	tableWidth,
	type Table,
	type Relationship
} from '$lib/data/constants';

export interface PathResult {
	path: string;
	startX: number;
	startY: number;
	endX: number;
	endY: number;
}

/**
 * Calculate the Y position of a field within a table, given its index.
 */
function fieldY(table: Table, fieldIndex: number): number {
	return (
		table.y +
		tableColorStripHeight +
		tableHeaderHeight +
		fieldIndex * tableFieldHeight +
		tableFieldHeight / 2
	);
}

/**
 * Find the index of a field within a table by its ID.
 * Returns 0 if the field is not found.
 */
function findFieldIndex(table: Table, fieldId: string): number {
	const idx = table.fields.findIndex((f) => f.id === fieldId);
	return idx >= 0 ? idx : 0;
}

/**
 * Calculate an SVG path (cubic bezier) for a relationship line between two tables.
 *
 * The path exits from the side of the start table facing the end table (right side
 * if the start table is to the left of the end table, left side otherwise) and
 * enters the end table from the opposite side.
 *
 * Control points are offset horizontally by max(abs(startX - endX) * 0.4, 60).
 */
export function calcPath(
	relationship: Relationship,
	tables: Table[]
): PathResult {
	const startTable = tables.find((t) => t.id === relationship.startTableId);
	const endTable = tables.find((t) => t.id === relationship.endTableId);

	if (!startTable || !endTable) {
		return { path: '', startX: 0, startY: 0, endX: 0, endY: 0 };
	}

	const startFieldIndex = findFieldIndex(startTable, relationship.startFieldId);
	const endFieldIndex = findFieldIndex(endTable, relationship.endFieldId);

	const startFieldY = fieldY(startTable, startFieldIndex);
	const endFieldY = fieldY(endTable, endFieldIndex);

	// Determine the horizontal center of each table to decide exit sides.
	const startCenterX = startTable.x + tableWidth / 2;
	const endCenterX = endTable.x + tableWidth / 2;

	let startX: number;
	let endX: number;

	if (startCenterX <= endCenterX) {
		// Start table is to the left: exit from the right side, enter from the left side.
		startX = startTable.x + tableWidth;
		endX = endTable.x;
	} else {
		// Start table is to the right: exit from the left side, enter from the right side.
		startX = startTable.x;
		endX = endTable.x + tableWidth;
	}

	// Self-referencing table: both exit from the right side.
	if (startTable.id === endTable.id) {
		startX = startTable.x + tableWidth;
		endX = endTable.x + tableWidth;

		const offset = 80;
		const path =
			`M ${startX} ${startFieldY} ` +
			`C ${startX + offset} ${startFieldY}, ${startX + offset} ${endFieldY}, ${endX} ${endFieldY}`;

		return { path, startX, startY: startFieldY, endX, endY: endFieldY };
	}

	// Control point horizontal offset: at least 60px, or 40% of the horizontal distance.
	const horizontalDist = Math.abs(startX - endX);
	const cpOffset = Math.max(horizontalDist * 0.4, 60);

	// Control points: offset from start/end in the direction of the connection.
	const dirStart = startCenterX <= endCenterX ? 1 : -1;
	const dirEnd = -dirStart;

	const cp1X = startX + dirStart * cpOffset;
	const cp2X = endX + dirEnd * cpOffset;

	const path =
		`M ${startX} ${startFieldY} ` +
		`C ${cp1X} ${startFieldY}, ${cp2X} ${endFieldY}, ${endX} ${endFieldY}`;

	return {
		path,
		startX,
		startY: startFieldY,
		endX,
		endY: endFieldY
	};
}
