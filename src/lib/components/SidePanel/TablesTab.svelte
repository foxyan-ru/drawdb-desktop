<script lang="ts">
	import { nanoid } from 'nanoid';
	import { _ } from 'svelte-i18n';
	import {
		DB,
		ObjectType,
		type Table,
		type Field,
		type TableIndex,
		type EnumType,
		type CustomType
	} from '$lib/data/constants';
	import {
		tables,
		addTable,
		deleteTable,
		updateTable,
		updateField,
		database,
		enums,
		types
	} from '$lib/stores/diagram';
	import { selectedElement, clearSelection } from '$lib/stores/select';
	import { getTypeNames, resolveType } from '$lib/data/datatypes';
	import FieldDetails from './FieldDetails.svelte';
	import IndexDetails from './IndexDetails.svelte';

	let tableList = $state<Table[]>([]);
	let search = $state('');
	let selectedId = $state<string | number>(-1);
	let db = $state('');
	let enumList = $state<EnumType[]>([]);
	let typeList = $state<CustomType[]>([]);
	// Which field's details panel (web: FieldDetails popover) is expanded.
	let openFieldId = $state<string | null>(null);

	$effect(() => {
		return enums.subscribe((v) => {
			enumList = v;
		});
	});

	$effect(() => {
		return types.subscribe((v) => {
			typeList = v;
		});
	});

	// TableField.jsx:70-87 — the engine's built-in types, then user-defined
	// types and enums (upper-cased, as web does). De-duplicated so a custom type
	// named like a built-in does not produce two identical <option>s.
	const typeOptions = $derived([
		...new Set([
			...getTypeNames(db),
			...typeList.map((t) => t.name.toUpperCase()),
			...enumList.map((e) => e.name.toUpperCase())
		])
	]);

	// Keep a field's current type selectable even if it is not valid for the
	// active engine (e.g. after switching databases), so it is not silently blanked.
	function optionsFor(field: Field): string[] {
		return field.type && !typeOptions.includes(field.type) ? [field.type, ...typeOptions] : typeOptions;
	}

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

	// Port of TableField.jsx:92-151 — reset size/default/values to fit the new type.
	function handleFieldTypeChange(tid: string, field: Field, value: string) {
		if (value === field.type) return;
		const typeInfo = resolveType(db, value);
		const incr = field.increment && !!typeInfo.canIncrement;

		if (value === 'ENUM' || value === 'SET') {
			updateField(tid, field.id, {
				type: value,
				default: '',
				values: field.values ? [...field.values] : [],
				increment: incr
			});
		} else if (typeInfo.isSized || typeInfo.hasPrecision) {
			updateField(tid, field.id, {
				type: value,
				size: typeInfo.defaultSize ?? undefined,
				increment: incr
			});
		} else {
			// Web's next branch tests `!typeInfo.hasDefault`, a property no type
			// defines, so it always wins and its later hasCheck/else branches are
			// unreachable (TableField.jsx:129-150). Port the effective behavior.
			updateField(tid, field.id, {
				type: value,
				increment: incr,
				default: '',
				size: '',
				values: []
			});
		}
	}

	function handleFieldPrimaryToggle(tid: string, fid: string, current: boolean) {
		updateField(tid, fid, { primary: !current });
	}

	function handleFieldNotNullToggle(tid: string, fid: string, current: boolean) {
		updateField(tid, fid, { notNull: !current });
	}

	function toggleFieldDetails(fid: string) {
		openFieldId = openFieldId === fid ? null : fid;
	}

	// TableInfo.jsx:96-114 — new index named `<table>_index_<n>`, no columns yet.
	function handleAddIndex(table: Table) {
		const indices = table.indices ?? [];
		const newIndex: TableIndex = {
			id: indices.length,
			name: `${table.name}_index_${indices.length}`,
			unique: false,
			fields: []
		};
		updateTable(table.id, { indices: [...indices, newIndex] });
	}

	function handleAddField(tid: string) {
		const table = tableList.find((t) => t.id === tid);
		if (!table) return;
		const newField: Field = {
			id: nanoid(),
			name: `field_${table.fields.length}`,
			// Same default as addTable() in diagram.ts: INT only exists in the generic list.
			type: db === DB.GENERIC ? 'INT' : 'INTEGER',
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
									class="min-w-0 flex-1 rounded border bg-white px-2 py-1 text-xs text-zinc-900 focus:outline-none dark:bg-zinc-700 dark:text-zinc-100 {field.type ===
									''
										? 'border-red-500 dark:border-red-500'
										: 'border-zinc-300 focus:border-blue-500 dark:border-zinc-600'}"
									value={field.type}
									title={$_('type')}
									onchange={(e) => handleFieldTypeChange(table.id, field, e.currentTarget.value)}
								>
									{#each optionsFor(field) as t}
										<option value={t}>{t}</option>
									{/each}
								</select>
							</div>
							<!-- TableField.jsx:155-231 — nullable "?" toggle, primary-key toggle, "more" (FieldDetails) -->
							<div class="flex items-center gap-1.5">
								<button
									type="button"
									class="h-6 w-6 rounded text-xs font-semibold transition-colors {field.notNull
										? 'bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600'
										: 'bg-blue-500 text-white hover:bg-blue-600'}"
									title={$_('nullable', { default: 'Nullable' })}
									aria-pressed={!field.notNull}
									onclick={() => handleFieldNotNullToggle(table.id, field.id, field.notNull)}
								>
									?
								</button>
								<button
									type="button"
									class="flex h-6 w-6 items-center justify-center rounded transition-colors {field.primary
										? 'bg-blue-500 text-white hover:bg-blue-600'
										: 'bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600'}"
									title={$_('primary_key')}
									aria-pressed={field.primary}
									onclick={() => handleFieldPrimaryToggle(table.id, field.id, field.primary)}
								>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
										<path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clip-rule="evenodd" />
									</svg>
								</button>
								<span class="flex-1"></span>
								<button
									type="button"
									class="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 {openFieldId ===
									field.id
										? 'bg-zinc-200 dark:bg-zinc-700'
										: ''}"
									title={$_('edit')}
									aria-expanded={openFieldId === field.id}
									onclick={() => toggleFieldDetails(field.id)}
								>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
										<path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
									</svg>
								</button>
							</div>
							{#if openFieldId === field.id}
								<FieldDetails {field} tid={table.id} {db} />
							{/if}
						</div>
					{/each}
					<button
						class="mt-2 w-full rounded border border-dashed border-zinc-300 py-1.5 text-xs text-zinc-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
						onclick={() => handleAddField(table.id)}
					>
						+ {$_('add_field')}
					</button>
					</div>

					<!-- Indices (TableInfo.jsx:243-272, IndexDetails.jsx) -->
					<div class="mb-2">
						{#if (table.indices ?? []).length > 0}
							<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('indices')}</span>
							{#each table.indices as index, k}
								<IndexDetails {index} iid={k} {table} />
							{/each}
						{/if}
						<button
							class="mt-1 w-full rounded border border-dashed border-zinc-300 py-1.5 text-xs text-zinc-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
							onclick={() => handleAddIndex(table)}
						>
							+ {$_('add_index')}
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
