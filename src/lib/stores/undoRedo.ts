import { writable } from 'svelte/store';

/**
 * Snapshot-based undo/redo: each entry holds a full diagram snapshot (the
 * shape returned by `exportDiagram()` in `./diagram`) captured *before* the
 * change it represents, plus a human-readable message. Undo/redo just swap
 * the current diagram for the stored snapshot (see `undo()`/`redo()` in
 * `./diagram`, which is where `exportDiagram`/`loadDiagram` already live).
 *
 * A command-pattern (reverse-applying individual add/edit/delete ops) was
 * considered, but this app's diagrams are small documents — snapshotting the
 * whole thing is simple, can't drift out of sync with the mutation it's
 * supposed to reverse, and needs no per-action-type reverse logic.
 */
export interface UndoEntry {
	message: string;
	snapshot: any;
}

export const undoStack = writable<UndoEntry[]>([]);
export const redoStack = writable<UndoEntry[]>([]);

/** Longest undo history kept before the oldest entries are dropped. */
const MAX_HISTORY = 100;

/**
 * Edits that fire repeatedly for the same target in quick succession — dragging
 * a table across the canvas (many pointermove events), typing into a rename
 * field (one event per keystroke) — must not each get their own undo step, or
 * undo would only ever step back one mouse-move or one character at a time.
 * Callers pass a `coalesceKey` identifying *what* is being edited (e.g.
 * `table:${id}`); repeated snapshots for the same key within this window
 * collapse into the single entry that was pushed at the start of the burst.
 */
const COALESCE_WINDOW_MS = 500;
let lastPush: { key: string; timestamp: number } | null = null;

/**
 * Records `snapshot` (the diagram state as it was *before* the caller's
 * upcoming mutation) as a new undo step, unless it's a continuation of the
 * same coalesced edit as the last push (see above), in which case it's
 * skipped and only the coalescing timer is refreshed.
 */
export function snapshotForUndo(message: string, snapshot: any, coalesceKey?: string) {
	const now = Date.now();
	if (coalesceKey && lastPush && lastPush.key === coalesceKey && now - lastPush.timestamp < COALESCE_WINDOW_MS) {
		lastPush.timestamp = now;
		return;
	}

	undoStack.update((s) => {
		const next = [...s, { message, snapshot }];
		return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
	});
	redoStack.set([]);
	lastPush = coalesceKey ? { key: coalesceKey, timestamp: now } : null;
}

/** Called after undo/redo runs so the next edit never coalesces with history from before it. */
export function resetCoalescing() {
	lastPush = null;
}

export function clearHistory() {
	undoStack.set([]);
	redoStack.set([]);
	lastPush = null;
}
