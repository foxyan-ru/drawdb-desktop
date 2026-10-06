import { get } from 'svelte/store';
import { _ } from 'svelte-i18n';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
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
import { MODAL, State } from '$lib/data/constants';

/**
 * Shared file/diagram actions used by both the in-app header (ControlPanel.svelte)
 * and the native OS menu bar (menu.ts), so both surfaces stay behaviorally identical
 * instead of duplicating this logic.
 */

function translate(key: string): string {
	return get(_)(key) as string;
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
			const data = JSON.stringify(exportDiagram(), null, 2);
			await invoke('save_to_path', { path: filePath, data });
			currentDiagramPath.set(filePath);
			const name = filePath.split(/[/\\]/).pop()?.replace(/\.(ddb|json)$/, '') || translate('untitled');
			currentDiagramName.set(name);
			saveState.set(State.SAVED);
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
		if (filePath) {
			saveState.set(State.LOADING);
			const raw: string = await invoke('read_from_path', { path: filePath });
			const data = JSON.parse(raw);
			loadDiagram(data);
			clearHistory();
			currentDiagramPath.set(filePath as string);
			const name =
				(filePath as string).split(/[/\\]/).pop()?.replace(/\.(ddb|json)$/, '') || translate('untitled');
			currentDiagramName.set(name);
			saveState.set(State.SAVED);
		}
	} catch {
		saveState.set(State.FAILED_TO_LOAD);
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
			filters: [{ name: 'JSON or SQL', extensions: ['json', 'sql', 'ddb'] }]
		});
		if (filePath) {
			const raw: string = await invoke('read_from_path', { path: filePath });
			const data = JSON.parse(raw);
			loadDiagram(data);
			clearHistory();
			const name =
				(filePath as string).split(/[/\\]/).pop()?.replace(/\.(ddb|json|sql)$/, '') || translate('imported');
			currentDiagramName.set(name);
			currentDiagramPath.set(null);
			saveState.set(State.NONE);
		}
	} catch {
		saveState.set(State.FAILED_TO_LOAD);
	}
}
