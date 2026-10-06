<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { ObjectType, type Area, defaultBlue } from '$lib/data/constants';
	import { areas, addArea, deleteArea, updateArea } from '$lib/stores/diagram';
	import { selectedElement, clearSelection } from '$lib/stores/select';

	let areaList = $state<Area[]>([]);
	let selectedId = $state<number>(-1);
	let search = $state('');

	$effect(() => {
		return areas.subscribe((v) => {
			areaList = v;
		});
	});

	$effect(() => {
		return selectedElement.subscribe((sel) => {
			if (sel.element === ObjectType.AREA) {
				selectedId = sel.id as number;
			} else {
				selectedId = -1;
			}
		});
	});

	const filtered = $derived(
		search.trim()
			? areaList.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
			: areaList
	);

	function selectArea(area: Area) {
		if (selectedId === area.id) {
			clearSelection();
		} else {
			selectedElement.set({
				element: ObjectType.AREA,
				id: area.id,
				open: true,
				currentTab: '3'
			});
		}
	}

	function handleNameChange(id: number, value: string) {
		updateArea(id, { name: value });
	}

	function handleColorChange(id: number, value: string) {
		updateArea(id, { color: value });
	}

	function handleDelete(id: number) {
		deleteArea(id);
	}

	function handleAdd() {
		addArea();
	}
</script>

<div class="p-3">
	<!-- Search -->
	<div class="mb-3">
		<input
			type="text"
			placeholder={$_('search')}
			class="w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
			bind:value={search}
		/>
	</div>

	{#each filtered as area (area.id)}
		<div class="mb-2 rounded border border-zinc-200 dark:border-zinc-700">
			<!-- Area header -->
			<button
				class="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 {selectedId === area.id
					? 'bg-blue-50 dark:bg-blue-900/30'
					: ''}"
				onclick={() => selectArea(area)}
			>
				<div class="flex items-center gap-2">
					<span
						class="inline-block h-3 w-3 rounded-sm"
						style="background-color: {area.color}"
					></span>
					<span class="font-medium text-zinc-900 dark:text-zinc-100">{area.name}</span>
				</div>
			</button>

			<!-- Expanded details -->
			{#if selectedId === area.id}
				<div class="border-t border-zinc-200 p-3 dark:border-zinc-700">
					<!-- Name -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('name')}</span>
						<input
							type="text"
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							value={area.name}
							oninput={(e) => handleNameChange(area.id, e.currentTarget.value)}
						/>
					</label>

					<!-- Color -->
					<label class="mb-3 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('color')}</span>
						<input
							type="color"
							class="h-8 w-full cursor-pointer rounded border border-zinc-300 dark:border-zinc-600"
							value={area.color}
							oninput={(e) => handleColorChange(area.id, e.currentTarget.value)}
						/>
					</label>

					<!-- Delete button -->
					<button
						class="w-full rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
						onclick={() => handleDelete(area.id)}
					>
						{$_('delete_area')}
					</button>
				</div>
			{/if}
		</div>
	{/each}

	{#if filtered.length === 0 && search}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_areas_search')}</p>
	{:else if filtered.length === 0}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_areas')}.</p>
	{/if}

	<!-- Add area button -->
	<button
		class="mt-2 w-full rounded bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
		onclick={handleAdd}
	>
		+ {$_('add_area')}
	</button>
</div>
