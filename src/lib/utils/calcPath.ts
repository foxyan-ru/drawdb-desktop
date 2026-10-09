// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import {
	tableHeaderHeight,
	tableFieldHeight,
	tableColorStripHeight,
	type Field,
	type Relationship,
	type Table
} from '../data/constants';

/**
 * Relationship-path geometry, ported from drawdb-main/src/utils/calcPath.js plus
 * the collapsed-aware field helpers in drawdb-main/src/utils/utils.js:184-229.
 *
 * Desktop differences from the web original:
 * - Every field row is a fixed `tableFieldHeight` (desktop tables don't render
 *   field/table comments inline), so the y-offset of a row is just
 *   `index * tableFieldHeight` instead of web's `getFieldOffsetY` sum.
 * - Desktop tables render a separate `tableColorStripHeight` strip above the
 *   header (Table.svelte), which web folds into its header height.
 * - No zoom parameter: web always calls these with zoom = 1.
 */

export interface PathTable {
	x: number;
	y: number;
	width: number;
}

export interface PathInput {
	startTable: PathTable;
	endTable: PathTable;
	startFieldIndex: number;
	endFieldIndex: number;
}

export interface CompositePathInput {
	startTable: PathTable;
	endTable: PathTable;
	startFieldIndices: number[];
	endFieldIndices: number[];
}

export interface Point {
	x: number;
	y: number;
}

export interface CompositePathResult {
	path: string;
	labelPoint: Point;
	startCardinality: Point;
	endCardinality: Point;
}

type FieldPair = { startFieldId: string; endFieldId: string };

/**
 * The (start, end) field pairs a relationship links — one pair for a simple FK,
 * several for a composite FK (`relationship.fields`, populated by DB
 * introspection). Mirrors web `getRelationshipFields` (utils.js) and
 * exportSQL/shared.ts; kept local so canvas geometry doesn't depend on the SQL
 * export module.
 */
export function getRelationshipFieldPairs(relationship: Relationship): FieldPair[] {
	if (Array.isArray(relationship.fields) && relationship.fields.length > 0) {
		return relationship.fields;
	}
	return [{ startFieldId: relationship.startFieldId, endFieldId: relationship.endFieldId }];
}

/** Whether `fieldId` on `tableId` is an endpoint of any relationship (web utils.js:184-204). */
export function isFieldLinked(tableId: string, fieldId: string, relationships: Relationship[]): boolean {
	return relationships.some((r) =>
		getRelationshipFieldPairs(r).some(
			(pair) =>
				(r.startTableId === tableId && pair.startFieldId === fieldId) ||
				(r.endTableId === tableId && pair.endFieldId === fieldId)
		)
	);
}

type FieldOwner = Pick<Table, 'id' | 'fields' | 'collapsed'>;

/**
 * Fields actually rendered on the canvas: all of them, or — for a collapsed
 * table — only those taking part in a relationship (web utils.js:206-222).
 */
export function getVisibleFields(table: FieldOwner, relationships: Relationship[]): Field[] {
	const fields = table.fields ?? [];
	if (!table.collapsed) return fields;
	return fields.filter((f) => isFieldLinked(table.id, f.id, relationships));
}

/**
 * Row index of `fieldId` among the *visible* fields, or -1 if it isn't rendered
 * (web utils.js:224-229). Using the raw `fields` index instead points
 * relationship lines at the wrong row whenever a table is collapsed.
 */
export function getVisibleFieldIndex(table: FieldOwner, fieldId: string, relationships: Relationship[]): number {
	return getVisibleFields(table, relationships).findIndex((f) => f.id === fieldId);
}

/**
 * Vertical centre of the field row at `fieldIndex`. A negative index (field not
 * visible / not found) anchors to the first row, same as web where
 * `getFieldOffsetY(fields, -1)` sums nothing.
 */
export function fieldAnchorY(table: Pick<PathTable, 'y'>, fieldIndex: number): number {
	return (
		table.y +
		tableColorStripHeight +
		tableHeaderHeight +
		Math.max(fieldIndex, 0) * tableFieldHeight +
		tableFieldHeight / 2
	);
}

/**
 * SVG path for a single-field relationship: orthogonal segments with rounded
 * corners, exiting/entering the table sides that face each other.
 * Port of web calcPath.js:16-129 (zoom fixed at 1).
 */
export function calcPath(r: PathInput | null | undefined): string {
	if (!r) return '';

	const startWidth = r.startTable.width;
	const endWidth = r.endTable.width;
	const x1 = r.startTable.x;
	const y1 = fieldAnchorY(r.startTable, r.startFieldIndex);
	const x2 = r.endTable.x;
	const y2 = fieldAnchorY(r.endTable, r.endFieldIndex);

	let radius = 10;
	const midX = (x2 + x1 + startWidth) / 2;
	const endX = x2 + endWidth < x1 ? x2 + endWidth : x2;

	if (Math.abs(y1 - y2) <= 36) {
		radius = Math.abs(y2 - y1) / 3;
		if (radius <= 2) {
			if (x1 + startWidth <= x2) return `M ${x1 + startWidth} ${y1} L ${x2} ${y2 + 0.1}`;
			else if (x2 + endWidth < x1) return `M ${x1} ${y1} L ${x2 + endWidth} ${y2 + 0.1}`;
		}
	}

	if (y1 <= y2) {
		if (x1 + startWidth <= x2) {
			return `M ${x1 + startWidth} ${y1} L ${midX - radius} ${y1} A ${radius} ${radius} 0 0 1 ${midX} ${y1 + radius} L ${midX} ${y2 - radius} A ${radius} ${radius} 0 0 0 ${midX + radius} ${y2} L ${endX} ${y2}`;
		} else if (x2 <= x1 + startWidth && x1 <= x2) {
			return `M ${x1 + startWidth} ${y1} L ${x2 + endWidth} ${y1} A ${radius} ${radius} 0 0 1 ${x2 + endWidth + radius} ${y1 + radius} L ${x2 + endWidth + radius} ${y2 - radius} A ${radius} ${radius} 0 0 1 ${x2 + endWidth} ${y2} L ${x2 + endWidth} ${y2}`;
		} else if (x2 + endWidth >= x1 && x2 + endWidth <= x1 + startWidth) {
			return `M ${x1} ${y1} L ${x2 - radius} ${y1} A ${radius} ${radius} 0 0 0 ${x2 - radius - radius} ${y1 + radius} L ${x2 - radius - radius} ${y2 - radius} A ${radius} ${radius} 0 0 0 ${x2 - radius} ${y2} L ${x2} ${y2}`;
		} else {
			return `M ${x1} ${y1} L ${midX + radius} ${y1} A ${radius} ${radius} 0 0 0 ${midX} ${y1 + radius} L ${midX} ${y2 - radius} A ${radius} ${radius} 0 0 1 ${midX - radius} ${y2} L ${endX} ${y2}`;
		}
	} else {
		if (x1 + startWidth <= x2) {
			return `M ${x1 + startWidth} ${y1} L ${midX - radius} ${y1} A ${radius} ${radius} 0 0 0 ${midX} ${y1 - radius} L ${midX} ${y2 + radius} A ${radius} ${radius} 0 0 1 ${midX + radius} ${y2} L ${endX} ${y2}`;
		} else if (x1 + startWidth >= x2 && x1 + startWidth <= x2 + endWidth) {
			return `M ${x1} ${y1} L ${x1 - radius - radius} ${y1} A ${radius} ${radius} 0 0 1 ${x1 - radius - radius - radius} ${y1 - radius} L ${x1 - radius - radius - radius} ${y2 + radius} A ${radius} ${radius} 0 0 1 ${x1 - radius - radius} ${y2} L ${endX} ${y2}`;
		} else if (x1 >= x2 && x1 <= x2 + endWidth) {
			return `M ${x1 + startWidth} ${y1} L ${x1 + startWidth + radius} ${y1} A ${radius} ${radius} 0 0 0 ${x1 + startWidth + radius + radius} ${y1 - radius} L ${x1 + startWidth + radius + radius} ${y2 + radius} A ${radius} ${radius} 0 0 0 ${x1 + startWidth + radius} ${y2} L ${x2 + endWidth} ${y2}`;
		} else {
			return `M ${x1} ${y1} L ${midX + radius} ${y1} A ${radius} ${radius} 0 0 1 ${midX} ${y1 - radius} L ${midX} ${y2 + radius} A ${radius} ${radius} 0 0 0 ${midX - radius} ${y2} L ${endX} ${y2}`;
		}
	}
}

/**
 * "Fork" path for a composite (multi-column) FK: a stub from every column on
 * each table converges into a vertical collector, the two collectors are joined
 * by one orthogonal trunk, and the trunk forks back out to the other table's
 * columns. Port of web calcPath.js:150-245 (zoom fixed at 1).
 */
export function calcCompositePath(r: CompositePathInput | null | undefined): CompositePathResult | null {
	if (!r || !r.startFieldIndices?.length || !r.endFieldIndices?.length) {
		return null;
	}

	const startWidth = r.startTable.width;
	const endWidth = r.endTable.width;

	const startYs = r.startFieldIndices.map((i) => fieldAnchorY(r.startTable, i));
	const endYs = r.endFieldIndices.map((i) => fieldAnchorY(r.endTable, i));

	// Connect each table on the edge facing the other table.
	const startCenter = r.startTable.x + startWidth / 2;
	const endCenter = r.endTable.x + endWidth / 2;
	const startIsLeft = startCenter <= endCenter;
	const startX = startIsLeft ? r.startTable.x + startWidth : r.startTable.x;
	const endX = startIsLeft ? r.endTable.x : r.endTable.x + endWidth;
	const dir = startIsLeft ? 1 : -1;
	const fork = 24;
	const mergeStartX = startX + dir * fork;
	const mergeEndX = endX - dir * fork;

	const trunkStartY = (Math.min(...startYs) + Math.max(...startYs)) / 2;
	const trunkEndY = (Math.min(...endYs) + Math.max(...endYs)) / 2;
	const midX = (mergeStartX + mergeEndX) / 2;

	const radius = 10;

	// A column branch: horizontal stub from the table edge to the collector x,
	// a rounded corner, then a vertical run to the trunk level.
	const branch = (fromX: number, fromY: number, cornerX: number, toY: number) => {
		if (Math.abs(fromY - toY) < 0.5) {
			return `M ${fromX} ${fromY} L ${cornerX} ${toY}`;
		}
		const dx = Math.sign(cornerX - fromX);
		const dy = Math.sign(toY - fromY);
		const rr = Math.min(radius, Math.abs(toY - fromY), Math.abs(cornerX - fromX));
		return `M ${fromX} ${fromY} L ${cornerX - dx * rr} ${fromY} Q ${cornerX} ${fromY} ${cornerX} ${fromY + dy * rr} L ${cornerX} ${toY}`;
	};

	// The trunk: a rounded orthogonal connector between the two collectors.
	const trunk = (sx: number, sy: number, ex: number, ey: number) => {
		if (Math.abs(sy - ey) < 0.5) {
			return `M ${sx} ${sy} L ${ex} ${ey}`;
		}
		const mx = (sx + ex) / 2;
		const dxs = Math.sign(mx - sx);
		const dxe = Math.sign(ex - mx);
		const dy = Math.sign(ey - sy);
		const rr = Math.min(radius, Math.abs(ey - sy) / 2, Math.abs(mx - sx) || radius);
		return `M ${sx} ${sy} L ${mx - dxs * rr} ${sy} Q ${mx} ${sy} ${mx} ${sy + dy * rr} L ${mx} ${ey - dy * rr} Q ${mx} ${ey} ${mx + dxe * rr} ${ey} L ${ex} ${ey}`;
	};

	const segs: string[] = [];
	startYs.forEach((y) => segs.push(branch(startX, y, mergeStartX, trunkStartY)));
	segs.push(trunk(mergeStartX, trunkStartY, mergeEndX, trunkEndY));
	endYs.forEach((y) => segs.push(branch(endX, y, mergeEndX, trunkEndY)));

	return {
		path: segs.join(' '),
		labelPoint: { x: midX, y: (trunkStartY + trunkEndY) / 2 },
		startCardinality: { x: mergeStartX, y: trunkStartY },
		endCardinality: { x: mergeEndX, y: trunkEndY }
	};
}
