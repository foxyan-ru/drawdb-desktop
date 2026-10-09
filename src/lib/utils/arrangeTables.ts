// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import { tableColorStripHeight, tableFieldHeight, tableHeaderHeight } from '../data/constants';

/**
 * Lays imported tables out in two rows: the first half left-to-right along the
 * top, the second half right-to-left beneath the tallest table of the first
 * row. Mutates `x`/`y` in place. Verbatim port of
 * drawdb-main/src/utils/arrangeTables.js (including its 200px column pitch,
 * which is narrower than `tableWidth` — kept for parity with web layouts).
 */
export function arrangeTables(diagram: { tables: { x: number; y: number; fields: unknown[] }[] }) {
	let maxHeight = -1;
	const tableWidth = 200;
	const gapX = 54;
	const gapY = 40;
	diagram.tables.forEach((table, i) => {
		if (i < diagram.tables.length / 2) {
			table.x = i * tableWidth + (i + 1) * gapX;
			table.y = gapY;
			const height = table.fields.length * tableFieldHeight + tableHeaderHeight + tableColorStripHeight;
			maxHeight = Math.max(height, maxHeight);
		} else {
			const index = diagram.tables.length - i - 1;
			table.x = index * tableWidth + (index + 1) * gapX;
			table.y = maxHeight + 2 * gapY;
		}
	});
}
