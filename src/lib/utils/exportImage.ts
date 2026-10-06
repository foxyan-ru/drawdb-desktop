import { tick } from 'svelte';
import { get } from 'svelte/store';
import { _ } from 'svelte-i18n';
import { toPng, toSvg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { tables, areas, notes, exportDiagram } from '$lib/stores/diagram';
import { settings } from '$lib/stores/settings';
import { saveState, currentDiagramName } from '$lib/stores/saveState';
import { canvasSvgEl, exportBoundsOverride, type Bounds } from '$lib/stores/transform';
import {
	tableWidth as defaultTableWidth,
	tableHeaderHeight,
	tableFieldHeight,
	tableColorStripHeight,
	State
} from '$lib/data/constants';
import { exportJSON } from '$lib/utils/exportJSON';

/**
 * Image/PDF/JSON export of the live diagram canvas.
 *
 * PNG/SVG/PDF capture is done with `html-to-image` rather than a manual SVG
 * serialization, because each table renders as an SVG <foreignObject> containing
 * Tailwind-styled HTML (see Canvas/Table.svelte). Tailwind's rules live in an
 * external stylesheet, not inlined on the elements, so a naive
 * XMLSerializer + <img> + <canvas> approach would silently drop all styling.
 * html-to-image clones the DOM and inlines each element's *computed* styles
 * before rasterizing, which correctly handles foreignObject/HTML-in-SVG content.
 */

// Approximate dark canvas background; mirrors --color-canvas-bg's dark-mode
// value in src/app.css (#16161a). Light mode uses plain white for the export
// background rather than the subtle off-white canvas tint, since that reads
// better as a "printed" background for a PNG/PDF shared outside the app.
const DARK_CANVAS_BG = '#16161a';
const LIGHT_CANVAS_BG = '#ffffff';
const EXPORT_PADDING = 60;
const EMPTY_DIAGRAM_BOUNDS: Bounds = { x: -400, y: -300, width: 800, height: 600 };

function translate(key: string): string {
	return get(_)(key) as string;
}

/**
 * Writes via the app's own `write_binary_to_path`/`save_to_path` Rust commands
 * (same ones `fileActions.ts` uses for .ddb saves) rather than
 * `@tauri-apps/plugin-fs`'s `writeFile`/`writeTextFile`. Custom commands bypass
 * the fs plugin's ACL scope system entirely, so exports work for any
 * user-chosen save path — not just the appdata/document/home/desktop roots the
 * fs plugin capabilities are scoped to.
 */
async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
	await invoke('write_binary_to_path', { path, data: Array.from(bytes) });
}

async function writeTextFile(path: string, text: string): Promise<void> {
	await invoke('save_to_path', { path, data: text });
}

function computeContentBounds(): Bounds {
	const $tables = get(tables);
	const $areas = get(areas);
	const $notes = get(notes);
	const $settings = get(settings);
	const tblWidth = $settings.tableWidth || defaultTableWidth;

	const rects: Bounds[] = [];

	for (const t of $tables) {
		const height = tableColorStripHeight + tableHeaderHeight + t.fields.length * tableFieldHeight;
		rects.push({ x: t.x, y: t.y, width: tblWidth, height });
	}
	for (const a of $areas) {
		rects.push({ x: a.x, y: a.y, width: a.width, height: a.height });
	}
	for (const n of $notes) {
		rects.push({ x: n.x, y: n.y, width: n.width, height: n.height });
	}

	if (rects.length === 0) {
		return EMPTY_DIAGRAM_BOUNDS;
	}

	const minX = Math.min(...rects.map((r) => r.x));
	const minY = Math.min(...rects.map((r) => r.y));
	const maxX = Math.max(...rects.map((r) => r.x + r.width));
	const maxY = Math.max(...rects.map((r) => r.y + r.height));

	return {
		x: minX - EXPORT_PADDING,
		y: minY - EXPORT_PADDING,
		width: maxX - minX + EXPORT_PADDING * 2,
		height: maxY - minY + EXPORT_PADDING * 2
	};
}

/**
 * Temporarily reframes the canvas SVG's viewBox to cover the full diagram
 * (instead of just the visible pan/zoom viewport), waits for the DOM to
 * actually repaint with that viewBox, runs `capture` against the live SVG
 * element, then always restores the user's normal viewport.
 */
async function withFullDiagramCapture<T>(
	bounds: Bounds,
	capture: (svgEl: SVGSVGElement, bounds: Bounds) => Promise<T>
): Promise<T> {
	exportBoundsOverride.set(bounds);
	try {
		await tick();
		await new Promise((resolve) => requestAnimationFrame(resolve));

		const svgEl = get(canvasSvgEl);
		if (!svgEl) {
			throw new Error('Canvas SVG element is not available');
		}
		return await capture(svgEl, bounds);
	} finally {
		exportBoundsOverride.set(null);
	}
}

/** Decodes a `data:...;base64,...` (or currently non-base64) data URL to raw bytes. */
function dataUrlToBytes(dataUrl: string): Uint8Array {
	const marker = ';base64,';
	const base64Index = dataUrl.indexOf(marker);
	const base64 = base64Index !== -1 ? dataUrl.slice(base64Index + marker.length) : dataUrl;
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Decodes a data URL to a UTF-8 text string, handling both the base64 form
 * (`data:...;base64,...`) and the URI-encoded form (`data:...,<uri-encoded>`)
 * that `html-to-image`'s `toSvg()` may return.
 */
function dataUrlToText(dataUrl: string): string {
	const marker = ';base64,';
	const base64Index = dataUrl.indexOf(marker);
	if (base64Index !== -1) {
		const base64 = dataUrl.slice(base64Index + marker.length);
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new TextDecoder('utf-8').decode(bytes);
	}
	const commaIndex = dataUrl.indexOf(',');
	const encoded = commaIndex !== -1 ? dataUrl.slice(commaIndex + 1) : dataUrl;
	return decodeURIComponent(encoded);
}

function canvasBackgroundColor(): string {
	const $settings = get(settings);
	return $settings.mode === 'light' ? LIGHT_CANVAS_BG : DARK_CANVAS_BG;
}

export async function exportDiagramPNG(): Promise<void> {
	try {
		saveState.set(State.SAVING);

		const bounds = computeContentBounds();
		const backgroundColor = canvasBackgroundColor();
		const pngDataUrl = await withFullDiagramCapture(bounds, (svgEl) =>
			toPng(svgEl as unknown as HTMLElement, {
				width: bounds.width,
				height: bounds.height,
				pixelRatio: 2,
				backgroundColor
			})
		);

		const filePath = await save({
			title: translate('export_png'),
			defaultPath: `${get(currentDiagramName)}.png`,
			filters: [{ name: 'PNG Image', extensions: ['png'] }]
		});

		if (filePath) {
			await writeBinaryFile(filePath, dataUrlToBytes(pngDataUrl));
			saveState.set(State.SAVED);
		} else {
			saveState.set(State.NONE);
		}
	} catch {
		saveState.set(State.ERROR);
	}
}

export async function exportDiagramSVG(): Promise<void> {
	try {
		saveState.set(State.SAVING);

		const bounds = computeContentBounds();
		const svgDataUrl = await withFullDiagramCapture(bounds, (svgEl) =>
			toSvg(svgEl as unknown as HTMLElement, {
				width: bounds.width,
				height: bounds.height
			})
		);

		const filePath = await save({
			title: translate('export_svg'),
			defaultPath: `${get(currentDiagramName)}.svg`,
			filters: [{ name: 'SVG Image', extensions: ['svg'] }]
		});

		if (filePath) {
			await writeTextFile(filePath, dataUrlToText(svgDataUrl));
			saveState.set(State.SAVED);
		} else {
			saveState.set(State.NONE);
		}
	} catch {
		saveState.set(State.ERROR);
	}
}

export async function exportDiagramPDF(): Promise<void> {
	try {
		saveState.set(State.SAVING);

		const bounds = computeContentBounds();
		const backgroundColor = canvasBackgroundColor();
		const pngDataUrl = await withFullDiagramCapture(bounds, (svgEl) =>
			toPng(svgEl as unknown as HTMLElement, {
				width: bounds.width,
				height: bounds.height,
				pixelRatio: 2,
				backgroundColor
			})
		);

		const doc = new jsPDF({
			orientation: bounds.width > bounds.height ? 'landscape' : 'portrait',
			unit: 'px',
			format: [bounds.width, bounds.height]
		});
		doc.addImage(pngDataUrl, 'PNG', 0, 0, bounds.width, bounds.height);
		const pdfBytes = new Uint8Array(doc.output('arraybuffer'));

		const filePath = await save({
			title: translate('export_pdf'),
			defaultPath: `${get(currentDiagramName)}.pdf`,
			filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
		});

		if (filePath) {
			await writeBinaryFile(filePath, pdfBytes);
			saveState.set(State.SAVED);
		} else {
			saveState.set(State.NONE);
		}
	} catch {
		saveState.set(State.ERROR);
	}
}

export async function exportDiagramJSON(): Promise<void> {
	try {
		saveState.set(State.SAVING);

		const json = exportJSON(exportDiagram());

		const filePath = await save({
			title: translate('export_json'),
			defaultPath: `${get(currentDiagramName)}.json`,
			filters: [{ name: 'JSON', extensions: ['json'] }]
		});

		if (filePath) {
			await writeTextFile(filePath, json);
			saveState.set(State.SAVED);
		} else {
			saveState.set(State.NONE);
		}
	} catch {
		saveState.set(State.ERROR);
	}
}
