<script lang="ts">
	import { _ } from 'svelte-i18n';
	import {
		ObjectType,
		Cardinality,
		Constraint,
		type Relationship,
		type Table
	} from '$lib/data/constants';
	import {
		tables,
		relationships,
		deleteRelationship,
		updateRelationship
	} from '$lib/stores/diagram';
	import { selectedElement, clearSelection } from '$lib/stores/select';

	let relationshipList = $state<Relationship[]>([]);
	let tableList = $state<Table[]>([]);
	let selectedId = $state<string | number>(-1);
	let search = $state('');

	$effect(() => {
		return relationships.subscribe((v) => {
			relationshipList = v;
		});
	});

	$effect(() => {
		return tables.subscribe((v) => {
			tableList = v;
		});
	});

	$effect(() => {
		return selectedElement.subscribe((sel) => {
			if (sel.element === ObjectType.RELATIONSHIP) {
				selectedId = sel.id;
			} else {
				selectedId = -1;
			}
		});
	});

	function getTableName(id: string): string {
		const t = tableList.find((table) => table.id === id);
		return t ? t.name : 'Unknown';
	}

	const filtered = $derived(
		search.trim()
			? relationshipList.filter(
					(r) =>
						r.name.toLowerCase().includes(search.toLowerCase()) ||
						getTableName(r.startTableId).toLowerCase().includes(search.toLowerCase()) ||
						getTableName(r.endTableId).toLowerCase().includes(search.toLowerCase())
				)
			: relationshipList
	);

	function selectRelationship(rel: Relationship) {
		if (selectedId === rel.id) {
			clearSelection();
		} else {
			selectedElement.set({
				element: ObjectType.RELATIONSHIP,
				id: rel.id,
				open: true,
				currentTab: '2'
			});
		}
	}

	function handleCardinalityChange(id: string, value: string) {
		updateRelationship(id, { cardinality: value as Relationship['cardinality'] });
	}

	function handleUpdateConstraintChange(id: string, value: string) {
		updateRelationship(id, { updateConstraint: value });
	}

	function handleDeleteConstraintChange(id: string, value: string) {
		updateRelationship(id, { deleteConstraint: value });
	}

	function handleDelete(id: string) {
		deleteRelationship(id);
	}

	const cardinalityOptions = $derived([
		{ value: Cardinality.ONE_TO_ONE, label: $_('one_to_one') },
		{ value: Cardinality.ONE_TO_MANY, label: $_('one_to_many') },
		{ value: Cardinality.MANY_TO_ONE, label: $_('many_to_one') }
	]);

	const constraintLabelKeys: Record<string, string> = {
		[Constraint.NONE]: 'no_action',
		[Constraint.RESTRICT]: 'restrict',
		[Constraint.CASCADE]: 'cascade',
		[Constraint.SET_NULL]: 'set_null',
		[Constraint.SET_DEFAULT]: 'set_default'
	};

	const constraintOptions = $derived(
		Object.entries(Constraint).map(([, value]) => ({
			value,
			label: $_(constraintLabelKeys[value])
		}))
	);
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

	{#each filtered as rel (rel.id)}
		<div class="mb-2 rounded border border-zinc-200 dark:border-zinc-700">
			<!-- Relationship header -->
			<button
				class="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 {selectedId === rel.id
					? 'bg-blue-50 dark:bg-blue-900/30'
					: ''}"
				onclick={() => selectRelationship(rel)}
			>
				<div class="min-w-0 flex-1">
					<div class="truncate font-medium text-zinc-900 dark:text-zinc-100">{rel.name}</div>
					<div class="truncate text-xs text-zinc-500 dark:text-zinc-400">
						{getTableName(rel.startTableId)} &rarr; {getTableName(rel.endTableId)}
					</div>
				</div>
			</button>

			<!-- Expanded details -->
			{#if selectedId === rel.id}
				<div class="border-t border-zinc-200 p-3 dark:border-zinc-700">
					<!-- Cardinality -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('cardinality')}</span>
						<select
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							value={rel.cardinality}
							onchange={(e) => handleCardinalityChange(rel.id, e.currentTarget.value)}
						>
							{#each cardinalityOptions as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</label>

					<!-- Update constraint -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('on_update')}</span>
						<select
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							value={rel.updateConstraint}
							onchange={(e) => handleUpdateConstraintChange(rel.id, e.currentTarget.value)}
						>
							{#each constraintOptions as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</label>

					<!-- Delete constraint -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('on_delete')}</span>
						<select
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							value={rel.deleteConstraint}
							onchange={(e) => handleDeleteConstraintChange(rel.id, e.currentTarget.value)}
						>
							{#each constraintOptions as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</label>

					<!-- Tables info -->
					<div class="mb-3 rounded bg-zinc-100 p-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
						<div>{$_('from_label')}: <span class="font-medium">{getTableName(rel.startTableId)}</span></div>
						<div>{$_('to_label')}: <span class="font-medium">{getTableName(rel.endTableId)}</span></div>
					</div>

					<!-- Delete button -->
					<button
						class="w-full rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
						onclick={() => handleDelete(rel.id)}
					>
						{$_('delete_relationship')}
					</button>
				</div>
			{/if}
		</div>
	{/each}

	{#if filtered.length === 0 && search}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_relationships_search')}</p>
	{:else if filtered.length === 0}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_relationships')}. {$_('relationship_hint')}</p>
	{/if}
</div>
