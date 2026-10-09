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
