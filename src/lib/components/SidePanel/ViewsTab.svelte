<script lang="ts">
	// Port of drawdb.app `components/EditorSidePanel/ViewsTab/*` (ViewsTab, ViewInfo,
	// ViewJoin, ViewCondition, ViewOutputColumn). Same accordion-list shell as
	// TablesTab.svelte; join/condition/column rows are their own components
	// (ViewJoinRow/ViewConditionRow/ViewColumnRow.svelte) since each carries a
	// small ON-clause/operator/alias editor of its own, mirroring FieldDetails/
	// IndexDetails being split out of TablesTab.
	import { nanoid } from 'nanoid';
	import { _ } from 'svelte-i18n';
	import { ObjectType, type View, type Join, type Condition, type ViewColumn, type Table, type Relationship } from '$lib/data/constants';
	import { tables, relationships, database } from '$lib/stores/diagram';
	import { views, addView, deleteView, updateView } from '$lib/stores/views';
	import { selectedElement, clearSelection } from '$lib/stores/select';
	import { buildViewSQL, supportsMaterializedViews } from '$lib/utils/views';
	import ViewJoinRow from './ViewJoinRow.svelte';
	import ViewConditionRow from './ViewConditionRow.svelte';
	import ViewColumnRow from './ViewColumnRow.svelte';

	let viewList = $state<View[]>([]);
	let tableList = $state<Table[]>([]);
	let relationshipList = $state<Relationship[]>([]);
	let search = $state('');
	let selectedId = $state<string | number>(-1);
	let db = $state('');

	$effect(() => {
		return views.subscribe((v) => {
			viewList = v;
		});
	});

	$effect(() => {
		return tables.subscribe((v) => {
			tableList = v;
		});
	});

	$effect(() => {
		return relationships.subscribe((v) => {
			relationshipList = v;
		});
	});

	$effect(() => {
		return database.subscribe((v) => {
			db = v;
		});
	});

	$effect(() => {
		return selectedElement.subscribe((sel) => {
			if (sel.element === ObjectType.VIEW) {
				selectedId = sel.id;
			} else {
				selectedId = -1;
			}
		});
	});

	const filtered = $derived(
		search.trim() ? viewList.filter((v) => v.name.toLowerCase().includes(search.toLowerCase())) : viewList
	);

	const materializedSupported = $derived(supportsMaterializedViews(db));

	function selectView(view: View) {
		if (selectedId === view.id) {
			clearSelection();
		} else {
			selectedElement.set({ element: ObjectType.VIEW, id: view.id, open: true, currentTab: '7' });
		}
	}

	function handleAddView() {
		addView();
	}

	function handleDeleteView(id: string) {
		deleteView(id);
	}

	function handleNameChange(id: string, value: string) {
		updateView(id, { name: value });
	}

	function handleColorChange(id: string, value: string) {
		updateView(id, { color: value });
	}

	function handleCommentChange(id: string, value: string) {
		updateView(id, { comment: value });
	}

	function handleMaterializedChange(id: string, value: boolean) {
		updateView(id, { materialized: value });
	}

	// Changing the base table invalidates any join/column/condition that
	// referenced the old scope, so they are dropped rather than left dangling.
	function handleBaseTableChange(view: View, tableId: string) {
		updateView(view.id, { baseTableId: tableId || null, joins: [], columns: [], conditions: [] });
	}

	function handleAddJoin(view: View) {
		const join: Join = { id: nanoid(), type: 'INNER', tableId: null, on: null };
		updateView(view.id, { joins: [...view.joins, join] });
	}

	function handleAddCondition(view: View) {
		const condition: Condition = {
			id: nanoid(),
			connector: 'AND',
			tableId: null,
			fieldId: null,
			operator: '=',
			value: ''
		};
		updateView(view.id, { conditions: [...view.conditions, condition] });
	}

	function handleAddColumn(view: View) {
		const column: ViewColumn = { id: nanoid(), tableId: null, fieldId: null, alias: '' };
		updateView(view.id, { columns: [...view.columns, column] });
	}

	function previewSQL(view: View): string {
		return view.baseTableId ? buildViewSQL(view, tableList, db) : '';
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

	{#each filtered as view (view.id)}
		<div class="mb-2 rounded border border-zinc-200 dark:border-zinc-700">
			<button
				class="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 {selectedId === view.id
					? 'bg-blue-50 dark:bg-blue-900/30'
					: ''}"
				onclick={() => selectView(view)}
			>
				<div class="flex items-center gap-2 min-w-0">
					<span class="inline-block h-3 w-3 shrink-0 rounded-sm" style="background-color: {view.color}"></span>
					<span class="truncate font-medium text-zinc-900 dark:text-zinc-100">{view.name}</span>
				</div>
				<span class="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
					{(view.columns ?? []).length || '*'}
				</span>
			</button>

			{#if selectedId === view.id}
				<div class="border-t border-zinc-200 p-3 dark:border-zinc-700">
					<!-- Name -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('name')}</span>
						<input
							type="text"
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							value={view.name}
							oninput={(e) => handleNameChange(view.id, e.currentTarget.value)}
						/>
					</label>

					<!-- Base table -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('base_table')}</span>
						<select
							class="w-full rounded border bg-white px-2 py-1 text-sm text-zinc-900 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100 {view.baseTableId
								? 'border-zinc-300 focus:border-blue-500 dark:border-zinc-600'
								: 'border-red-500 dark:border-red-500'}"
							value={view.baseTableId ?? ''}
							onchange={(e) => handleBaseTableChange(view, e.currentTarget.value)}
						>
							<option value="" disabled>{$_('select_base_table')}</option>
							{#each tableList as t}
								<option value={t.id}>{t.name}</option>
							{/each}
						</select>
					</label>

					{#if view.baseTableId}
						<!-- Joins -->
						<div class="mb-3">
							<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('joins')}</span>
							{#each view.joins as join (join.id)}
								<ViewJoinRow {view} {join} tables={tableList} relationships={relationshipList} />
							{/each}
							<button
								class="w-full rounded border border-dashed border-zinc-300 py-1.5 text-xs text-zinc-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
								onclick={() => handleAddJoin(view)}
							>
								+ {$_('add_join')}
							</button>
						</div>

						<!-- Where -->
						<div class="mb-3">
							<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('where')}</span>
							{#each view.conditions as condition, i (condition.id)}
								<ViewConditionRow {view} {condition} tables={tableList} index={i} />
							{/each}
							<button
								class="w-full rounded border border-dashed border-zinc-300 py-1.5 text-xs text-zinc-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
								onclick={() => handleAddCondition(view)}
							>
								+ {$_('add_condition')}
							</button>
						</div>

						<!-- Output columns -->
						<div class="mb-3">
							<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('output_columns')}</span>
							{#each view.columns as column (column.id)}
								<ViewColumnRow {view} {column} tables={tableList} />
							{/each}
							<button
								class="w-full rounded border border-dashed border-zinc-300 py-1.5 text-xs text-zinc-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
								onclick={() => handleAddColumn(view)}
							>
								+ {$_('add_column')}
							</button>
						</div>

						<!-- SQL preview -->
						<div class="mb-3">
							<pre class="max-h-32 overflow-auto rounded border border-zinc-200 bg-zinc-100 p-2 text-[11px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{previewSQL(
									view
								)}</pre>
						</div>
					{/if}

					<!-- Materialized (gated on the engine supporting it, web ViewInfo.jsx:216) -->
					{#if materializedSupported}
						<label class="my-2 flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300">
							<span class="font-medium">{$_('materialized')}</span>
							<input
								type="checkbox"
								class="h-3.5 w-3.5"
								checked={!!view.materialized}
								onchange={(e) => handleMaterializedChange(view.id, e.currentTarget.checked)}
							/>
						</label>
					{/if}

					<!-- Color -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('color')}</span>
						<input
							type="color"
							class="h-8 w-full cursor-pointer rounded border border-zinc-300 dark:border-zinc-600"
							value={view.color}
							oninput={(e) => handleColorChange(view.id, e.currentTarget.value)}
						/>
					</label>

					<!-- Comment -->
					<label class="mb-3 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('comment')}</span>
						<textarea
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							rows="2"
							value={view.comment}
							oninput={(e) => handleCommentChange(view.id, e.currentTarget.value)}
						></textarea>
					</label>

					<!-- Delete -->
					<button
						class="mt-2 w-full rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
						onclick={() => handleDeleteView(view.id)}
					>
						{$_('delete_view')}
					</button>
				</div>
			{/if}
		</div>
	{/each}

	{#if filtered.length === 0 && search}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_views_search')}</p>
	{:else if filtered.length === 0}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_views')}. {$_('no_views_text')}</p>
	{/if}

	<!-- Add view -->
	<button
		class="mt-2 w-full rounded bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
		onclick={handleAddView}
	>
		+ {$_('add_view')}
	</button>
</div>
