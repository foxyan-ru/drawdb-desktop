<script lang="ts">
	// Port of drawdb.app `components/EditorSidePanel/TablesTab/IndexDetails.jsx`.
	// Web: a multi-select of column names + a "more" popover (name, unique, delete).
	// Desktop: no Select/Popover primitives exist, so the multi-select is chips +
	// a native <select> of the remaining columns, and the popover content expands
	// inline below the row. Indices store column *names* (TableInfo.jsx:263-266),
	// which is what exportSQL/* reads.
	import { _ } from 'svelte-i18n';
	import type { Table, TableIndex } from '$lib/data/constants';
	import { updateTable } from '$lib/stores/diagram';

	let { index, iid, table }: { index: TableIndex; iid: number; table: Table } = $props();

	let open = $state(false);

	const available = $derived(table.fields.map((f) => f.name).filter((n) => !index.fields.includes(n)));

	// Web matches by `index.id === iid` where iid is the array position
	// (TableInfo.jsx:261); match positionally so indices without ids (older
	// desktop files, introspected schemas) work too.
	function patchIndex(patch: Partial<TableIndex>) {
		updateTable(table.id, {
			indices: (table.indices ?? []).map((idx, k) => (k === iid ? { ...idx, ...patch } : idx))
		});
	}

	function addField(name: string) {
		if (!name || index.fields.includes(name)) return;
		patchIndex({ fields: [...index.fields, name] });
	}

	function removeField(position: number) {
		patchIndex({ fields: index.fields.filter((_, k) => k !== position) });
	}

	function deleteIndex() {
		// IndexDetails.jsx:173-180 — drop and re-number ids.
		updateTable(table.id, {
			indices: (table.indices ?? []).filter((_, k) => k !== iid).map((e, j) => ({ ...e, id: j }))
		});
	}
</script>

<div class="mb-2 rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-600 dark:bg-zinc-800">
	<div class="flex items-start gap-2">
		<div
			class="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded border bg-white px-1.5 py-1 dark:bg-zinc-700 {index
				.fields.length === 0
				? 'border-red-500 dark:border-red-500'
				: 'border-zinc-300 dark:border-zinc-600'}"
		>
			{#each index.fields as name, k}
				<span
					class="inline-flex items-center gap-0.5 rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-800 dark:bg-zinc-600 dark:text-zinc-100"
				>
					{name}
					<button
						type="button"
						class="text-zinc-500 hover:text-red-600 dark:text-zinc-300 dark:hover:text-red-400"
						title={$_('remove_field')}
						onclick={() => removeField(k)}
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
							<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
						</svg>
					</button>
				</span>
			{/each}
			{#if available.length > 0}
				<select
					class="min-w-[70px] flex-1 bg-transparent py-0.5 text-xs text-zinc-500 focus:outline-none dark:text-zinc-400"
					value=""
					onchange={(e) => {
						addField(e.currentTarget.value);
						e.currentTarget.value = '';
					}}
				>
					<option value="" disabled>{$_('select_fields', { default: 'Select columns' })}</option>
					{#each available as name}
						<option value={name}>{name}</option>
					{/each}
				</select>
			{/if}
		</div>
		<button
			type="button"
			class="flex-shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 {open
				? 'bg-zinc-200 dark:bg-zinc-700'
				: ''}"
			title={$_('edit')}
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
				<path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
			</svg>
		</button>
	</div>

	{#if open}
		<div class="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-600">
			<label class="mb-2 block">
				<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('name')}</span>
				<input
					type="text"
					class="w-full rounded border bg-white px-2 py-1 text-xs text-zinc-900 focus:outline-none dark:bg-zinc-700 dark:text-zinc-100 {index.name.trim() ===
					''
						? 'border-red-500 dark:border-red-500'
						: 'border-zinc-300 focus:border-blue-500 dark:border-zinc-600'}"
					placeholder={$_('name')}
					value={index.name}
					oninput={(e) => patchIndex({ name: e.currentTarget.value })}
				/>
			</label>
			<label class="my-2 flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300">
				<span class="font-medium">{$_('unique')}</span>
				<input
					type="checkbox"
					class="h-3.5 w-3.5"
					checked={index.unique}
					onchange={(e) => patchIndex({ unique: e.currentTarget.checked })}
				/>
			</label>
			<button
				type="button"
				class="w-full rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
				onclick={deleteIndex}
			>
				{$_('delete')}
			</button>
		</div>
	{/if}
</div>
