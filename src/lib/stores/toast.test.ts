import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { clearToasts, dismissToast, showToast, toasts } from './toast';

describe('toast store', () => {
	test('showToast appends with a default type of info and returns unique ids', () => {
		clearToasts();
		const a = showToast('first', undefined, 0);
		const b = showToast('second', 'error', 0);
		expect(a).not.toBe(b);
		expect(get(toasts)).toEqual([
			{ id: a, message: 'first', type: 'info' },
			{ id: b, message: 'second', type: 'error' }
		]);
		clearToasts();
	});

	test('dismissToast removes only that toast', () => {
		clearToasts();
		const a = showToast('a', 'success', 0);
		const b = showToast('b', 'info', 0);
		dismissToast(a);
		expect(get(toasts).map((t) => t.id)).toEqual([b]);
		clearToasts();
		expect(get(toasts)).toEqual([]);
	});

	test('toasts expire on their own after the duration', async () => {
		clearToasts();
		showToast('short-lived', 'info', 10);
		expect(get(toasts).length).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(get(toasts).length).toBe(0);
	});
});
