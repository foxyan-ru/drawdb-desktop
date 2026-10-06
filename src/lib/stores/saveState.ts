import { writable } from 'svelte/store';
import { State } from '$lib/data/constants';

export const saveState = writable(State.NONE);
export const currentDiagramPath = writable<string | null>(null);
export const currentDiagramName = writable('Untitled');
