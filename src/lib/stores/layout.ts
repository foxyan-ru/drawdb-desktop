import { writable } from 'svelte/store';

export interface Layout {
	header: boolean;
	sidebar: boolean;
	issues: boolean;
	toolbar: boolean;
}

export const layout = writable<Layout>({
	header: true,
	sidebar: true,
	issues: true,
	toolbar: true
});
