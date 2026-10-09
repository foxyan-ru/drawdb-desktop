import { writable, get, derived } from 'svelte/store';
import { nanoid } from 'nanoid';
// Relative (not `$lib`) so `bun test` can load this module (stores/views.test.ts) without
// SvelteKit's alias map — same convention as select.ts / clipboard.ts.
import {
	DB,
	defaultBlue,
	defaultNoteTheme,
	noteWidth,
	ObjectType,
	type Table,
	type Relationship,
	type Area,
	type Note,
	type EnumType,
	type CustomType,
	type DBType
} from '../data/constants';
import { undoStack, redoStack, snapshotForUndo, resetCoalescing, clearHistory } from './undoRedo';
import { selectedElement, clearSelection } from './select';
import { transform } from './transform';
import { currentDiagramName } from './saveState';
import {
	parseClipboardElement,
	prepareForPaste,
	serializeClipboardElement,
	type ClipboardElement
} from '../utils/clipboard';
import { views } from './views';

export const database = writable<DBType>(DB.GENERIC);
export const tables = writable<Table[]>([]);
export const relationships = writable<Relationship[]>([]);
export const areas = writable<Area[]>([]);
export const notes = writable<Note[]>([]);
export const enums = writable<EnumType[]>([]);
export const types = writable<CustomType[]>([]);

export const tablesCount = derived(tables, ($t) => $t.length);
export const relationshipsCount = derived(relationships, ($r) => $r.length);
export const areasCount = derived(areas, ($a) => $a.length);
export const notesCount = derived(notes, ($n) => $n.length);
export const enumsCount = derived(enums, ($e) => $e.length);
export const typesCount = derived(types, ($t) => $t.length);

export function addTable(data?: { table: Table; index?: number }) {
	const $transform = get(transform);
	const $database = get(database);
	const id = nanoid();
	const newTable: Table = {
		id,
		name: `table_${id.slice(0, 6)}`,
		x: $transform.pan.x,
		y: $transform.pan.y,
		locked: false,
		fields: [
			{
				name: 'id',
				type: $database === DB.GENERIC ? 'INT' : 'INTEGER',
				default: '',
				check: '',
				primary: true,
				unique: false,
				notNull: true,
				increment: true,
				comment: '',
				id: nanoid()
			}
		],
		comment: '',
		indices: [],
		uniqueConstraints: [],
		color: defaultBlue,
		collapsed: false
	};

	snapshotForUndo('Add table', exportDiagram());

	if (data) {
		tables.update((prev) => {
			const temp = [...prev];
			temp.splice(data.index ?? prev.length, 0, data.table);
			return temp;
		});
	} else {
		tables.update((prev) => [...prev, newTable]);
	}
}

export function deleteTable(id: string, addToHistory = true) {
	const $tables = get(tables);
	const $relationships = get(relationships);
	const deletedTable = $tables.find((t) => t.id === id);
	const deletedIndex = $tables.findIndex((t) => t.id === id);
	const rels = $relationships.filter((r) => r.startTableId === id || r.endTableId === id);

	if (addToHistory && deletedTable) {
		snapshotForUndo(`Delete table ${deletedTable.name}`, exportDiagram());
	}

	relationships.update((prev) => prev.filter((r) => r.startTableId !== id && r.endTableId !== id));
	tables.update((prev) => prev.filter((t) => t.id !== id));

	const $sel = get(selectedElement);
	if ($sel.id === id) clearSelection();
}

export function updateTable(id: string, values: Partial<Table>) {
	snapshotForUndo('Edit table', exportDiagram(), `table:${id}`);
	tables.update((prev) => prev.map((t) => (t.id === id ? { ...t, ...values } : t)));
}

export function updateField(tid: string, fid: string, values: Record<string, any>) {
	snapshotForUndo('Edit field', exportDiagram(), `field:${tid}:${fid}`);
	tables.update((prev) =>
		prev.map((table) => {
			if (table.id === tid) {
				return {
					...table,
					fields: table.fields.map((field) => (field.id === fid ? { ...field, ...values } : field))
				};
			}
			return table;
		})
	);
}

export function deleteField(tid: string, fid: string, addToHistory = true) {
	const $tables = get(tables);
	const $relationships = get(relationships);
	const table = $tables.find((t) => t.id === tid);
	if (!table) return;
	const field = table.fields.find((f) => f.id === fid);
	if (!field) return;

	const affectedRels = $relationships.filter(
		(r) =>
			(r.startTableId === tid && r.startFieldId === fid) ||
			(r.endTableId === tid && r.endFieldId === fid)
	);

	if (addToHistory) {
		snapshotForUndo(`Delete field from ${table.name}`, exportDiagram());
	}

	relationships.update((prev) =>
		prev.filter(
			(r) =>
				!(
					(r.startTableId === tid && r.startFieldId === fid) ||
					(r.endTableId === tid && r.endFieldId === fid)
				)
		)
	);
	tables.update((prev) =>
		prev.map((t) => (t.id === tid ? { ...t, fields: t.fields.filter((f) => f.id !== fid) } : t))
	);
}

export function addRelationship(data: Relationship | { relationship: Relationship; index?: number }, addToHistory = true) {
	const rel = 'relationship' in data ? data.relationship : data;
	if (addToHistory) {
		snapshotForUndo('Add relationship', exportDiagram());
	}
	relationships.update((prev) => {
		if ('index' in data && data.index !== undefined) {
			const temp = [...prev];
			temp.splice(data.index, 0, rel);
			return temp;
		}
		return [...prev, rel];
	});
}

export function deleteRelationship(id: string, addToHistory = true) {
	const $relationships = get(relationships);
	const rel = $relationships.find((r) => r.id === id);

	if (addToHistory && rel) {
		snapshotForUndo(`Delete relationship ${rel.name}`, exportDiagram());
	}

	relationships.update((prev) => prev.filter((r) => r.id !== id));

	const $sel = get(selectedElement);
	if ($sel.element === ObjectType.RELATIONSHIP && $sel.id === id) clearSelection();
}

export function updateRelationship(id: string, values: Partial<Relationship>) {
	snapshotForUndo('Edit relationship', exportDiagram(), `rel:${id}`);
	relationships.update((prev) => prev.map((r) => (r.id === id ? { ...r, ...values } : r)));
}

export function addArea(data?: Area) {
	const $transform = get(transform);
	const $areas = get(areas);
	const created: Area = data || {
		id: $areas.length,
		name: `area_${$areas.length}`,
		x: $transform.pan.x - 100,
		y: $transform.pan.y - 100,
		width: 200,
		height: 200,
		color: defaultBlue,
		locked: false
	};

	snapshotForUndo('Add area', exportDiagram());
	areas.update((prev) => [...prev, { ...created, id: prev.length }]);
}

export function deleteArea(id: number, addToHistory = true) {
	const $areas = get(areas);
	if (addToHistory) {
		snapshotForUndo(`Delete area ${$areas[id]?.name}`, exportDiagram());
	}
	areas.update((prev) => prev.filter((a) => a.id !== id).map((a, i) => ({ ...a, id: i })));

	const $sel = get(selectedElement);
	if ($sel.id === id) clearSelection();
}

export function updateArea(id: number, values: Partial<Area>) {
	snapshotForUndo('Edit area', exportDiagram(), `area:${id}`);
	areas.update((prev) => prev.map((a) => (a.id === id ? { ...a, ...values } : a)));
}

export function addNote(data?: Note) {
	const $transform = get(transform);
	const $notes = get(notes);
	const created: Note = data || {
		id: $notes.length,
		x: $transform.pan.x,
		y: $transform.pan.y - 44,
		title: `note_${$notes.length}`,
		content: '',
		color: defaultNoteTheme,
		height: 88,
		width: noteWidth,
		locked: false
	};

	snapshotForUndo('Add note', exportDiagram());
	notes.update((prev) => [...prev, { ...created, id: prev.length }]);
}

export function deleteNote(id: number, addToHistory = true) {
	const $notes = get(notes);
	if (addToHistory) {
		snapshotForUndo(`Delete note ${$notes[id]?.title}`, exportDiagram());
	}
	notes.update((prev) => prev.filter((n) => n.id !== id).map((n, i) => ({ ...n, id: i })));

	const $sel = get(selectedElement);
	if ($sel.id === id) clearSelection();
}

export function updateNote(id: number, values: Partial<Note>) {
	snapshotForUndo('Edit note', exportDiagram(), `note:${id}`);
	notes.update((prev) => prev.map((n) => (n.id === id ? { ...n, ...values } : n)));
}

export function addEnum(data?: { enum: EnumType; index?: number }) {
	const id = nanoid();
	const newEnum: EnumType = { id, name: `enum_${get(enums).length}`, values: [] };
	snapshotForUndo('Add enum', exportDiagram());
	if (data) {
		enums.update((prev) => {
			const temp = [...prev];
			temp.splice(data.index ?? prev.length, 0, data.enum);
			return temp;
		});
	} else {
		enums.update((prev) => [...prev, newEnum]);
	}
}

export function deleteEnum(id: string, addToHistory = true) {
	const $enums = get(enums);
	const enumIndex = $enums.findIndex((e) => e.id === id);
	if (addToHistory) {
		snapshotForUndo(`Delete enum ${$enums[enumIndex]?.name}`, exportDiagram());
	}
	enums.update((prev) => prev.filter((e) => e.id !== id));
}

export function updateEnum(id: string, values: Partial<EnumType>) {
	snapshotForUndo('Edit enum', exportDiagram(), `enum:${id}`);
	enums.update((prev) => prev.map((e) => (e.id === id ? { ...e, ...values } : e)));
}

export function addType(data?: { type: CustomType; index?: number }) {
	const id = nanoid();
	const newType: CustomType = { id, name: `type_${get(types).length}`, fields: [], comment: '' };
	snapshotForUndo('Add type', exportDiagram());
	if (data) {
		types.update((prev) => {
			const temp = [...prev];
			temp.splice(data.index ?? prev.length, 0, data.type);
			return temp;
		});
	} else {
		types.update((prev) => [...prev, newType]);
	}
}

export function deleteType(id: string, addToHistory = true) {
	const $types = get(types);
	const typeIndex = $types.findIndex((t) => t.id === id);
	if (addToHistory) {
		snapshotForUndo(`Delete type ${$types[typeIndex]?.name}`, exportDiagram());
	}
	types.update((prev) => prev.filter((t) => t.id !== id));
}

export function updateType(id: string, values: Partial<CustomType>) {
	snapshotForUndo('Edit type', exportDiagram(), `type:${id}`);
	types.update((prev) => prev.map((t) => (t.id === id ? { ...t, ...values } : t)));
}

export function loadDiagram(data: any) {
	tables.set(data.tables || []);
	relationships.set(data.relationships || []);
	areas.set(data.subjectAreas || data.areas || []);
	notes.set(data.notes || []);
	enums.set(data.enums || []);
	types.set(data.types || []);
	views.set(data.views || []);
	database.set(data.database || DB.GENERIC);
	clearSelection();
}

// WHY: key names follow the web JSON schema (drawdb-main/src/data/schemas.js:224-295),
// which requires `subjectAreas` (not `areas`) and accepts `title`, so a desktop-saved
// .ddb/.json imports cleanly into drawdb.app. loadDiagram keeps the `areas` fallback
// for files saved by older desktop builds.
export function exportDiagram() {
	return {
		title: get(currentDiagramName),
		tables: get(tables),
		relationships: get(relationships),
		subjectAreas: get(areas),
		notes: get(notes),
		enums: get(enums),
		types: get(types),
		// Web key (ControlPanel.jsx:1066); views live in their own store (./views).
		views: get(views),
		database: get(database)
	};
}

export function resetDiagram() {
	tables.set([]);
	relationships.set([]);
	areas.set([]);
	notes.set([]);
	enums.set([]);
	types.set([]);
	views.set([]);
	database.set(DB.GENERIC);
	clearSelection();
	clearHistory();
}

/** Reverts to the diagram state before the most recent change, if any. */
export function undo() {
	const stack = get(undoStack);
	if (stack.length === 0) return;

	const entry = stack[stack.length - 1];
	const current = exportDiagram();

	undoStack.set(stack.slice(0, -1));
	redoStack.update((s) => [...s, { message: entry.message, snapshot: current }]);
	loadDiagram(entry.snapshot);
	resetCoalescing();
}

/** Re-applies the most recently undone change, if any. */
export function redo() {
	const stack = get(redoStack);
	if (stack.length === 0) return;

	const entry = stack[stack.length - 1];
	const current = exportDiagram();

	redoStack.set(stack.slice(0, -1));
	undoStack.update((s) => [...s, { message: entry.message, snapshot: current }]);
	loadDiagram(entry.snapshot);
	resetCoalescing();
}

// --- Clipboard: copy / paste / duplicate (web ControlPanel.jsx:901-1040) ---

/**
 * In-app clipboard: JSON text of the last copied table/area/note. This is the
 * source of truth for paste; the OS clipboard is written best-effort on copy
 * (so the JSON can be pasted into drawdb.app or a text editor, like web) but is
 * only *read* when this is empty — reading it via `navigator.clipboard.readText()`
 * can trigger a permission prompt / paste callout in WebView2 and WKWebView.
 */
export const clipboard = writable<string | null>(null);

/** The currently selected table/area/note as a clipboard element, or null. */
function selectedClipboardElement(): ClipboardElement | null {
	const $sel = get(selectedElement);
	switch ($sel.element) {
		case ObjectType.TABLE: {
			const table = get(tables).find((t) => t.id === $sel.id);
			return table ? { kind: 'table', data: table } : null;
		}
		case ObjectType.AREA: {
			const area = get(areas).find((a) => a.id === $sel.id);
			return area ? { kind: 'area', data: area } : null;
		}
		case ObjectType.NOTE: {
			const note = get(notes).find((n) => n.id === $sel.id);
			return note ? { kind: 'note', data: note } : null;
		}
		default:
			return null;
	}
}

/** True when a table/area/note is selected, i.e. copy/cut/duplicate have a target. */
export function hasCopyableSelection(): boolean {
	return selectedClipboardElement() !== null;
}

/** Inserts an offset copy of `el` through the normal add paths (undo snapshot included). */
function insertPastedElement(el: ClipboardElement) {
	const prepared = prepareForPaste(el, {
		newTableId: nanoid(),
		newIndex: el.kind === 'area' ? get(areas).length : get(notes).length
	});
	if (prepared.kind === 'table') addTable({ table: prepared.data });
	else if (prepared.kind === 'area') addArea(prepared.data);
	else addNote(prepared.data);
}

/**
 * Copies the selected table/area/note. Returns false when nothing copyable is
 * selected (relationships are not copied, as in web's `copy`).
 */
export function copyElement(): boolean {
	const el = selectedClipboardElement();
	if (!el) return false;
	const text = serializeClipboardElement(el);
	clipboard.set(text);
	try {
		void navigator.clipboard?.writeText(text).catch(() => {
			// OS clipboard unavailable/denied — the in-app clipboard above still works.
		});
	} catch {
		// no navigator (tests / non-browser) — in-app clipboard only
	}
	return true;
}

/**
 * Pastes the clipboard element at +20/+20 with a new id. Returns false when the
 * clipboard is empty or does not hold a table/area/note.
 */
export async function pasteElement(): Promise<boolean> {
	let text = get(clipboard);
	if (!text) {
		try {
			text = (await navigator.clipboard?.readText()) ?? null;
		} catch {
			text = null;
		}
	}
	const el = parseClipboardElement(text);
	if (!el) return false;
	insertPastedElement(el);
	return true;
}

/**
 * Duplicates the selected table/area/note at +20/+20 without touching the
 * clipboard (web's `duplicate` doesn't either). Returns false when nothing
 * copyable is selected.
 */
export function duplicateElement(): boolean {
	const el = selectedClipboardElement();
	if (!el) return false;
	insertPastedElement(el);
	return true;
}
