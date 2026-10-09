import { writable } from 'svelte/store';
// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import { ObjectType, Tab } from '../data/constants';

export interface SelectedElement {
	element: number;
	id: string | number;
	open: boolean;
	currentTab: string;
}

export const selectedElement = writable<SelectedElement>({
	element: ObjectType.NONE,
	id: -1,
	open: false,
	currentTab: Tab.TABLES
});

/**
 * One element of a multi-selection (rubber-band or ctrl/cmd-click), same shape
 * as web's bulk entries (drawdb-main/src/components/EditorCanvas/Canvas.jsx:170-175):
 * `initialCoords` is where the element was when the current drag began,
 * `currentCoords` where it is now — together they describe one bulk move.
 */
export interface BulkElement {
	id: string | number;
	type: number;
	currentCoords: { x: number; y: number };
	initialCoords: { x: number; y: number };
}

export const bulkSelectedElements = writable<BulkElement[]>([]);

export function isSameElement(
	a: { id: string | number; type: number },
	b: { id: string | number; type: number }
): boolean {
	return a.id === b.id && a.type === b.type;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Normalises a drag rectangle given by two corners (web utils/rect.js:1-9). */
export function getRectFromEndpoints({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }): Rect {
	return {
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		width: Math.abs(x1 - x2),
		height: Math.abs(y1 - y2)
	};
}

/**
 * Whether `inner` lies strictly inside `outer`. Rubber-band selection picks only
 * fully-enclosed elements, matching web utils/rect.js:11-18 (not mere overlap).
 */
export function isInsideRect(inner: Rect, outer: Rect): boolean {
	return (
		inner.x > outer.x &&
		inner.x + inner.width < outer.x + outer.width &&
		inner.y > outer.y &&
		inner.y + inner.height < outer.y + outer.height
	);
}

export function clearSelection() {
	selectedElement.set({
		element: ObjectType.NONE,
		id: -1,
		open: false,
		currentTab: Tab.TABLES
	});
}
