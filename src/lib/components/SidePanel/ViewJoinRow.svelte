<script lang="ts">
	// One row of the Views tab's "Joins" list (web ViewJoin.jsx). Mirrors
	// IndexDetails.svelte's pattern of patching the owning element (here a view,
	// via updateView) rather than holding local state.
	import { _ } from 'svelte-i18n';
	import type { View, Join, JoinOn, Table, Relationship } from '$lib/data/constants';
	import { updateView } from '$lib/stores/views';
	import { JoinType, viewTableIds, suggestJoinCondition } from '$lib/utils/views';

	let {
		view,
		join,
		tables,
		relationships
	}: { view: View; join: Join; tables: Table[]; relationships: Relationship[] } = $props();

	const inputClass =
		'w-full rounded border bg-white px-2 py-1 text-xs text-zinc-900 focus:outline-none dark:bg-zinc-700 dark:text-zinc-100 border-zinc-300 focus:border-blue-500 dark:border-zinc-600';
	const labelClass = 'mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400';

	function patch(values: Partial<Join>) {
		updateView(view.id, { joins: view.joins.map((j) => (j.id === join.id ? { ...j, ...values } : j)) });
	}

	function removeJoin() {
		updateView(view.id, { joins: view.joins.filter((j) => j.id !== join.id) });
	}

	// Web views.js:118-145 — a table already in the view's scope (base table or an
	// earlier join) can't be joined again.
	const scopeIds = $derived(new Set(viewTableIds(view)));
	const joinableTables = $derived(
		tables.filter((t) => t.id === join.tableId || !scopeIds.has(t.id))
	);

	function handleTableChange(tableId: string) {
		const suggested = tableId ? suggestJoinCondition(view, tables, relationships, tableId) : null;
		patch({ tableId: tableId || null, on: suggested });
	}

	function patchOn(values: Partial<JoinOn>) {
		patch({ on: { ...(join.on ?? {}), ...values } });
	}

	// The ON clause's left side can be the base table or any earlier join.
	const leftScopeTables = $derived(
		tables.filter((t) => t.id !== join.tableId && scopeIds.has(t.id))
	);
	const leftTable = $derived(tables.find((t) => t.id === join.on?.leftTableId));
	const rightTable = $derived(tables.find((t) => t.id === join.tableId));
</script>

<div class="mb-2 rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-600 dark:bg-zinc-800">
	<div class="mb-2 flex items-center gap-2">
		<select
			class="{inputClass} w-24 flex-shrink-0"
			value={join.type}
			title={$_('join_type')}
			onchange={(e) => patch({ type: e.currentTarget.value as Join['type'] })}
		>
			{#each Object.values(JoinType) as t}
				<option value={t}>{t}</option>
			{/each}
		</select>
		<select
			class="{inputClass} min-w-0 flex-1"
			value={join.tableId ?? ''}
			title={$_('join_table')}
			onchange={(e) => handleTableChange(e.currentTarget.value)}
		>
			<option value="" disabled>{$_('select_table')}</option>
			{#each joinableTables as t}
				<option value={t.id}>{t.name}</option>
			{/each}
		</select>
		<button
			type="button"
			class="flex-shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-red-400"
			title={$_('remove_join')}
			onclick={removeJoin}
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
				<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
			</svg>
		</button>
	</div>

	{#if join.tableId}
		<!-- ON clause (web ViewJoin.jsx — auto-suggested from an existing relationship, editable) -->
		<div class="grid grid-cols-3 gap-1.5">
			<label class="block">
				<span class={labelClass}>{$_('left_table')}</span>
				<select
					class={inputClass}
					value={join.on?.leftTableId ?? ''}
					onchange={(e) => patchOn({ leftTableId: e.currentTarget.value || null, leftFieldId: null })}
				>
					<option value="" disabled>{$_('select_table')}</option>
					{#each leftScopeTables as t}
						<option value={t.id}>{t.name}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class={labelClass}>{$_('left_field')}</span>
				<select
					class={inputClass}
					value={join.on?.leftFieldId ?? ''}
					disabled={!leftTable}
					onchange={(e) => patchOn({ leftFieldId: e.currentTarget.value || null })}
				>
					<option value="" disabled>{$_('select_field')}</option>
					{#each leftTable?.fields ?? [] as f}
						<option value={f.id}>{f.name}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class={labelClass}>{$_('right_field')}</span>
				<select
					class={inputClass}
					value={join.on?.rightFieldId ?? ''}
					onchange={(e) => patchOn({ rightFieldId: e.currentTarget.value || null })}
				>
					<option value="" disabled>{$_('select_field')}</option>
					{#each rightTable?.fields ?? [] as f}
						<option value={f.id}>{f.name}</option>
					{/each}
				</select>
			</label>
		</div>
	{/if}
</div>
