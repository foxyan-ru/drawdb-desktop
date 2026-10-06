<script lang="ts">
	import { get } from 'svelte/store';
	import { _ } from 'svelte-i18n';
	import { invoke } from '@tauri-apps/api/core';
	import { save } from '@tauri-apps/plugin-dialog';
	import {
		resetDiagram,
		exportDiagram,
		database
	} from '$lib/stores/diagram';
	import { saveState, currentDiagramName, currentDiagramPath } from '$lib/stores/saveState';
	import { MODAL, State, type DBType } from '$lib/data/constants';

	let {
		modal = $bindable(MODAL.NONE),
	}: {
		modal: number;
	} = $props();

	let renameValue = $state('');
	let exportedSQL = $state('');
	let copyLabel = $state($_('copy'));

	let isOpen = $derived(modal !== MODAL.NONE);

	let title = $derived(
		modal === MODAL.NEW
			? $_('new_diagram')
			: modal === MODAL.IMPORT
				? $_('import_diagram')
				: modal === MODAL.EXPORT_SQL
					? $_('export_sql')
					: modal === MODAL.RENAME
						? $_('rename_diagram')
						: ''
	);

	$effect(() => {
		if (modal === MODAL.RENAME) {
			renameValue = get(currentDiagramName);
		}
		if (modal === MODAL.EXPORT_SQL) {
			generateSQL();
		}
	});

	function close() {
		modal = MODAL.NONE;
		copyLabel = $_('copy');
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			close();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			close();
		}
	}

	function confirmNew() {
		resetDiagram();
		currentDiagramName.set($_('untitled'));
		currentDiagramPath.set(null);
		saveState.set(State.NONE);
		close();
	}

	function confirmRename() {
		if (renameValue.trim()) {
			currentDiagramName.set(renameValue.trim());
		}
		close();
	}

	function generateSQL() {
		const diagram = exportDiagram();
		const db = diagram.database;
		const tables = diagram.tables || [];
		const lines: string[] = [];

		for (const table of tables) {
			lines.push(`CREATE TABLE ${quoteId(table.name, db)} (`);
			const fieldLines: string[] = [];
			const pks: string[] = [];

			for (const field of table.fields) {
				let line = `  ${quoteId(field.name, db)} ${field.type}`;
				if (field.size) line += `(${field.size})`;
				if (field.notNull) line += ' NOT NULL';
				if (field.unique) line += ' UNIQUE';
				if (field.increment) {
					if (db === 'postgresql') line += ' GENERATED ALWAYS AS IDENTITY';
					else line += ' AUTO_INCREMENT';
				}
				if (field.default) line += ` DEFAULT ${field.default}`;
				if (field.check) line += ` CHECK(${field.check})`;
				if (field.primary) pks.push(quoteId(field.name, db));
				fieldLines.push(line);
			}

			if (pks.length > 0) {
				fieldLines.push(`  PRIMARY KEY (${pks.join(', ')})`);
			}

			lines.push(fieldLines.join(',\n'));
			lines.push(');\n');
		}

		for (const rel of diagram.relationships || []) {
			const startTable = tables.find((t) => t.id === rel.startTableId);
			const endTable = tables.find((t) => t.id === rel.endTableId);
			if (!startTable || !endTable) continue;
			const startField = startTable.fields.find((f) => f.id === rel.startFieldId);
			const endField = endTable.fields.find((f) => f.id === rel.endFieldId);
			if (!startField || !endField) continue;

			lines.push(
				`ALTER TABLE ${quoteId(startTable.name, db)} ADD FOREIGN KEY (${quoteId(startField.name, db)}) REFERENCES ${quoteId(endTable.name, db)}(${quoteId(endField.name, db)});`
			);
		}

		exportedSQL = lines.join('\n');
	}

	function quoteId(name: string, db: string): string {
		if (db === 'postgresql') return `"${name}"`;
		if (db === 'mysql' || db === 'mariadb') return `\`${name}\``;
		if (db === 'transactsql') return `[${name}]`;
		return `"${name}"`;
	}

	async function copySQL() {
		try {
			await navigator.clipboard.writeText(exportedSQL);
			copyLabel = $_('copied');
			setTimeout(() => (copyLabel = $_('copy')), 2000);
		} catch {
			copyLabel = $_('failed');
		}
	}

	async function saveSQL() {
		try {
			const filePath = await save({
				title: $_('save_sql'),
				defaultPath: `${get(currentDiagramName)}.sql`,
				filters: [{ name: 'SQL File', extensions: ['sql'] }]
			});
			if (filePath) {
				await invoke('save_to_path', { path: filePath, data: exportedSQL });
			}
		} catch {
			// save cancelled
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-label={title}
	>
		<div
			class="bg-white dark:bg-zinc-800 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-700 w-full max-w-lg mx-4 overflow-hidden"
		>
			<!-- Title Bar -->
			<div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
				<h2 class="text-base font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
				<button
					class="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
					onclick={close}
					aria-label={$_('close')}
				>
					<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"/>
						<line x1="6" y1="6" x2="18" y2="18"/>
					</svg>
				</button>
			</div>

			<!-- Content Area -->
			<div class="p-4">
				{#if modal === MODAL.NEW}
					<p class="text-zinc-600 dark:text-zinc-300 mb-4">
						{$_('confirm_new')}
					</p>
					<div class="flex justify-end gap-2">
						<button
							class="px-4 py-2 rounded text-sm bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600"
							onclick={close}
						>
							{$_('cancel')}
						</button>
						<button
							class="px-4 py-2 rounded text-sm bg-sky-600 text-white hover:bg-sky-700"
							onclick={confirmNew}
						>
							{$_('create_new')}
						</button>
					</div>

				{:else if modal === MODAL.RENAME}
					<label class="block text-sm text-zinc-600 dark:text-zinc-300 mb-2">{$_('diagram_name')}</label>
					<input
						type="text"
						bind:value={renameValue}
						class="w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 mb-4"
						onkeydown={(e) => { if (e.key === 'Enter') confirmRename(); }}
					/>
					<div class="flex justify-end gap-2">
						<button
							class="px-4 py-2 rounded text-sm bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600"
							onclick={close}
						>
							{$_('cancel')}
						</button>
						<button
							class="px-4 py-2 rounded text-sm bg-sky-600 text-white hover:bg-sky-700"
							onclick={confirmRename}
						>
							{$_('rename')}
						</button>
					</div>

				{:else if modal === MODAL.EXPORT_SQL}
					<div class="relative">
						<textarea
							readonly
							value={exportedSQL}
							class="w-full h-72 px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 text-xs font-mono resize-none focus:outline-none"
						></textarea>
					</div>
					<div class="flex justify-end gap-2 mt-3">
						<button
							class="px-4 py-2 rounded text-sm bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600"
							onclick={close}
						>
							{$_('close')}
						</button>
						<button
							class="px-4 py-2 rounded text-sm bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600"
							onclick={saveSQL}
						>
							{$_('save_to_file')}
						</button>
						<button
							class="px-4 py-2 rounded text-sm bg-sky-600 text-white hover:bg-sky-700 min-w-[72px]"
							onclick={copySQL}
						>
							{copyLabel}
						</button>
					</div>

				{:else if modal === MODAL.IMPORT}
					<p class="text-zinc-600 dark:text-zinc-300 mb-4">
						{$_('import_instructions')}
					</p>
					<div class="flex justify-end">
						<button
							class="px-4 py-2 rounded text-sm bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600"
							onclick={close}
						>
							{$_('close')}
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
