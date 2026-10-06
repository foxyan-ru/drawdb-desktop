import { writable } from 'svelte/store';
import { ObjectType, Tab } from '$lib/data/constants';

export interface SelectedElement {
	element: number;
	id: string | number;
	open: boolean;
	currentTab: string;
}

export const selectedElement = writable<SelectedElement>({
	element: ObjectType.NONE,
	id: -1,
	open: false,
	currentTab: Tab.TABLES
});

export const bulkSelectedElements = writable<any[]>([]);

export function clearSelection() {
	selectedElement.set({
		element: ObjectType.NONE,
		id: -1,
		open: false,
		currentTab: Tab.TABLES
	});
}
