import { describe, expect, test } from 'bun:test';
import { getRectFromEndpoints, isInsideRect, isSameElement } from './select';
import { ObjectType } from '../data/constants';

describe('rubber-band rect helpers', () => {
	test('normalises endpoints dragged in any direction', () => {
		const expected = { x: 10, y: 20, width: 90, height: 60 };
		expect(getRectFromEndpoints({ x1: 10, y1: 20, x2: 100, y2: 80 })).toEqual(expected);
		expect(getRectFromEndpoints({ x1: 100, y1: 80, x2: 10, y2: 20 })).toEqual(expected);
		expect(getRectFromEndpoints({ x1: 100, y1: 20, x2: 10, y2: 80 })).toEqual(expected);
	});

	test('selects only fully enclosed elements, like web', () => {
		const band = { x: 0, y: 0, width: 500, height: 500 };
		expect(isInsideRect({ x: 10, y: 10, width: 100, height: 100 }, band)).toBe(true);
		// Overlapping the edge is not enough.
		expect(isInsideRect({ x: 450, y: 10, width: 100, height: 100 }, band)).toBe(false);
		// A zero-size band (plain click) encloses nothing.
		expect(isInsideRect({ x: 10, y: 10, width: 100, height: 100 }, { x: 50, y: 50, width: 0, height: 0 })).toBe(false);
	});

	test('elements are identified by id and type together', () => {
		expect(isSameElement({ id: 0, type: ObjectType.AREA }, { id: 0, type: ObjectType.AREA })).toBe(true);
		// Areas and notes both use index ids, so id alone is ambiguous.
		expect(isSameElement({ id: 0, type: ObjectType.AREA }, { id: 0, type: ObjectType.NOTE })).toBe(false);
	});
});
