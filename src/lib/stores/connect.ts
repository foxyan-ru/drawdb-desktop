import { writable } from 'svelte/store';

export interface ConnectSource {
	tableId: string;
	fieldId: string;
}

export interface Connecting {
	from: ConnectSource;
	x: number | null;
	y: number | null;
}

export const relationshipMode = writable<boolean>(false);
export const connecting = writable<Connecting | null>(null);
