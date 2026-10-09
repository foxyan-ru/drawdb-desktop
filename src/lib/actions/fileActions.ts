import { get } from 'svelte/store';
import { _ } from 'svelte-i18n';
import { invoke } from '@tauri-apps/api/core';
import { save, open, message } from '@tauri-apps/plugin-dialog';
import {
	resetDiagram,
	loadDiagram,
	exportDiagram,
	tables,
	relationships,
	undo,
	redo
} from '$lib/stores/diagram';
import { saveState, currentDiagramName, currentDiagramPath } from '$lib/stores/saveState';
import { clearHistory } from '$lib/stores/undoRedo';
import { openModal } from '$lib/stores/modal';
import { addRecentFile } from '$lib/stores/recentFiles';
import { MODAL, State } from '$lib/data/constants';

/**
 * Shared file/diagram actions used by both the in-app header (ControlPanel.svelte)
 * and the native OS menu bar (menu.ts), so both surfaces stay behaviorally identical
 * instead of duplicating this logic.
 */

function translate(key: string): string {
	return get(_)(key) as string;
}

/**
 * Parses diagram file contents, throwing a readable error when the file is not
 * a diagram JSON document (e.g. a .sql file, or JSON missing `tables`).
 */
function parseDiagramFile(raw: string): any {
	let data: any;
	try {
		data = JSON.parse(raw);
	} catch {
		throw new Error('The selected file is not valid JSON.');
	}
	if (!data || typeof data !== 'object' || !Array.isArray(data.tables)) {
		throw new Error('The selected file is not a DrawDB diagram (missing "tables").');
	}
	return data;
}

/**
 * Surfaces a load/import failure. No toast system exists yet, so use the native
 * error dialog (dialog:allow-message is granted); fall back to the console when
 * no Tauri runtime is present (browser preview).
 */
async function reportLoadError(err: unknown) {
	const detail = err instanceof Error ? err.message : String(err);
	console.error('[fileActions] failed to load diagram:', err);
	try {
		await message(detail, { title: translate('file_load_error'), kind: 'error' });
	} catch {
		// no Tauri runtime — console.error above is the only surface
	}
}

export async function handleNew() {
	const $tables = get(tables);
	const $rels = get(relationships);
	if ($tables.length > 0 || $rels.length > 0) {
		openModal(MODAL.NEW);
	} else {
		resetDiagram();
		currentDiagramName.set(translate('untitled'));
		currentDiagramPath.set(null);
		saveState.set(State.NONE);
	}
}

export async function handleSave() {
	const path = get(currentDiagramPath);
	if (path) {
		try {
			saveState.set(State.SAVING);
			const data = JSON.stringify(exportDiagram(), null, 2);
			await invoke('save_to_path', { path, data });
			saveState.set(State.SAVED);
			void addRecentFile(path, get(currentDiagramName));
		} catch {
			saveState.set(State.ERROR);
		}
	} else {
		await handleSaveAs();
	}
}

export async function handleSaveAs() {
	try {
		const filePath = await save({
			title: translate('save_diagram'),
			defaultPath: `${get(currentDiagramName)}.ddb`,
			filters: [{ name: 'DrawDB Diagram', extensions: ['ddb', 'json'] }]
		});
		if (filePath) {
			saveState.set(State.SAVING);
			const name = filePath.split(/[/\\]/).pop()?.replace(/\.(ddb|json)$/, '') || translate('untitled');
			// Write the new file name as `title`; currentDiagramName only updates after a successful write.
			const data = JSON.stringify({ ...exportDiagram(), title: name }, null, 2);
			await invoke('save_to_path', { path: filePath, data });
			currentDiagramPath.set(filePath);
			currentDiagramName.set(name);
			saveState.set(State.SAVED);
			void addRecentFile(filePath, name);
		}
	} catch {
		saveState.set(State.ERROR);
	}
}

export async function handleOpen() {
	try {
		const filePath = await open({
			title: translate('open_diagram'),
			multiple: false,
			filters: [{ name: 'DrawDB Diagram', extensions: ['ddb', 'json'] }]
		});
		if (filePath) await openDiagramAtPath(filePath as string);
	} catch (err) {
		saveState.set(State.FAILED_TO_LOAD);
		await reportLoadError(err);
	}
}

/**
 * Opens the diagram at `path` as the current document (also the entry point for
 * an "Open recent" list — see `$lib/stores/recentFiles`).
 */
export async function openDiagramAtPath(path: string) {
	try {
		saveState.set(State.LOADING);
		const raw: string = await invoke('read_from_path', { path });
		const data = parseDiagramFile(raw);
		loadDiagram(data);
		clearHistory();
		currentDiagramPath.set(path);
		const name = path.split(/[/\\]/).pop()?.replace(/\.(ddb|json)$/, '') || translate('untitled');
		currentDiagramName.set(name);
		saveState.set(State.SAVED);
		void addRecentFile(path, name);
	} catch (err) {
		saveState.set(State.FAILED_TO_LOAD);
		await reportLoadError(err);
	}
}

export function handleUndo() {
	undo();
}

export function handleRedo() {
	redo();
}

export async function handleImport() {
	try {
		const filePath = await open({
			title: translate('import_diagram'),
			multiple: false,
			// WHY: `.sql` is not offered until SQL import lands (needs a parser); it used to be
			// accepted here and then JSON-parsed, failing silently (audit F-8).
			filters: [{ name: 'DrawDB Diagram (JSON)', extensions: ['json', 'ddb'] }]
		});
		if (filePath) {
			const raw: string = await invoke('read_from_path', { path: filePath });
			const data = parseDiagramFile(raw);
			loadDiagram(data);
			clearHistory();
			const name =
				(filePath as string).split(/[/\\]/).pop()?.replace(/\.(ddb|json)$/, '') || translate('imported');
			currentDiagramName.set(name);
			currentDiagramPath.set(null);
			saveState.set(State.NONE);
		}
	} catch (err) {
		saveState.set(State.FAILED_TO_LOAD);
		await reportLoadError(err);
	}
}
