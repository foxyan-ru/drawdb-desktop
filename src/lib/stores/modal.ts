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
