<script lang="ts">
	// One row of the Views tab's "Where" list (web ViewCondition.jsx).
	import { _ } from 'svelte-i18n';
	import type { View, Condition, Table } from '$lib/data/constants';
	import { updateView } from '$lib/stores/views';
	import { ConditionOperator, operatorTakesValue, viewColumnOptions } from '$lib/utils/views';

	let { view, condition, tables, index }: { view: View; condition: Condition; tables: Table[]; index: number } =
		$props();

	const inputClass =
		'w-full rounded border bg-white px-2 py-1 text-xs text-zinc-900 focus:outline-none dark:bg-zinc-700 dark:text-zinc-100 border-zinc-300 focus:border-blue-500 dark:border-zinc-600';

	const columnOptions = $derived(viewColumnOptions(view, tables));
	const columnValue = $derived(
		condition.tableId && condition.fieldId ? `${condition.tableId}:${condition.fieldId}` : ''
	);

	function patch(values: Partial<Condition>) {
		updateView(view.id, {
			conditions: view.conditions.map((c) => (c.id === condition.id ? { ...c, ...values } : c))
		});
	}

	function removeCondition() {
		updateView(view.id, { conditions: view.conditions.filter((c) => c.id !== condition.id) });
	}

	function handleColumnChange(value: string) {
		const opt = columnOptions.find((o) => o.value === value);
		patch({ tableId: opt?.tableId ?? null, fieldId: opt?.fieldId ?? null });
	}
</script>

<div class="mb-2 flex items-start gap-1.5">
	{#if index > 0}
		<select
			class="{inputClass} w-16 flex-shrink-0"
			value={condition.connector}
			title={$_('connector')}
			onchange={(e) => patch({ connector: e.currentTarget.value as Condition['connector'] })}
		>
			<option value="AND">AND</option>
			<option value="OR">OR</option>
		</select>
	{/if}
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
	<select
		class="{inputClass} w-20 flex-shrink-0"
		value={condition.operator}
		title={$_('operator')}
		onchange={(e) => patch({ operator: e.currentTarget.value })}
	>
		{#each Object.values(ConditionOperator) as op}
			<option value={op}>{op}</option>
		{/each}
	</select>
	{#if operatorTakesValue(condition.operator)}
		<input
			type="text"
			class="{inputClass} min-w-0 flex-1"
			placeholder={$_('value')}
			value={condition.value}
			oninput={(e) => patch({ value: e.currentTarget.value })}
		/>
	{/if}
	<button
		type="button"
		class="flex-shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-red-400"
		title={$_('remove_condition')}
		onclick={removeCondition}
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
		</svg>
	</button>
</div>
