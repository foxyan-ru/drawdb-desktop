import { writable, get, derived } from 'svelte/store';
import { nanoid } from 'nanoid';
// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import { defaultBlue, ObjectType, type View } from '../data/constants';
import { snapshotForUndo } from './undoRedo';
import { selectedElement, clearSelection } from './select';
import { transform } from './transform';
// Circular with ./diagram (which imports `views` for exportDiagram/loadDiagram).
// Safe: neither module touches the other's exports at module-evaluation time,
// only inside functions.
import { exportDiagram } from './diagram';

/*
 * Database views (port of drawdb-main/src/context/ViewsContext.jsx). Same
 * conventions as the table/area/note helpers in ./diagram: every mutation
 * snapshots the whole diagram (`exportDiagram()`, which includes `views`)
 * *before* changing it, so undo/redo restore views like any other element.
 */

export const views = writable<View[]>([]);

export const viewsCount = derived(views, ($v) => $v.length);

/** A fresh, empty view at the current pan position (ViewsContext.jsx:21-35). */
function createView(): View {
	const $transform = get(transform);
	return {
		id: nanoid(),
		name: `view_${get(views).length}`,
		x: $transform.pan.x,
		y: $transform.pan.y,
		baseTableId: null,
		joins: [],
		columns: [],
		conditions: [],
		comment: '',
		materialized: false,
		color: defaultBlue,
		locked: false
	};
}

export function addView(data?: { view: View; index?: number }, addToHistory = true) {
	if (addToHistory) {
		snapshotForUndo('Add view', exportDiagram());
	}

	if (data) {
		views.update((prev) => {
			const temp = [...prev];
			temp.splice(data.index ?? prev.length, 0, data.view);
			return temp;
		});
	} else {
		const created = createView();
		views.update((prev) => [...prev, created]);
	}
}

export function deleteView(id: string, addToHistory = true) {
	const $views = get(views);
	const deleted = $views.find((v) => v.id === id);
	if (!deleted) return;

	if (addToHistory) {
		snapshotForUndo(`Delete view ${deleted.name}`, exportDiagram());
	}

	views.update((prev) => prev.filter((v) => v.id !== id));

	const $sel = get(selectedElement);
	if ($sel.element === ObjectType.VIEW && $sel.id === id) clearSelection();
}

/**
 * Patches a view. Rapid repeated edits of the same view (typing a name,
 * dragging) coalesce into one undo step, as for tables/areas/notes. Pass
 * `addToHistory = false` for follow-up writes of a gesture that already
 * snapshotted (e.g. the rest of a resize drag).
 */
export function updateView(id: string, values: Partial<View>, addToHistory = true) {
	if (addToHistory) {
		snapshotForUndo('Edit view', exportDiagram(), `view:${id}`);
	}
	views.update((prev) => prev.map((v) => (v.id === id ? { ...v, ...values } : v)));
}

/**
 * Inserts a copy of `view` offset by 24/24 with fresh ids for the view and
 * every join/column/condition (web EditorCanvas/View.jsx:116-131).
 */
export function duplicateView(id: string) {
	const $views = get(views);
	const source = $views.find((v) => v.id === id);
	if (!source) return;

	addView({
		view: {
			...source,
			id: nanoid(),
			name: `${source.name}_copy`,
			x: source.x + 24,
			y: source.y + 24,
			columns: source.columns.map((c) => ({ ...c, id: nanoid() })),
			joins: source.joins.map((j) => ({ ...j, id: nanoid() })),
			conditions: source.conditions.map((c) => ({ ...c, id: nanoid() }))
		},
		index: $views.length
	});
}
