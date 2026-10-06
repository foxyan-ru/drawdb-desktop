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

	const { subscribe, set, update } = writable<Settings>(initial);

	return {
		subscribe,
		set(value: Settings) {
			set(value);
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem('drawdb_settings', JSON.stringify(value));
			}
			document.documentElement.classList.toggle('dark', value.mode === 'dark');
		},
		update(fn: (s: Settings) => Settings) {
			update((prev) => {
				const next = fn(prev);
				if (typeof localStorage !== 'undefined') {
					localStorage.setItem('drawdb_settings', JSON.stringify(next));
				}
				document.documentElement.classList.toggle('dark', next.mode === 'dark');
				return next;
			});
		}
	};
}

export const settings = createSettingsStore();
