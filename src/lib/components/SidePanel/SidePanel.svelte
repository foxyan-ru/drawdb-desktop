<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { Tab, ObjectType } from '$lib/data/constants';
	import { database } from '$lib/stores/diagram';
	import { selectedElement } from '$lib/stores/select';
	import { databases } from '$lib/data/databases';
	import TablesTab from './TablesTab.svelte';
	import ViewsTab from './ViewsTab.svelte';
	import RelationshipsTab from './RelationshipsTab.svelte';
	import AreasTab from './AreasTab.svelte';
	import NotesTab from './NotesTab.svelte';
	import EnumsTab from './EnumsTab.svelte';
	import TypesTab from './TypesTab.svelte';

	let currentTab = $state<string>(Tab.TABLES);
	let db = $state($database);
	let dbInfo = $derived(databases[db]);

	$effect(() => {
		return database.subscribe((v) => {
			db = v;
		});
	});

	$effect(() => {
		return selectedElement.subscribe((sel) => {
			if (sel.currentTab) {
				currentTab = sel.currentTab;
			}
		});
	});

	function switchTab(tab: string) {
		currentTab = tab;
		selectedElement.update((prev) => ({ ...prev, currentTab: tab }));
	}

	const tabDefs = $derived.by(() => {
		const base: { key: string; label: string }[] = [
			{ key: Tab.TABLES, label: $_('tables') },
			// Web puts Views right after Tables (EditorSidePanel/SidePanel.jsx:44-89).
			{ key: Tab.VIEWS, label: $_('views') },
			{ key: Tab.RELATIONSHIPS, label: $_('relationships') },
			{ key: Tab.AREAS, label: $_('areas') },
			{ key: Tab.NOTES, label: $_('notes') }
		];
		if (dbInfo?.hasTypes) {
			base.push({ key: Tab.TYPES, label: $_('types') });
		}
		if (dbInfo?.hasEnums) {
			base.push({ key: Tab.ENUMS, label: $_('enums') });
		}
		return base;
	});
</script>

<div class="flex h-full w-[280px] min-w-[280px] flex-col border-r border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
	<!-- Tab bar -->
	<div
		class="flex flex-wrap items-center gap-1 border-b border-zinc-300 bg-zinc-50 px-2 pt-2 pb-2 dark:border-zinc-700 dark:bg-zinc-800"
	>
		{#each tabDefs as tab (tab.key)}
			<button
				class="whitespace-nowrap border-b-2 px-2.5 py-1.5 text-xs font-medium transition-colors {currentTab === tab.key
					? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
					: 'border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'}"
				onclick={() => switchTab(tab.key)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- Content area -->
	<div class="flex-1 overflow-y-auto">
		{#if currentTab === Tab.TABLES}
			<TablesTab />
		{:else if currentTab === Tab.VIEWS}
			<ViewsTab />
		{:else if currentTab === Tab.RELATIONSHIPS}
			<RelationshipsTab />
		{:else if currentTab === Tab.AREAS}
			<AreasTab />
		{:else if currentTab === Tab.NOTES}
			<NotesTab />
		{:else if currentTab === Tab.TYPES}
			<TypesTab />
		{:else if currentTab === Tab.ENUMS}
			<EnumsTab />
		{/if}
	</div>
</div>
