import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

/**
 * Recently opened/saved diagrams, backed by the Rust `get_recent_files` /
 * `add_recent_file` commands (src-tauri/src/lib.rs), which persist up to 10
 * entries (most recent first) in app-data `recent.json`.
 *
 * Shape mirrors the Rust `DiagramFile` struct. `modified` is an ISO-8601
 * timestamp of when the file was last opened/saved from this app (used for
 * web's "Open recent" relative-time labels).
 */
export interface RecentFile {
	path: string;
	name: string;
	modified: string;
}

export const recentFiles = writable<RecentFile[]>([]);

/** Reloads the recent-files list from the backend and returns it. */
export async function loadRecentFiles(): Promise<RecentFile[]> {
	try {
		const files: RecentFile[] = await invoke('get_recent_files');
		recentFiles.set(files);
		return files;
	} catch (err) {
		// No Tauri runtime (browser preview) or unreadable recent.json:
		// keep the current list rather than failing the caller.
		console.warn('[recentFiles] get_recent_files failed', err);
		return [];
	}
}

/**
 * Records `path` as the most recently used diagram. Never throws: a failure
 * here must not turn a successful open/save into an error.
 */
export async function addRecentFile(path: string, name: string): Promise<void> {
	const file: RecentFile = { path, name, modified: new Date().toISOString() };
	try {
		await invoke('add_recent_file', { file });
		// Mirror the backend's dedupe + most-recent-first + cap-at-10 logic locally
		// so subscribers update without another round trip.
		recentFiles.update((prev) => [file, ...prev.filter((f) => f.path !== path)].slice(0, 10));
	} catch (err) {
		console.warn('[recentFiles] add_recent_file failed', err);
	}
}
