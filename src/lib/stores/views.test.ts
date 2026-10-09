import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { views, addView, deleteView, updateView, duplicateView } from './views';
import { selectedElement } from './select';
import { undoStack, clearHistory } from './undoRedo';
import { ObjectType } from '../data/constants';

function reset() {
	views.set([]);
	clearHistory();
	selectedElement.set({ element: ObjectType.NONE, id: -1, open: false, currentTab: '1' });
}

describe('views store', () => {
	test('addView creates an empty view with an incrementing default name', () => {
		reset();
		addView();
		addView();
		const list = get(views);
		expect(list.length).toBe(2);
		expect(list[0].name).toBe('view_0');
		expect(list[1].name).toBe('view_1');
		expect(list[0].baseTableId).toBeNull();
		expect(list[0].joins).toEqual([]);
		expect(list[0].columns).toEqual([]);
		expect(list[0].conditions).toEqual([]);
		expect(list[0].materialized).toBe(false);
		expect(list[0].locked).toBe(false);
	});

	test('addView pushes one undo snapshot per call', () => {
		reset();
		addView();
		addView();
		expect(get(undoStack).length).toBe(2);
	});

	test('addView with explicit data inserts at the given index', () => {
		reset();
		addView();
		addView();
		const inserted = { ...get(views)[0], id: 'v-inserted', name: 'inserted' };
		addView({ view: inserted, index: 1 });
		const names = get(views).map((v) => v.name);
		expect(names).toEqual(['view_0', 'inserted', 'view_1']);
	});

	test('updateView patches only the matching view and coalesces rapid edits', () => {
		reset();
		addView();
		const id = get(views)[0].id;
		const before = get(undoStack).length;
		updateView(id, { name: 'renamed' });
		updateView(id, { name: 'renamed again' });
		expect(get(views)[0].name).toBe('renamed again');
		// Same coalesce key (`view:${id}`) within the window collapses to one entry.
		expect(get(undoStack).length).toBe(before + 1);
	});

	test('deleteView removes the view and clears the selection if it was selected', () => {
		reset();
		addView();
		const id = get(views)[0].id;
		selectedElement.set({ element: ObjectType.VIEW, id, open: true, currentTab: '7' });
		deleteView(id);
		expect(get(views)).toEqual([]);
		expect(get(selectedElement).element).toBe(ObjectType.NONE);
	});

	test('deleteView on an unknown id is a no-op', () => {
		reset();
		addView();
		const before = get(views);
		deleteView('does-not-exist');
		expect(get(views)).toEqual(before);
	});

	test('duplicateView copies joins/columns/conditions with fresh ids, offset by 24/24', () => {
		reset();
		addView();
		const id = get(views)[0].id;
		updateView(id, {
			baseTableId: 't1',
			joins: [{ id: 'j1', type: 'INNER', tableId: 't2', on: null }],
			columns: [{ id: 'c1', tableId: 't1', fieldId: 'f1', alias: '' }],
			conditions: [{ id: 'w1', connector: 'AND', tableId: 't1', fieldId: 'f1', operator: '=', value: '1' }]
		});
		const source = get(views)[0];

		duplicateView(id);
		const list = get(views);
		expect(list.length).toBe(2);
		const copy = list[1];

		expect(copy.id).not.toBe(source.id);
		expect(copy.name).toBe(`${source.name}_copy`);
		expect(copy.x).toBe(source.x + 24);
		expect(copy.y).toBe(source.y + 24);
		expect(copy.joins[0].id).not.toBe('j1');
		expect(copy.joins[0].tableId).toBe('t2');
		expect(copy.columns[0].id).not.toBe('c1');
		expect(copy.conditions[0].id).not.toBe('w1');
	});

	test('duplicateView on an unknown id is a no-op', () => {
		reset();
		duplicateView('does-not-exist');
		expect(get(views)).toEqual([]);
	});
});
