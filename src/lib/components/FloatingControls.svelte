<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { addTable, addArea, addNote } from '$lib/stores/diagram';
	import { relationshipMode } from '$lib/stores/connect';

	function handleAddTable() {
		addTable();
	}

	function handleAddArea() {
		addArea();
	}

	function handleAddNote() {
		addNote();
	}

	function toggleRelationshipMode() {
		relationshipMode.update((v) => !v);
	}
</script>

<div class="absolute bottom-4 right-4 flex flex-col items-end gap-2 z-30">
	{#if $relationshipMode}
		<div
			class="max-w-[220px] rounded-lg bg-zinc-800 px-3 py-2 text-xs leading-relaxed text-white shadow-lg dark:bg-zinc-700"
		>
			{$_('relationship_hint')}
		</div>
	{/if}

	<!-- Add Table -->
	<button
		class="w-10 h-10 rounded-full bg-sky-600 hover:bg-sky-700 text-white shadow-lg flex items-center justify-center transition-colors"
		title={$_('add_table')}
		onclick={handleAddTable}
	>
		<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
			<line x1="3" y1="9" x2="21" y2="9"/>
			<line x1="3" y1="15" x2="21" y2="15"/>
			<line x1="9" y1="3" x2="9" y2="21"/>
		</svg>
	</button>

	<!-- Add Area -->
	<button
		class="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg flex items-center justify-center transition-colors"
		title={$_('add_area')}
		onclick={handleAddArea}
	>
		<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke-dasharray="4 2"/>
		</svg>
	</button>

	<!-- Add Note -->
	<button
		class="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-lg flex items-center justify-center transition-colors"
		title={$_('add_note')}
		onclick={handleAddNote}
	>
		<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
			<polyline points="14 2 14 8 20 8"/>
			<line x1="16" y1="13" x2="8" y2="13"/>
			<line x1="16" y1="17" x2="8" y2="17"/>
		</svg>
	</button>

	<!-- Add Relationship Mode -->
	<button
		class="w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-colors {$relationshipMode
			? 'bg-purple-700 ring-2 ring-purple-400'
			: 'bg-purple-600 hover:bg-purple-700'} text-white"
		title={$_('add_relationship')}
		onclick={toggleRelationshipMode}
	>
		<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<line x1="6" y1="6" x2="18" y2="18"/>
			<circle cx="6" cy="6" r="3"/>
			<circle cx="18" cy="18" r="3"/>
		</svg>
	</button>
</div>
