<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { importSourceOpen, closeImportSource } from '$lib/stores/modal';
	import {
		database,
		exportDiagram,
		loadDiagram,
		addTable,
		addRelationship,
		addEnum,
		addType
	} from '$lib/stores/diagram';
	import { clearHistory } from '$lib/stores/undoRedo';
	import { setTransform } from '$lib/stores/transform';
	import { showToast } from '$lib/stores/toast';
	import { databases } from '$lib/data/databases';
	import { DB } from '$lib/data/constants';
	import {
		IMPORT_DIALECTS,
		applyImportedDiagram,
		describeParseError,
		importSQL,
		isImportSupported,
		parseSQL,
		resolveImportDialect,
		type ImportedDiagram
	} from '$lib/utils/importSQL';

	/*
	 * IMPORT_SRC dialog — port of drawdb-main/src/components/EditorHeader/Modal/ImportSource.jsx
	 * plus the parse/apply pipeline from Modal.jsx:121-195. Web uses a Monaco editor
	 * and a drag-and-drop Upload; the desktop uses a plain textarea and the native
	 * file dialog (same pattern as actions/fileActions.ts).
	 */

	type TabKey = 'text' | 'file';

	const btnCls =
		'px-3 py-1.5 rounded text-sm bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed';
	const primaryBtnCls =
		'px-3 py-1.5 rounded text-sm bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed';

	let tab = $state<TabKey>('text');
	// Shared by both tabs, as on web (`importSource.src`): an uploaded file's text
	// also shows up in the Insert SQL tab for review.
	let src = $state('');
	let fileName = $state<string | null>(null);
	let overwrite = $state(false);
	// Web's `importDb`, only consulted for Generic diagrams (Modal.jsx:122).
	let pickedDialect = $state<string>(DB.MYSQL);
	let error = $state<string | null>(null);
	let busy = $state(false);

	let backdropPress = false;

	let isGeneric = $derived($database === DB.GENERIC);
	let targetDialect = $derived(resolveImportDialect($database, pickedDialect));
	let supported = $derived(isImportSupported(targetDialect));
	let canImport = $derived(supported && src.trim().length > 0 && !busy);

	function clearError() {
		error = null;
	}

	function reportError(message: string) {
		error = message;
		showToast(message, 'error', 6000);
	}

	async function chooseFile() {
		try {
			const filePath = await open({
				title: $_('upload_file'),
				multiple: false,
				filters: [
					{ name: $_('import_sql_file_filter'), extensions: ['sql'] },
					{ name: $_('import_sql_all_files'), extensions: ['*'] }
				]
			});
			if (!filePath) return;
			const raw: string = await invoke('read_from_path', { path: filePath as string });
			src = raw;
			fileName = (filePath as string).split(/[/\\]/).pop() ?? (filePath as string);
			clearError();
		} catch (err) {
			reportError($_('import_sql_file_error', { values: { error: err instanceof Error ? err.message : String(err) } }));
		}
	}

	function removeFile() {
		fileName = null;
		src = '';
		clearError();
	}

	async function doImport() {
		if (!canImport) return;
		busy = true;
		clearError();
		const diagramDb = $database;
		const dialect = targetDialect;
		try {
			let ast: unknown;
			try {
				ast = await parseSQL(src, dialect);
			} catch (err) {
				const info = describeParseError(err);
				reportError(
					info.line !== undefined
						? $_('parse_error_at', {
								values: { name: info.name, line: info.line, column: info.column ?? 0, message: info.message }
							})
						: info.message
				);
				return;
			}

			let diagram: ImportedDiagram | null = null;
			try {
				diagram = importSQL(ast, dialect, diagramDb);
			} catch (err) {
				console.error('[ImportSourceModal] AST conversion failed:', err);
				reportError($_('check_syntax_errors'));
				return;
			}
			if (!diagram) return;

			applyImportedDiagram(
				diagram,
				{
					overwrite,
					hasTypes: !!databases[diagramDb]?.hasTypes,
					hasEnums: !!databases[diagramDb]?.hasEnums
				},
				{
					exportDiagram,
					loadDiagram,
					addTable,
					addRelationship,
					addEnum,
					addType,
					clearHistory,
					resetPan: () => setTransform({ pan: { x: 0, y: 0 } })
				}
			);
			close();
		} finally {
			busy = false;
		}
	}

	// ---------------- modal chrome (same pattern as ConnectionManagerModal) ----------------

	function close() {
		src = '';
		fileName = null;
		error = null;
		tab = 'text';
		closeImportSource();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && $importSourceOpen && !busy) close();
	}

	// Only close when press AND release both land on the backdrop, so a text
	// selection dragged out of the textarea doesn't dismiss the dialog.
	function handleBackdropDown(e: MouseEvent) {
		backdropPress = e.target === e.currentTarget;
	}

	function handleBackdropClick(e: MouseEvent) {
		if (backdropPress && e.target === e.currentTarget && !busy) close();
		backdropPress = false;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $importSourceOpen}
	<!-- select-text: mounted from ControlPanel; never inherit the header's select-none. -->
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm select-text text-sm"
		onmousedown={handleBackdropDown}
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-label={$_('import_sql')}
		tabindex="-1"
	>
		<div
			class="bg-white dark:bg-zinc-800 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden"
		>
			<!-- Title Bar -->
			<div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
				<h2 class="text-base font-semibold text-zinc-800 dark:text-zinc-100">{$_('import_sql')}</h2>
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

			<div class="flex-1 overflow-y-auto p-4">
				{#if isGeneric}
					<!-- Generic diagrams: the user names the script's dialect (web: File → Import from → SQL → <db>). -->
					<label class="flex items-center gap-2 mb-3">
						<span class="text-xs text-zinc-600 dark:text-zinc-300">{$_('import_sql_dialect')}</span>
						<select
							class="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
							bind:value={pickedDialect}
							onchange={clearError}
						>
							{#each IMPORT_DIALECTS as d}
								<option value={d}>{databases[d]?.name ?? d}</option>
							{/each}
						</select>
					</label>
				{/if}

				{#if !supported}
					<div class="rounded px-3 py-2 mb-3 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
						{$_('import_sql_unsupported', { values: { db: databases[$database]?.name ?? $database } })}
					</div>
				{/if}

				<!-- Tabs (web ImportSource.jsx:16-71) -->
				<div class="flex gap-1 border-b border-zinc-200 dark:border-zinc-700 mb-3">
					{#each [['text', 'insert_sql'], ['file', 'upload_file']] as [key, label]}
						<button
							class="px-3 py-1.5 -mb-px border-b-2 text-sm {tab === key
								? 'border-sky-600 text-sky-700 dark:text-sky-400'
								: 'border-transparent text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-zinc-100'}"
							onclick={() => (tab = key as TabKey)}
						>
							{$_(label)}
						</button>
					{/each}
				</div>

				{#if tab === 'text'}
					<textarea
						class="w-full h-56 px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 font-mono text-xs resize-y focus:outline-none focus:ring-2 focus:ring-sky-500"
						spellcheck="false"
						placeholder={$_('import_sql_placeholder')}
						bind:value={src}
						oninput={clearError}
					></textarea>
				{:else}
					<div class="h-56 rounded border-2 border-dashed border-zinc-300 dark:border-zinc-600 flex flex-col items-center justify-center gap-3 px-4 text-center">
						<svg class="w-8 h-8 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
						<p class="text-xs text-zinc-500 dark:text-zinc-400">{$_('upload_sql_to_generate_diagrams')}</p>
						{#if fileName}
							<div class="flex items-center gap-2">
								<span class="font-medium text-zinc-800 dark:text-zinc-100 truncate max-w-xs" title={fileName}>{fileName}</span>
								<button class="{btnCls} !py-0.5 !px-2 text-xs" onclick={removeFile}>{$_('import_sql_remove_file')}</button>
							</div>
						{:else}
							<button class={btnCls} onclick={chooseFile}>{$_('import_sql_choose_file')}</button>
						{/if}
					</div>
				{/if}

				<label class="flex items-center gap-2 mt-3 text-zinc-700 dark:text-zinc-200">
					<input type="checkbox" class="accent-sky-600" bind:checked={overwrite} />
					{$_('overwrite_existing_diagram')}
				</label>

				{#if error}
					<!-- Error banner (web ImportSource.jsx:87-92) -->
					<div class="mt-3 rounded px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm break-words whitespace-pre-wrap" role="alert">
						{error}
					</div>
				{/if}
			</div>

			<div class="flex justify-end gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 shrink-0">
				<button class={btnCls} onclick={close} disabled={busy}>{$_('cancel')}</button>
				<button class={primaryBtnCls} onclick={doImport} disabled={!canImport}>
					{busy ? $_('import_sql_importing') : $_('import')}
				</button>
			</div>
		</div>
	</div>
{/if}
