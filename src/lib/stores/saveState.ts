import { writable } from 'svelte/store';
// Relative (not `$lib`) so `bun test` can load stores/diagram.ts, which imports this module.
import { State } from '../data/constants';

export const saveState = writable<number>(State.NONE);
export const currentDiagramPath = writable<string | null>(null);
export const currentDiagramName = writable('Untitled');
