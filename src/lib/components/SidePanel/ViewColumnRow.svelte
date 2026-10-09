<script lang="ts">
	// One row of the Views tab's "Output columns" list (web ViewOutputColumn.jsx).
	import { _ } from 'svelte-i18n';
	import type { View, ViewColumn, Table } from '$lib/data/constants';
	import { updateView } from '$lib/stores/views';
	import { viewColumnOptions } from '$lib/utils/views';

	let { view, column, tables }: { view: View; column: ViewColumn; tables: Table[] } = $props();

	const inputClass =
		'w-full rounded border bg-white px-2 py-1 text-xs text-zinc-900 focus:outline-none dark:bg-zinc-700 dark:text-zinc-100 border-zinc-300 focus:border-blue-500 dark:border-zinc-600';

	const columnOptions = $derived(viewColumnOptions(view, tables));
	const columnValue = $derived(column.tableId && column.fieldId ? `${column.tableId}:${column.fieldId}` : '');

	function patch(values: Partial<ViewColumn>) {
		updateView(view.id, {
			columns: view.columns.map((c) => (c.id === column.id ? { ...c, ...values } : c))
		});
	}

	function removeColumn() {
		updateView(view.id, { columns: view.columns.filter((c) => c.id !== column.id) });
	}

	function handleColumnChange(value: string) {
		const opt = columnOptions.find((o) => o.value === value);
		patch({ tableId: opt?.tableId ?? null, fieldId: opt?.fieldId ?? null });
	}
</script>

<div class="mb-2 flex items-center gap-1.5">
	<select
		class="{inputClass} min-w-0 flex-1"
		value={columnValue}
		title={$_('field')}
		onchange={(e) => handleColumnChange(e.currentTarget.value)}
	>
		<option value="" disabled>{$_('select_field')}</option>
		{#each columnOptions as opt}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
	<input
		type="text"
		class="{inputClass} min-w-0 flex-1"
		placeholder={$_('alias')}
		value={column.alias}
		oninput={(e) => patch({ alias: e.currentTarget.value })}
	/>
	<button
		type="button"
		class="flex-shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-red-400"
		title={$_('remove_column')}
		onclick={removeColumn}
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
		</svg>
	</button>
</div>
