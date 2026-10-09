<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { database } from '$lib/stores/diagram';
	import { settings, type Settings } from '$lib/stores/settings';
	import { layout } from '$lib/stores/layout';
	import { saveState, currentDiagramName } from '$lib/stores/saveState';
	import { undoStack, redoStack } from '$lib/stores/undoRedo';
	import { transform, setTransform } from '$lib/stores/transform';
	import { openModal, openConnectionManager, openImportSource } from '$lib/stores/modal';
	import ConnectionManagerModal from './ConnectionManagerModal.svelte';
	import ImportSourceModal from './ImportSourceModal.svelte';
	import { MODAL, DB, State, type DBType } from '$lib/data/constants';
	import { databases } from '$lib/data/databases';
	import {
		handleNew,
		handleSave,
		handleSaveAs,
		handleOpen,
		handleImport,
		handleUndo,
		handleRedo
	} from '$lib/actions/fileActions';
	import {
		exportDiagramPNG,
		exportDiagramSVG,
		exportDiagramPDF,
		exportDiagramJSON
	} from '$lib/utils/exportImage';

	let dbMenuOpen = $state(false);
	let fileMenuOpen = $state(false);
	let viewMenuOpen = $state(false);

	function closeMenus() {
		dbMenuOpen = false;
		fileMenuOpen = false;
		viewMenuOpen = false;
	}

	function toggleSetting(key: keyof Settings) {
		settings.update((s) => ({ ...s, [key]: !s[key] }));
	}

	function toggleDarkMode() {
		settings.update((s) => ({ ...s, mode: s.mode === 'dark' ? 'light' : 'dark' }));
	}

	function toggleLayout(key: 'header' | 'sidebar' | 'toolbar') {
		layout.update((l) => ({ ...l, [key]: !l[key] }));
	}

	function handleZoomIn() {
		setTransform({ zoom: $transform.zoom * 1.2 });
	}

	function handleZoomOut() {
		setTransform({ zoom: $transform.zoom / 1.2 });
	}

	function handleFitToScreen() {
		setTransform({ zoom: 1, pan: { x: 0, y: 0 } });
	}

	function handleExportSQL() {
		openModal(MODAL.EXPORT_SQL);
	}

	function handleSetDatabase(db: DBType) {
		database.set(db);
		dbMenuOpen = false;
	}

	let zoomPercent = $derived(Math.round($transform.zoom * 100));

	let saveStateLabel = $derived(
		$saveState === State.SAVING
			? $_('saving')
			: $saveState === State.SAVED
				? $_('saved')
				: $saveState === State.ERROR
					? $_('error')
					: $saveState === State.LOADING
						? $_('loading')
						: $saveState === State.FAILED_TO_LOAD
							? $_('failed')
							: ''
	);

	let saveStateDot = $derived(
		$saveState === State.SAVED
			? 'bg-green-500'
			: $saveState === State.SAVING || $saveState === State.LOADING
				? 'bg-yellow-500'
				: $saveState === State.ERROR || $saveState === State.FAILED_TO_LOAD
					? 'bg-red-500'
					: 'bg-zinc-400'
	);

	let currentDbName = $derived(databases[$database]?.name ?? $_('generic'));
</script>

<svelte:window
	onclick={() => closeMenus()}
/>

<header class="flex items-center h-10 bg-white dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 select-none shrink-0 px-2 gap-1 text-sm">
	<!-- App Name -->
	<div class="flex items-center gap-1.5 pr-2 border-r border-zinc-200 dark:border-zinc-700 mr-1">
		<svg class="w-5 h-5 text-sky-700 dark:text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<ellipse cx="12" cy="5" rx="9" ry="3"/>
			<path d="M3 5v14a9 3 0 0 0 18 0V5"/>
			<path d="M3 12a9 3 0 0 0 18 0"/>
		</svg>
		<span class="font-semibold text-sky-700 dark:text-sky-400">DrawDB</span>
	</div>

	<!-- File Menu -->
	<div class="relative">
		<button
			class="px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200"
			onclick={(e) => { e.stopPropagation(); fileMenuOpen = !fileMenuOpen; viewMenuOpen = false; dbMenuOpen = false; }}
		>
			{$_('file')}
		</button>
		{#if fileMenuOpen}
			<div class="absolute top-full left-0 mt-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded shadow-lg z-50 w-48 py-1" onclick={(e) => e.stopPropagation()}>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { handleNew(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
					{$_('new')}
					<span class="ml-auto text-xs text-zinc-400">Ctrl+N</span>
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { handleOpen(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
					{$_('open')}
					<span class="ml-auto text-xs text-zinc-400">Ctrl+O</span>
				</button>
				<div class="border-t border-zinc-200 dark:border-zinc-600 my-1"></div>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { handleSave(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
					{$_('save')}
					<span class="ml-auto text-xs text-zinc-400">Ctrl+S</span>
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { handleSaveAs(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
					{$_('save_as')}...
					<span class="ml-auto text-xs text-zinc-400">Ctrl+Shift+S</span>
				</button>
				<div class="border-t border-zinc-200 dark:border-zinc-600 my-1"></div>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { handleImport(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
					{$_('import')}
				</button>
				<!-- web File → Import from → SQL (MODAL.IMPORT_SRC) -->
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { openImportSource(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
					{$_('import_sql')}
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { handleExportSQL(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
					{$_('export_sql')}
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { exportDiagramJSON(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
					{$_('export_json')}
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { exportDiagramPNG(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
					{$_('export_png')}
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { exportDiagramSVG(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
					{$_('export_svg')}
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200" onclick={() => { exportDiagramPDF(); closeMenus(); }}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
					{$_('export_pdf')}
				</button>
			</div>
		{/if}
	</div>

	<!-- Edit: Undo / Redo -->
	<div class="flex items-center gap-0.5 border-l border-zinc-200 dark:border-zinc-700 pl-1 ml-1">
		<button
			class="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-600 dark:text-zinc-300"
			title="{$_('undo')} (Ctrl+Z)"
			disabled={$undoStack.length === 0}
			onclick={handleUndo}
		>
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="1 4 1 10 7 10"/>
				<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
			</svg>
		</button>
		<button
			class="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-600 dark:text-zinc-300"
			title="{$_('redo')} (Ctrl+Shift+Z)"
			disabled={$redoStack.length === 0}
			onclick={handleRedo}
		>
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="23 4 23 10 17 10"/>
				<path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>
			</svg>
		</button>
	</div>

	<!-- View Toggles -->
	<div class="relative border-l border-zinc-200 dark:border-zinc-700 pl-1 ml-1">
		<button
			class="px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200"
			onclick={(e) => { e.stopPropagation(); viewMenuOpen = !viewMenuOpen; fileMenuOpen = false; dbMenuOpen = false; }}
		>
			{$_('view')}
		</button>
		{#if viewMenuOpen}
			<div class="absolute top-full left-0 mt-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded shadow-lg z-50 w-52 py-1" onclick={(e) => e.stopPropagation()}>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-between text-zinc-700 dark:text-zinc-200" onclick={() => toggleSetting('showGrid')}>
					<span>{$_('grid')}</span>
					{#if $settings.showGrid}
						<svg class="w-4 h-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-between text-zinc-700 dark:text-zinc-200" onclick={() => toggleSetting('showCardinality')}>
					<span>{$_('cardinality')}</span>
					{#if $settings.showCardinality}
						<svg class="w-4 h-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-between text-zinc-700 dark:text-zinc-200" onclick={() => toggleSetting('showFieldSummary')}>
					<span>{$_('field_summary')}</span>
					{#if $settings.showFieldSummary}
						<svg class="w-4 h-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-between text-zinc-700 dark:text-zinc-200" onclick={() => toggleSetting('snapToGrid')}>
					<span>{$_('snap_to_grid')}</span>
					{#if $settings.snapToGrid}
						<svg class="w-4 h-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
				</button>
				<div class="border-t border-zinc-200 dark:border-zinc-600 my-1"></div>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-between text-zinc-700 dark:text-zinc-200" onclick={() => toggleLayout('sidebar')}>
					<span>{$_('sidebar')}</span>
					{#if $layout.sidebar}
						<svg class="w-4 h-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
				</button>
				<button class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-between text-zinc-700 dark:text-zinc-200" onclick={() => toggleLayout('toolbar')}>
					<span>{$_('toolbar')}</span>
					{#if $layout.toolbar}
						<svg class="w-4 h-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
				</button>
			</div>
		{/if}
	</div>

	<!-- Database Selector -->
	<div class="relative border-l border-zinc-200 dark:border-zinc-700 pl-1 ml-1">
		<button
			class="px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 flex items-center gap-1"
			onclick={(e) => { e.stopPropagation(); dbMenuOpen = !dbMenuOpen; fileMenuOpen = false; viewMenuOpen = false; }}
		>
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<ellipse cx="12" cy="5" rx="9" ry="3"/>
				<path d="M3 5v14a9 3 0 0 0 18 0V5"/>
				<path d="M3 12a9 3 0 0 0 18 0"/>
			</svg>
			{currentDbName}
			<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
		</button>
		{#if dbMenuOpen}
			<div class="absolute top-full left-0 mt-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded shadow-lg z-50 w-44 py-1" onclick={(e) => e.stopPropagation()}>
				{#each Object.entries(databases) as [key, db]}
					<button
						class="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-between text-zinc-700 dark:text-zinc-200"
						onclick={() => handleSetDatabase(key as DBType)}
					>
						<span>{db.name}</span>
						{#if $database === key}
							<svg class="w-4 h-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- DB client (desktop-only, CLAUDE.md §9) -->
	<button
		class="px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 flex items-center gap-1 border-l border-zinc-200 dark:border-zinc-700 ml-1"
		title={$_('db_connections')}
		onclick={openConnectionManager}
	>
		<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0V8z"/><path d="M12 18v4"/></svg>
		{$_('db_connections_short')}
	</button>

	<!-- Spacer -->
	<div class="flex-1"></div>

	<!-- Diagram Name + Save State -->
	<div class="flex items-center gap-2 border-r border-zinc-200 dark:border-zinc-700 pr-2 mr-1">
		<button
			class="px-2 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-medium max-w-48 truncate"
			title={$_('rename')}
			onclick={() => openModal(MODAL.RENAME)}
		>
			{$currentDiagramName}
		</button>
		{#if saveStateLabel}
			<div class="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
				<div class="w-2 h-2 rounded-full {saveStateDot}"></div>
				{saveStateLabel}
			</div>
		{/if}
	</div>

	<!-- Zoom Controls -->
	<div class="flex items-center gap-0.5">
		<button
			class="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
			title={$_('zoom_out')}
			onclick={handleZoomOut}
		>
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
		</button>
		<span class="text-xs text-zinc-500 dark:text-zinc-400 w-10 text-center tabular-nums">{zoomPercent}%</span>
		<button
			class="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
			title={$_('zoom_in')}
			onclick={handleZoomIn}
		>
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
		</button>
		<button
			class="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
			title={$_('fit_to_screen')}
			onclick={handleFitToScreen}
		>
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
		</button>
	</div>

	<!-- Dark/Light Toggle -->
	<button
		class="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 ml-1"
		title={$_('toggle_dark_mode')}
		onclick={toggleDarkMode}
	>
		{#if $settings.mode === 'dark'}
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
		{:else}
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
		{/if}
	</button>
</header>

<ConnectionManagerModal />
<ImportSourceModal />
