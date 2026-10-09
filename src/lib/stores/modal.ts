import { writable } from 'svelte/store';
import { MODAL } from '$lib/data/constants';

export const currentModal = writable<number>(MODAL.NONE);
export const modalData = writable<any>(null);

export function openModal(modal: number, data?: any) {
	currentModal.set(modal);
	if (data !== undefined) modalData.set(data);
}

export function closeModal() {
	currentModal.set(MODAL.NONE);
	modalData.set(null);
}

// The DB connection manager is its own component (ConnectionManagerModal.svelte),
// not a `currentModal` value: Header/Modal.svelte opens its overlay for ANY
// non-NONE `currentModal`, so a new MODAL.* id would also pop an empty dialog.
export const connectionManagerOpen = writable(false);

export function openConnectionManager() {
	connectionManagerOpen.set(true);
}

export function closeConnectionManager() {
	connectionManagerOpen.set(false);
}

// Pick-database dialog for a new diagram (PickDatabaseModal.svelte, web
// Workspace.jsx:615-663). Its own flag for the same reason as above.
export const pickDatabaseOpen = writable(false);

export function openPickDatabase() {
	pickDatabaseOpen.set(true);
}

export function closePickDatabase() {
	pickDatabaseOpen.set(false);
}

// Import-from-SQL dialog (ImportSourceModal.svelte, web MODAL.IMPORT_SRC).
// Its own flag for the same reason as above.
export const importSourceOpen = writable(false);

export function openImportSource() {
	importSourceOpen.set(true);
}

export function closeImportSource() {
	importSourceOpen.set(false);
}
