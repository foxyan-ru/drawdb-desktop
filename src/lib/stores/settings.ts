import { writable, get } from 'svelte/store';
import { tableWidth } from '$lib/data/constants';

export interface Settings {
	strictMode: boolean;
	showFieldSummary: boolean;
	showGrid: boolean;
	snapToGrid: boolean;
	showDataTypes: boolean;
	mode: 'light' | 'dark';
	autosave: boolean;
	showCardinality: boolean;
	showRelationshipLabels: boolean;
	tableWidth: number;
	showDebugCoordinates: boolean;
	showComments: boolean;
}

/** Syncs the `.dark` class on <html> that Tailwind's `dark:` variant keys off (see app.css). */
function applyThemeClass(mode: Settings['mode']) {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('dark', mode === 'dark');
}

const defaultSettings: Settings = {
	strictMode: false,
	showFieldSummary: true,
	showGrid: true,
	snapToGrid: false,
	showDataTypes: true,
	mode: 'light',
	autosave: true,
	showCardinality: true,
	showRelationshipLabels: true,
	tableWidth: tableWidth,
	showDebugCoordinates: false,
	showComments: false
};

function createSettingsStore() {
	let initial = defaultSettings;
	if (typeof localStorage !== 'undefined') {
		try {
			const saved = localStorage.getItem('drawdb_settings');
			if (saved) initial = { ...defaultSettings, ...JSON.parse(saved) };
		} catch {
			// use defaults
		}
	}

	// WHY: apply the persisted theme immediately at startup, not only on the next change,
	// so `dark:` utilities match the saved mode from first paint.
	applyThemeClass(initial.mode);

	const { subscribe, set, update } = writable<Settings>(initial);

	return {
		subscribe,
		set(value: Settings) {
			set(value);
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem('drawdb_settings', JSON.stringify(value));
			}
			applyThemeClass(value.mode);
		},
		update(fn: (s: Settings) => Settings) {
			update((prev) => {
				const next = fn(prev);
				if (typeof localStorage !== 'undefined') {
					localStorage.setItem('drawdb_settings', JSON.stringify(next));
				}
				applyThemeClass(next.mode);
				return next;
			});
		}
	};
}

export const settings = createSettingsStore();
