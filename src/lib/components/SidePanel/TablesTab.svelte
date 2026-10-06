<script lang="ts">
	import { nanoid } from 'nanoid';
	import { _ } from 'svelte-i18n';
	import {
		ObjectType,
		type Table,
		type Field,
		defaultBlue
	} from '$lib/data/constants';
	import {
		tables,
		addTable,
		deleteTable,
		updateTable,
		updateField,
		deleteField,
		database
	} from '$lib/stores/diagram';
	import { selectedElement, clearSelection } from '$lib/stores/select';

	let tableList = $state<Table[]>([]);
	let search = $state('');
	let selectedId = $state<string | number>(-1);
	let db = $state('');

	$effect(() => {
		return tables.subscribe((v) => {
			tableList = v;
		});
	});

	$effect(() => {
		return database.subscribe((v) => {
			db = v;
		});
	});

	$effect(() => {
		return selectedElement.subscribe((sel) => {
			if (sel.element === ObjectType.TABLE) {
				selectedId = sel.id;
			} else {
				selectedId = -1;
			}
		});
	});

	const filtered = $derived(
		search.trim()
			? tableList.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
			: tableList
	);

	function selectTable(table: Table) {
		if (selectedId === table.id) {
			clearSelection();
		} else {
			selectedElement.set({
				element: ObjectType.TABLE,
				id: table.id,
				open: true,
				currentTab: '1'
			});
		}
	}

	function handleAddTable() {
		addTable();
	}

	function handleDeleteTable(id: string) {
		deleteTable(id);
	}

	function handleNameChange(id: string, value: string) {
		updateTable(id, { name: value });
	}

	function handleColorChange(id: string, value: string) {
		updateTable(id, { color: value });
	}

	function handleCommentChange(id: string, value: string) {
		updateTable(id, { comment: value });
	}

	function handleFieldNameChange(tid: string, fid: string, value: string) {
		updateField(tid, fid, { name: value });
	}

	function handleFieldTypeChange(tid: string, fid: string, value: string) {
		updateField(tid, fid, { type: value });
	}

	function handleFieldPrimaryToggle(tid: string, fid: string, current: boolean) {
		updateField(tid, fid, { primary: !current });
	}

	function handleFieldNotNullToggle(tid: string, fid: string, current: boolean) {
		updateField(tid, fid, { notNull: !current });
	}

	function handleFieldUniqueToggle(tid: string, fid: string, current: boolean) {
		updateField(tid, fid, { unique: !current });
	}

	function handleFieldIncrementToggle(tid: string, fid: string, current: boolean) {
		updateField(tid, fid, { increment: !current });
	}

	function handleAddField(tid: string) {
		const table = tableList.find((t) => t.id === tid);
		if (!table) return;
		const newField: Field = {
			id: nanoid(),
			name: `field_${table.fields.length}`,
			type: 'INT',
			default: '',
			check: '',
			primary: false,
			unique: false,
			notNull: false,
			increment: false,
			comment: ''
		};
		updateTable(tid, { fields: [...table.fields, newField] });
	}

	function handleDeleteField(tid: string, fid: string) {
		deleteField(tid, fid);
	}

	const commonTypes = [
		'INT',
		'INTEGER',
		'BIGINT',
		'SMALLINT',
		'TINYINT',
		'FLOAT',
		'DOUBLE',
		'DECIMAL',
		'NUMERIC',
		'CHAR',
		'VARCHAR',
		'TEXT',
		'BLOB',
		'DATE',
		'DATETIME',
		'TIMESTAMP',
		'TIME',
		'BOOLEAN',
		'JSON',
		'UUID'
	];
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

	<!-- Table list -->
	{#each filtered as table (table.id)}
		<div class="mb-2 rounded border border-zinc-200 dark:border-zinc-700">
			<!-- Table header row -->
			<button
				class="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 {selectedId === table.id
					? 'bg-blue-50 dark:bg-blue-900/30'
					: ''}"
				onclick={() => selectTable(table)}
			>
				<div class="flex items-center gap-2">
					<span
						class="inline-block h-3 w-3 rounded-sm"
						style="background-color: {table.color}"
					></span>
					<span class="font-medium text-zinc-900 dark:text-zinc-100">{table.name}</span>
				</div>
				<span class="text-xs text-zinc-500 dark:text-zinc-400">
					{table.fields.length} field{table.fields.length !== 1 ? 's' : ''}
				</span>
			</button>

			<!-- Expanded details -->
			{#if selectedId === table.id}
				<div class="border-t border-zinc-200 p-3 dark:border-zinc-700">
					<!-- Name -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('name')}</span>
						<input
							type="text"
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							value={table.name}
							oninput={(e) => handleNameChange(table.id, e.currentTarget.value)}
						/>
					</label>

					<!-- Color -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('color')}</span>
						<input
							type="color"
							class="h-8 w-full cursor-pointer rounded border border-zinc-300 dark:border-zinc-600"
							value={table.color}
							oninput={(e) => handleColorChange(table.id, e.currentTarget.value)}
						/>
					</label>

					<!-- Comment -->
					<label class="mb-3 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('comment')}</span>
						<textarea
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							rows="2"
							value={table.comment}
							oninput={(e) => handleCommentChange(table.id, e.currentTarget.value)}
						></textarea>
					</label>

					<!-- Fields -->
					<div class="mb-2">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('fields')}</span>
					{#each table.fields as field (field.id)}
						<div class="mb-2 rounded border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-600 dark:bg-zinc-800">
							<div class="mb-2 flex items-center gap-2">
								<input
									type="text"
									class="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
									value={field.name}
									oninput={(e) => handleFieldNameChange(table.id, field.id, e.currentTarget.value)}
								/>
								<select
									class="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
									value={field.type}
									onchange={(e) => handleFieldTypeChange(table.id, field.id, e.currentTarget.value)}
								>
									{#each commonTypes as t}
										<option value={t}>{t}</option>
									{/each}
								</select>
								<button
									class="flex-shrink-0 rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/30"
									title={$_('delete_field')}
									onclick={() => handleDeleteField(table.id, field.id)}
								>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
										<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
									</svg>
								</button>
							</div>
							<div class="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px]">
								<label class="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
									<input
										type="checkbox"
										checked={field.primary}
										onchange={() => handleFieldPrimaryToggle(table.id, field.id, field.primary)}
										class="h-3.5 w-3.5"
									/>
									PK
								</label>
								<label class="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
									<input
										type="checkbox"
										checked={field.notNull}
										onchange={() => handleFieldNotNullToggle(table.id, field.id, field.notNull)}
										class="h-3.5 w-3.5"
									/>
									NN
								</label>
								<label class="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
									<input
										type="checkbox"
										checked={field.unique}
										onchange={() => handleFieldUniqueToggle(table.id, field.id, field.unique)}
										class="h-3.5 w-3.5"
									/>
									UQ
								</label>
								<label class="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
									<input
										type="checkbox"
										checked={field.increment}
										onchange={() => handleFieldIncrementToggle(table.id, field.id, field.increment)}
										class="h-3.5 w-3.5"
									/>
									AI
								</label>
							</div>
						</div>
					{/each}
					<button
						class="mt-2 w-full rounded border border-dashed border-zinc-300 py-1.5 text-xs text-zinc-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
						onclick={() => handleAddField(table.id)}
					>
						+ {$_('add_field')}
					</button>
					</div>

					<!-- Delete table button -->
					<button
						class="mt-2 w-full rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
						onclick={() => handleDeleteTable(table.id)}
					>
						{$_('delete_table')}
					</button>
				</div>
			{/if}
		</div>
	{/each}

	{#if filtered.length === 0 && search}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_tables_search')}</p>
	{/if}

	<!-- Add table button -->
	<button
		class="mt-2 w-full rounded bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
		onclick={handleAddTable}
	>
		+ {$_('add_table')}
	</button>
</div>
