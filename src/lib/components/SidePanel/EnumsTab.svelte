<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { ObjectType, type EnumType } from '$lib/data/constants';
	import { enums, addEnum, deleteEnum, updateEnum } from '$lib/stores/diagram';
	import { selectedElement, clearSelection } from '$lib/stores/select';

	let enumList = $state<EnumType[]>([]);
	let selectedId = $state<string | number>(-1);
	let search = $state('');

	$effect(() => {
		return enums.subscribe((v) => {
			enumList = v;
		});
	});

	$effect(() => {
		return selectedElement.subscribe((sel) => {
			if (sel.element === ObjectType.ENUM) {
				selectedId = sel.id;
			} else {
				selectedId = -1;
			}
		});
	});

	const filtered = $derived(
		search.trim()
			? enumList.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
			: enumList
	);

	function selectEnum(item: EnumType) {
		if (selectedId === item.id) {
			clearSelection();
		} else {
			selectedElement.set({
				element: ObjectType.ENUM,
				id: item.id,
				open: true,
				currentTab: '6'
			});
		}
	}

	function handleNameChange(id: string, value: string) {
		updateEnum(id, { name: value });
	}

	function handleAddValue(id: string) {
		const item = enumList.find((e) => e.id === id);
		if (!item) return;
		updateEnum(id, { values: [...item.values, ''] });
	}

	function handleValueChange(id: string, index: number, value: string) {
		const item = enumList.find((e) => e.id === id);
		if (!item) return;
		const newValues = [...item.values];
		newValues[index] = value;
		updateEnum(id, { values: newValues });
	}

	function handleRemoveValue(id: string, index: number) {
		const item = enumList.find((e) => e.id === id);
		if (!item) return;
		const newValues = item.values.filter((_, i) => i !== index);
		updateEnum(id, { values: newValues });
	}

	function handleDelete(id: string) {
		deleteEnum(id);
	}

	function handleAdd() {
		addEnum();
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

	{#each filtered as item (item.id)}
		<div class="mb-2 rounded border border-zinc-200 dark:border-zinc-700">
			<!-- Enum header -->
			<button
				class="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 {selectedId === item.id
					? 'bg-blue-50 dark:bg-blue-900/30'
					: ''}"
				onclick={() => selectEnum(item)}
			>
				<span class="font-medium text-zinc-900 dark:text-zinc-100">{item.name}</span>
				<span class="text-xs text-zinc-500 dark:text-zinc-400">
					{item.values.length} value{item.values.length !== 1 ? 's' : ''}
				</span>
			</button>

			<!-- Expanded details -->
			{#if selectedId === item.id}
				<div class="border-t border-zinc-200 p-3 dark:border-zinc-700">
					<!-- Name -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('name')}</span>
						<input
							type="text"
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							value={item.name}
							oninput={(e) => handleNameChange(item.id, e.currentTarget.value)}
						/>
					</label>

					<!-- Values -->
					<div class="mb-2">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('values')}</span>
						{#each item.values as val, index}
							<div class="mb-1 flex items-center gap-1.5">
								<input
									type="text"
									class="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
									value={val}
									oninput={(e) => handleValueChange(item.id, index, e.currentTarget.value)}
								/>
								<button
									class="flex-shrink-0 rounded p-0.5 text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/30"
									title={$_('remove_value')}
									onclick={() => handleRemoveValue(item.id, index)}
								>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
										<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
									</svg>
								</button>
							</div>
						{/each}
						<button
							class="mt-1 w-full rounded border border-dashed border-zinc-300 py-1 text-xs text-zinc-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
							onclick={() => handleAddValue(item.id)}
						>
							+ {$_('add_value')}
						</button>
					</div>

					<!-- Delete button -->
					<button
						class="mt-2 w-full rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
						onclick={() => handleDelete(item.id)}
					>
						{$_('delete_enum')}
					</button>
				</div>
			{/if}
		</div>
	{/each}

	{#if filtered.length === 0 && search}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_enums_search')}</p>
	{:else if filtered.length === 0}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_enums')}.</p>
	{/if}

	<!-- Add enum button -->
	<button
		class="mt-2 w-full rounded bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
		onclick={handleAdd}
	>
		+ {$_('add_enum')}
	</button>
</div>
