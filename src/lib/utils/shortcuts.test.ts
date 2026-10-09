import { describe, expect, test } from 'bun:test';
import {
	computeFitTransform,
	isActivatableTarget,
	isEditableTarget,
	matchShortcut,
	type ShortcutKeyEvent
} from './shortcuts';
import type { Table } from '../data/constants';

function key(k: string, mods: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
	return {
		key: k,
		code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		...mods
	};
}

describe('matchShortcut', () => {
	test('maps the web hotkey table (ControlPanel.jsx:1983-2008)', () => {
		const ctrl = { ctrlKey: true };
		expect(matchShortcut(key('z', ctrl))).toBe('undo');
		expect(matchShortcut(key('y', ctrl))).toBe('redo');
		expect(matchShortcut(key('Z', { ...ctrl, shiftKey: true }))).toBe('redo');
		expect(matchShortcut(key('s', ctrl))).toBe('save');
		expect(matchShortcut(key('S', { ...ctrl, shiftKey: true }))).toBe('saveAs');
		expect(matchShortcut(key('o', ctrl))).toBe('open');
		expect(matchShortcut(key('i', ctrl))).toBe('import');
		expect(matchShortcut(key('c', ctrl))).toBe('copy');
		expect(matchShortcut(key('x', ctrl))).toBe('cut');
		expect(matchShortcut(key('v', ctrl))).toBe('paste');
		expect(matchShortcut(key('d', ctrl))).toBe('duplicate');
		expect(matchShortcut(key('ArrowUp', ctrl))).toBe('zoomIn');
		expect(matchShortcut(key('ArrowDown', ctrl))).toBe('zoomOut');
		expect(matchShortcut(key('G', { ...ctrl, shiftKey: true }))).toBe('toggleGrid');
		expect(matchShortcut(key('M', { ...ctrl, shiftKey: true }))).toBe('toggleStrictMode');
		expect(matchShortcut(key('F', { ...ctrl, shiftKey: true }))).toBe('toggleFieldSummary');
		expect(matchShortcut(key('w', { ...ctrl, altKey: true }))).toBe('fitWindow');
		expect(matchShortcut(key('Delete'))).toBe('delete');
		expect(matchShortcut(key('Enter'))).toBe('resetView');
		expect(matchShortcut(key('ArrowLeft'))).toBe('panLeft');
		expect(matchShortcut(key('ArrowRight'))).toBe('panRight');
		expect(matchShortcut(key('ArrowUp'))).toBe('panUp');
		expect(matchShortcut(key('ArrowDown'))).toBe('panDown');
	});

	test('Cmd works as mod, and Option+W on macOS matches by code', () => {
		expect(matchShortcut(key('z', { metaKey: true }))).toBe('undo');
		expect(matchShortcut({ ...key('∑', { metaKey: true, altKey: true }), code: 'KeyW' })).toBe('fitWindow');
	});

	test('Backspace deletes only on macOS', () => {
		expect(matchShortcut(key('Backspace'))).toBeNull();
		expect(matchShortcut(key('Backspace'), true)).toBe('delete');
	});

	test('unbound keys and stray modifiers do nothing', () => {
		expect(matchShortcut(key('a'))).toBeNull();
		expect(matchShortcut(key('c'))).toBeNull();
		expect(matchShortcut(key('q', { ctrlKey: true }))).toBeNull();
		expect(matchShortcut(key('Delete', { shiftKey: true }))).toBeNull();
		expect(matchShortcut(key('Enter', { altKey: true }))).toBeNull();
		expect(matchShortcut(key('C', { ctrlKey: true, shiftKey: true }))).toBeNull();
	});
});

describe('target predicates', () => {
	const stub = (matches: string[], isContentEditable = false) => ({
		isContentEditable,
		closest: (selector: string) => (matches.some((m) => selector.includes(m)) ? {} : null)
	});

	test('isEditableTarget stands down for inputs / contenteditable only', () => {
		expect(isEditableTarget(null)).toBe(false);
		expect(isEditableTarget(stub([]) as unknown as EventTarget)).toBe(false);
		expect(isEditableTarget(stub(['input']) as unknown as EventTarget)).toBe(true);
		expect(isEditableTarget(stub([], true) as unknown as EventTarget)).toBe(true);
	});

	test('isActivatableTarget detects focused buttons', () => {
		expect(isActivatableTarget(stub(['button']) as unknown as EventTarget)).toBe(true);
		expect(isActivatableTarget(stub([]) as unknown as EventTarget)).toBe(false);
	});
});

describe('computeFitTransform', () => {
	const t = (id: string, x: number, y: number, fieldCount: number): Table =>
		({
			id,
			name: id,
			x,
			y,
			fields: Array.from({ length: fieldCount }, (_, i) => ({ id: `${id}_f${i}` })),
			collapsed: false
		}) as unknown as Table;

	test('returns null for an empty diagram or zero-size screen', () => {
		const empty = { tables: [], areas: [], notes: [], relationships: [] };
		expect(computeFitTransform(empty, { x: 800, y: 600 }, 220)).toBeNull();
		expect(
			computeFitTransform({ ...empty, tables: [t('a', 0, 0, 1)] }, { x: 0, y: 0 }, 220)
		).toBeNull();
	});

	test('centers on the content and floors zoom to a multiple of 0.05', () => {
		// Table a: 0..220 x 0..(7+50+36)=93 ; area: 300..500 x 0..100
		const fit = computeFitTransform(
			{
				tables: [t('a', 0, 0, 1)],
				areas: [{ id: 0, name: 'a', x: 300, y: 0, width: 200, height: 100, color: '#000000', locked: false }],
				notes: [],
				relationships: []
			},
			{ x: 1020, y: 1000 },
			220
		);
		expect(fit).not.toBeNull();
		expect(fit!.pan).toEqual({ x: 250, y: 50 });
		// width = 500 + 10 → 1020/510 = 2 ; height = 100 + 10 → 1000/110 ≈ 9.09 → min 2
		expect(fit!.zoom).toBe(2);
	});
});
