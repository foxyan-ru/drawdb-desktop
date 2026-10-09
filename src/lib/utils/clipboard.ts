// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import { noteWidth, type Area, type Note, type Table } from '../data/constants';

/*
 * Pure transforms behind copy / paste / duplicate of canvas elements
 * (port of drawdb-main/src/components/EditorHeader/ControlPanel.jsx:901-1040).
 * The store-side wiring (selection lookup, add paths, undo) lives in
 * stores/diagram.ts (`copyElement` / `pasteElement` / `duplicateElement`).
 */

/** Pasted/duplicated elements land this far right/down of the original (web `+ 20`). */
export const PASTE_OFFSET = 20;

export type ClipboardElement =
	| { kind: 'table'; data: Table }
	| { kind: 'area'; data: Area }
	| { kind: 'note'; data: Note };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isObject(v: unknown): v is Record<string, any> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown) => typeof v === 'string';
const isBool = (v: unknown) => typeof v === 'boolean';
const isId = (v: unknown) => isStr(v) || (isNum(v) && Number.isInteger(v));
const isColor = (v: unknown) => isStr(v) && HEX_COLOR.test(v as string);

// The checks below mirror the `required` lists + property types of the web
// JSON schemas (drawdb-main/src/data/schemas.js:1-112) without pulling in a
// schema-validator dependency.

function isField(f: unknown): boolean {
	return (
		isObject(f) &&
		isId(f.id) &&
		isStr(f.name) &&
		isStr(f.type) &&
		(isStr(f.default) || isNum(f.default) || isBool(f.default)) &&
		isStr(f.check) &&
		isBool(f.primary) &&
		isBool(f.unique) &&
		isBool(f.notNull) &&
		isBool(f.increment) &&
		isStr(f.comment)
	);
}

function isIndex(i: unknown): boolean {
	return isObject(i) && isStr(i.name) && isBool(i.unique) && Array.isArray(i.fields);
}

export function isTableShape(obj: unknown): obj is Table {
	return (
		isObject(obj) &&
		isId(obj.id) &&
		isStr(obj.name) &&
		isNum(obj.x) &&
		isNum(obj.y) &&
		Array.isArray(obj.fields) &&
		obj.fields.every(isField) &&
		isStr(obj.comment) &&
		Array.isArray(obj.indices) &&
		obj.indices.every(isIndex) &&
		isColor(obj.color)
	);
}

export function isAreaShape(obj: unknown): obj is Area {
	return (
		isObject(obj) &&
		isNum(obj.id) &&
		Number.isInteger(obj.id) &&
		isStr(obj.name) &&
		isNum(obj.x) &&
		isNum(obj.y) &&
		isNum(obj.width) &&
		isNum(obj.height) &&
		isColor(obj.color)
	);
}

export function isNoteShape(obj: unknown): obj is Note {
	return (
		isObject(obj) &&
		isNum(obj.id) &&
		Number.isInteger(obj.id) &&
		isNum(obj.x) &&
		isNum(obj.y) &&
		isStr(obj.title) &&
		isStr(obj.content) &&
		isColor(obj.color) &&
		isNum(obj.height)
	);
}

/**
 * Parses clipboard text into a pasteable element, or `null` when the text is not
 * JSON for a table/area/note. Order matches web's paste (table, then area, then
 * note — ControlPanel.jsx:1015-1038). Optional keys the desktop shapes require
 * but the web schema doesn't (`uniqueConstraints`, `collapsed`, `locked`, note
 * `width`) are defaulted so a JSON copied from drawdb.app pastes cleanly.
 */
export function parseClipboardElement(text: string | null | undefined): ClipboardElement | null {
	if (!text) return null;
	let obj: unknown;
	try {
		obj = JSON.parse(text);
	} catch {
		return null;
	}
	if (isTableShape(obj)) {
		const t = obj as Table;
		return {
			kind: 'table',
			data: {
				...t,
				uniqueConstraints: Array.isArray(t.uniqueConstraints) ? t.uniqueConstraints : [],
				collapsed: isBool(t.collapsed) ? t.collapsed : false,
				locked: isBool(t.locked) ? t.locked : false
			}
		};
	}
	if (isAreaShape(obj)) {
		const a = obj as Area;
		return { kind: 'area', data: { ...a, locked: isBool(a.locked) ? a.locked : false } };
	}
	if (isNoteShape(obj)) {
		const n = obj as Note;
		return {
			kind: 'note',
			data: {
				...n,
				width: isNum(n.width) ? n.width : noteWidth,
				locked: isBool(n.locked) ? n.locked : false
			}
		};
	}
	return null;
}

/** JSON text written to the clipboard for an element (web copies plain `JSON.stringify`). */
export function serializeClipboardElement(el: ClipboardElement): string {
	return JSON.stringify(el.data);
}

/**
 * Returns a deep copy of `el` offset by PASTE_OFFSET with a fresh id, ready to
 * hand to the diagram add paths. Tables get `newTableId`; areas/notes get
 * `newIndex` (their ids are array positions, and addArea/addNote re-assign it
 * to `prev.length` anyway). Field ids are kept, as in web — they only need to
 * be unique within their table.
 */
export function prepareForPaste(
	el: ClipboardElement,
	ids: { newTableId: string; newIndex: number }
): ClipboardElement {
	// Deep clone so the copy never shares `fields`/`indices` arrays with the original.
	const data = JSON.parse(JSON.stringify(el.data));
	data.x = el.data.x + PASTE_OFFSET;
	data.y = el.data.y + PASTE_OFFSET;
	if (el.kind === 'table') {
		data.id = ids.newTableId;
		return { kind: 'table', data };
	}
	data.id = ids.newIndex;
	return el.kind === 'area' ? { kind: 'area', data } : { kind: 'note', data };
}
