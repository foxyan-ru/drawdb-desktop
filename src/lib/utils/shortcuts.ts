// Relative (not `$lib`) so `bun test` can load this module without SvelteKit's alias map.
import {
	noteWidth,
	tableColorStripHeight,
	tableFieldHeight,
	tableHeaderHeight,
	type Area,
	type Note,
	type Relationship,
	type Table
} from '../data/constants';

/*
 * Pure pieces of the editor's global keyboard shortcuts. Workspace.svelte owns
 * the `<svelte:window onkeydown>` listener and maps each action to the store /
 * file-action call. Hotkey map ported from
 * drawdb-main/src/components/EditorHeader/ControlPanel.jsx:1983-2008.
 */

export type ShortcutAction =
	| 'undo'
	| 'redo'
	| 'save'
	| 'saveAs'
	| 'open'
	| 'import'
	| 'copy'
	| 'cut'
	| 'paste'
	| 'duplicate'
	| 'delete'
	| 'resetView'
	| 'fitWindow'
	| 'zoomIn'
	| 'zoomOut'
	| 'panLeft'
	| 'panRight'
	| 'panUp'
	| 'panDown'
	| 'toggleGrid'
	| 'toggleStrictMode'
	| 'toggleFieldSummary';

export type ShortcutKeyEvent = Pick<
	KeyboardEvent,
	'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
>;

/** Actions that are safe (and expected) to auto-repeat while the key is held. */
export const REPEATABLE_ACTIONS: ReadonlySet<ShortcutAction> = new Set<ShortcutAction>([
	'undo',
	'redo',
	'zoomIn',
	'zoomOut',
	'panLeft',
	'panRight',
	'panUp',
	'panDown'
]);

/**
 * Maps a keydown to an editor action, or null. `mod` = Ctrl or Cmd, matching
 * react-hotkeys-hook's `mod`. `isMac` additionally maps Backspace to delete,
 * since Mac keyboards have no forward-Delete key (web binds `delete` only).
 */
export function matchShortcut(e: ShortcutKeyEvent, isMac = false): ShortcutAction | null {
	const mod = e.ctrlKey || e.metaKey;
	// Letters: compare case-insensitively (Shift upper-cases `key`).
	const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

	if (mod && e.altKey) {
		// `code`, not `key`: on macOS Option turns `w` into `∑`.
		if (!e.shiftKey && (e.code === 'KeyW' || key === 'w')) return 'fitWindow';
		return null;
	}

	if (mod && e.shiftKey) {
		switch (key) {
			case 'z':
				return 'redo';
			case 's':
				return 'saveAs';
			case 'g':
				return 'toggleGrid';
			case 'm':
				return 'toggleStrictMode';
			case 'f':
				return 'toggleFieldSummary';
			default:
				return null;
		}
	}

	if (mod) {
		switch (key) {
			case 'z':
				return 'undo';
			case 'y':
				return 'redo';
			case 's':
				return 'save';
			case 'o':
				return 'open';
			case 'i':
				return 'import';
			case 'c':
				return 'copy';
			case 'x':
				return 'cut';
			case 'v':
				return 'paste';
			case 'd':
				return 'duplicate';
			case 'ArrowUp':
				return 'zoomIn';
			case 'ArrowDown':
				return 'zoomOut';
			default:
				return null;
		}
	}

	if (e.altKey || e.shiftKey) return null;

	switch (key) {
		case 'Delete':
			return 'delete';
		case 'Backspace':
			return isMac ? 'delete' : null;
		case 'Enter':
			return 'resetView';
		case 'ArrowLeft':
			return 'panLeft';
		case 'ArrowRight':
			return 'panRight';
		case 'ArrowUp':
			return 'panUp';
		case 'ArrowDown':
			return 'panDown';
		default:
			return null;
	}
}

/** Minimal element surface used by the predicates below (lets tests pass stubs). */
interface ClosestCapable {
	closest(selector: string): unknown;
	isContentEditable?: boolean;
}

function asElement(target: EventTarget | null | undefined): ClosestCapable | null {
	const t = target as unknown as ClosestCapable | null;
	return t && typeof t.closest === 'function' ? t : null;
}

const EDITABLE_SELECTOR =
	'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .monaco-editor, .cm-editor';

/**
 * True when the event target is (inside) a text-editing surface, where every
 * editor shortcut must stand down so native typing / text undo / text
 * copy-paste keep working. Web gets this from react-hotkeys-hook's default
 * form-tag exclusion plus `EDITOR_HOTKEY.ignoreEventWhen`
 * (ControlPanel.jsx:116-119).
 */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
	const el = asElement(target);
	if (!el) return false;
	if (el.isContentEditable) return true;
	return Boolean(el.closest(EDITABLE_SELECTOR));
}

/**
 * True when Enter on this target already means "activate it" (a focused button,
 * link or menu item), so the reset-view shortcut must not also fire.
 */
export function isActivatableTarget(target: EventTarget | null | undefined): boolean {
	const el = asElement(target);
	if (!el) return false;
	return Boolean(
		el.closest('button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"]')
	);
}

/**
 * Zoom/pan that frames every table, area and note in a `screen`-sized viewport
 * (port of web `fitToView`, ControlPanel.jsx:682-751: 10px padding, zoom floored
 * to a multiple of 0.05, pan = content center). Returns null for an empty
 * diagram (web would compute NaN there).
 */
export function computeFitTransform(
	diagram: { tables: Table[]; areas: Area[]; notes: Note[]; relationships: Relationship[] },
	screen: { x: number; y: number },
	tableWidth: number
): { zoom: number; pan: { x: number; y: number } } | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const grow = (x: number, y: number, w: number, h: number) => {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x + w);
		maxY = Math.max(maxY, y + h);
	};

	for (const table of diagram.tables) {
		// Same height rule as Canvas/Table.svelte: collapsed tables show only linked fields.
		const fieldCount = table.collapsed
			? table.fields.filter((f) =>
					diagram.relationships.some(
						(r) =>
							(r.startTableId === table.id && r.startFieldId === f.id) ||
							(r.endTableId === table.id && r.endFieldId === f.id)
					)
				).length
			: table.fields.length;
		grow(
			table.x,
			table.y,
			tableWidth,
			tableColorStripHeight + tableHeaderHeight + fieldCount * tableFieldHeight
		);
	}
	for (const area of diagram.areas) grow(area.x, area.y, area.width, area.height);
	for (const note of diagram.notes) grow(note.x, note.y, note.width ?? noteWidth, note.height);

	if (!Number.isFinite(minX) || screen.x <= 0 || screen.y <= 0) return null;

	const padding = 10;
	const width = maxX - minX + padding;
	const height = maxY - minY + padding;
	const scale = Math.floor(Math.min(screen.x / width, screen.y / height) * 20) / 20;

	return {
		zoom: scale,
		pan: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
	};
}
