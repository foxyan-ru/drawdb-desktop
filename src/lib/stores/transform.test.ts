import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { setTransform, transform, toDiagramSpace, toScreenSpace } from './transform';

describe('setTransform', () => {
	test('merges pan updates and keeps the previous zoom', () => {
		setTransform({ zoom: 2 });
		setTransform({ pan: { x: 10, y: 20 } });

		const current = get(transform);
		expect(current.zoom).toBe(2);
		expect(current.pan).toEqual({ x: 10, y: 20 });
	});

	test('clamps zoom to the allowed range', () => {
		setTransform({ zoom: 100 });
		expect(get(transform).zoom).toBe(5);

		setTransform({ zoom: 0 });
		expect(get(transform).zoom).toBe(0.02);

		// restore defaults for any later tests
		setTransform({ zoom: 1, pan: { x: 0, y: 0 } });
	});
});

describe('coordinate helpers', () => {
	const screen = { x: 800, y: 600 };
	const view = { x: -400, y: -300, width: 800, height: 600 };

	test('screen centre maps to the diagram origin', () => {
		const point = toDiagramSpace({ x: 400, y: 300 }, screen, view);
		expect(point.x).toBeCloseTo(0);
		expect(point.y).toBeCloseTo(0);
	});

	test('round trips between screen and diagram space', () => {
		const screenPoint = toScreenSpace({ x: 120, y: -60 }, screen, view);
		const back = toDiagramSpace(screenPoint, screen, view);
		expect(back.x).toBeCloseTo(120);
		expect(back.y).toBeCloseTo(-60);
	});

	test('leaves coordinates without a value as undefined', () => {
		const point = toDiagramSpace({ y: 300 }, screen, view);
		expect(point.x).toBeUndefined();
		expect(point.y).toBeCloseTo(0);
	});
});
