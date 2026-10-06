import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { layout } from './layout';

describe('layout store', () => {
	test('starts with every panel visible', () => {
		expect(get(layout)).toEqual({ header: true, sidebar: true, issues: true, toolbar: true });
	});

	test('toggling one panel leaves the others untouched', () => {
		layout.update((l) => ({ ...l, sidebar: false }));
		expect(get(layout).sidebar).toBe(false);
		expect(get(layout).header).toBe(true);
		expect(get(layout).toolbar).toBe(true);

		layout.update((l) => ({ ...l, sidebar: true }));
		expect(get(layout).sidebar).toBe(true);
	});
});
