<script lang="ts">
	import { get } from 'svelte/store';
	import { _ } from 'svelte-i18n';
	import { open } from '@tauri-apps/plugin-dialog';
	import { connectionManagerOpen, closeConnectionManager } from '$lib/stores/modal';
	import {
		tables,
		relationships,
		database,
		enums,
		types,
		addTable,
		addRelationship
	} from '$lib/stores/diagram';
	import { transform } from '$lib/stores/transform';
	import { settings } from '$lib/stores/settings';
	import {
		savedConnections,
		activeConnections,
		connectionStatus,
		saveConnection,
		deleteConnection,
		testConnection,
		connect,
		disconnect,
		introspect,
		execute,
		validateSpec,
		sanitizeSpec,
		describeConnection,
		defaultPort,
		kindToDB,
		summarizeExecResult,
		errorMessage,
		DB_KINDS,
		type DbKind,
		type SavedConnection,
		type StoredSpec,
		type SpecField,
		type ExecResult
	} from '$lib/stores/connections';
	import {
		introspectToDiagram,
		applyIntrospectedDiagram,
		findNameConflicts,
		placementOrigin,
		type IntrospectedDiagram
	} from '$lib/utils/introspectToDiagram';
	import { generateSQL } from '$lib/utils/exportSQL';
	import { databases } from '$lib/data/databases';
	import { DB } from '$lib/data/constants';

	type TabKey = 'connection' | 'introspect' | 'migrate';

	const inputCls =
		'w-full px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';
	const labelCls = 'block text-xs text-zinc-600 dark:text-zinc-300 mb-1';
	const btnCls =
		'px-3 py-1.5 rounded text-sm bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed';
	const primaryBtnCls =
		'px-3 py-1.5 rounded text-sm bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed';
	const dangerBtnCls =
		'px-3 py-1.5 rounded text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed';

	const fieldLabelKeys: Record<SpecField, string> = {
		filePath: 'db_file_path',
		host: 'db_host',
		user: 'db_user',
		database: 'db_database_name'
	};

	let tab = $state<TabKey>('connection');
	let selectedId = $state<string | null>(null);

	// --- connection form (password lives ONLY here, transiently) ---
	let formId = $state<string | null>(null);
	let formName = $state('');
	let formKind = $state<DbKind>('postgres');
	let formHost = $state('localhost');
	let formPort = $state<number | null>(null);
	let formUser = $state('');
	let formPassword = $state('');
	let formDatabase = $state('');
	let formFilePath = $state('');
	let formMessage = $state<{ ok: boolean; text: string } | null>(null);
	let testing = $state(false);

	// --- connect-with-password prompt for a saved connection ---
	let promptFor = $state<string | null>(null);
	let promptPassword = $state('');

	// --- inline delete confirmation (avoids window.confirm, which varies across Tauri webviews) ---
	let deleteCandidate = $state<string | null>(null);

	// --- introspect ---
	// $state.raw: these tables are handed to the diagram store as-is, so they must
	// stay plain objects rather than deep $state proxies.
	let pendingImport = $state.raw<{ result: IntrospectedDiagram; conflicts: string[]; kind: DbKind } | null>(null);
	let importMessage = $state<string | null>(null);

	// --- migrate ---
	let sqlText = $state('');
	let sqlEdited = $state(false);
	let useTransaction = $state(true);
	let confirmRun = $state(false);
	let execOutcome = $state.raw<{ dryRun: boolean; result: ExecResult } | null>(null);

	let backdropPress = false;

	let selected = $derived<SavedConnection | null>($savedConnections.find((c) => c.id === selectedId) ?? null);
	let selectedActive = $derived(selected ? !!$activeConnections[selected.id] : false);
	let selectedStatus = $derived(selected ? $connectionStatus[selected.id] : undefined);
	let selectedBusy = $derived(selectedStatus?.busy ?? null);
	let engineName = $derived(selected ? (databases[kindToDB(selected.spec.kind)]?.name ?? selected.spec.kind) : '');
	let execSummary = $derived(execOutcome ? summarizeExecResult(execOutcome.result) : null);

	function engineLabel(kind: DbKind): string {
		return databases[kindToDB(kind)]?.name ?? kind;
	}

	function formSpec(): StoredSpec {
		return sanitizeSpec({
			kind: formKind,
			host: formHost,
			port: formPort ?? undefined,
			user: formUser,
			database: formDatabase,
			filePath: formFilePath
		});
	}

	function missingMessage(spec: StoredSpec): string | null {
		const missing = validateSpec(spec);
		if (missing.length === 0) return null;
		return $_('db_missing_fields', { values: { fields: missing.map((f) => $_(fieldLabelKeys[f])).join(', ') } });
	}

	function resetForm() {
		formId = null;
		formName = '';
		formKind = 'postgres';
		formHost = 'localhost';
		formPort = null;
		formUser = '';
		formPassword = '';
		formDatabase = '';
		formFilePath = '';
		formMessage = null;
	}

	function editConnection(conn: SavedConnection) {
		formId = conn.id;
		formName = conn.name;
		formKind = conn.spec.kind;
		formHost = conn.spec.host ?? '';
		formPort = conn.spec.port ?? null;
		formUser = conn.spec.user ?? '';
		formPassword = '';
		formDatabase = conn.spec.database ?? '';
		formFilePath = conn.spec.filePath ?? '';
		formMessage = null;
		selectConnection(conn.id);
		tab = 'connection';
	}

	function selectConnection(id: string) {
		if (selectedId === id) return;
		selectedId = id;
		// Per-connection panels must never carry state across connections.
		pendingImport = null;
		importMessage = null;
		confirmRun = false;
		execOutcome = null;
		sqlEdited = false;
		sqlText = '';
		if (!$activeConnections[id] && tab !== 'connection') tab = 'connection';
	}

	/** List click: connected → jump to its schema/migrate tools; otherwise open its form. */
	function openFromList(conn: SavedConnection) {
		if (!$activeConnections[conn.id]) {
			editConnection(conn);
			return;
		}
		selectConnection(conn.id);
		if (tab === 'connection') setTab('introspect');
	}

	function setTab(next: TabKey) {
		tab = next;
		if (next === 'migrate' && !sqlEdited) regenerateSQL();
	}

	async function browseSqlite() {
		try {
			const picked = await open({
				title: $_('db_pick_sqlite'),
				multiple: false,
				filters: [
					{ name: $_('db_sqlite_filter'), extensions: ['sqlite', 'sqlite3', 'db', 'db3', 's3db', 'sl3'] },
					{ name: $_('db_all_files'), extensions: ['*'] }
				]
			});
			if (typeof picked === 'string') formFilePath = picked;
		} catch {
			// dialog cancelled
		}
	}

	async function handleTest() {
		const spec = formSpec();
		const missing = missingMessage(spec);
		if (missing) {
			formMessage = { ok: false, text: missing };
			return;
		}
		testing = true;
		formMessage = null;
		try {
			const ok = await testConnection(spec, formPassword);
			formMessage = ok
				? { ok: true, text: $_('db_test_ok') }
				: { ok: false, text: $_('db_test_failed', { values: { error: '' } }) };
		} catch (e) {
			formMessage = { ok: false, text: $_('db_test_failed', { values: { error: errorMessage(e) } }) };
		} finally {
			testing = false;
		}
	}

	async function handleSave(andConnect: boolean) {
		const spec = formSpec();
		const missing = missingMessage(spec);
		if (missing) {
			formMessage = { ok: false, text: missing };
			return;
		}
		const conn = saveConnection(formName, spec, formId ?? undefined);
		formId = conn.id;
		formName = conn.name;
		selectConnection(conn.id);
		formMessage = { ok: true, text: $_('db_saved_ok') };
		if (andConnect) {
			const password = formPassword;
			formPassword = '';
			await doConnect(conn.id, password);
		}
	}

	function requestConnect(conn: SavedConnection) {
		selectConnection(conn.id);
		if (conn.spec.kind === 'sqlite') {
			doConnect(conn.id);
		} else {
			promptFor = conn.id;
			promptPassword = '';
		}
	}

	async function submitPrompt() {
		if (!promptFor) return;
		const id = promptFor;
		const password = promptPassword;
		promptFor = null;
		promptPassword = '';
		await doConnect(id, password);
	}

	async function doConnect(id: string, password?: string) {
		try {
			await connect(id, password);
			if (selectedId === id) setTab('introspect');
		} catch {
			// error is surfaced via connectionStatus
		}
	}

	async function doDisconnect(id: string) {
		try {
			await disconnect(id);
		} catch {
			// error is surfaced via connectionStatus
		}
		if (selectedId === id && tab !== 'connection') tab = 'connection';
	}

	async function doDelete(conn: SavedConnection) {
		deleteCandidate = null;
		await deleteConnection(conn.id);
		if (selectedId === conn.id) {
			selectedId = null;
			resetForm();
			tab = 'connection';
		}
	}

	// ---------------- introspect ----------------

	async function runIntrospect() {
		if (!selected) return;
		const conn = selected;
		importMessage = null;
		pendingImport = null;
		try {
			const schema = await introspect(conn.id);
			const $tables = get(tables);
			const diagramEmpty = $tables.length === 0 && get(relationships).length === 0;
			const width = get(settings).tableWidth;
			const result = introspectToDiagram(schema, {
				// An empty diagram adopts the connection's engine (applied on confirm),
				// so types are mapped for that dialect; otherwise keep the diagram's.
				database: diagramEmpty ? kindToDB(conn.spec.kind) : get(database),
				origin: placementOrigin($tables, get(transform).pan, width),
				tableWidth: width
			});
			pendingImport = { result, conflicts: findNameConflicts(result.tables, $tables), kind: conn.spec.kind };
		} catch {
			// error is surfaced via connectionStatus
		}
	}

	function confirmImport() {
		if (!pendingImport) return;
		const { result, kind } = pendingImport;
		const diagramEmpty = get(tables).length === 0 && get(relationships).length === 0;
		// Set the dialect BEFORE adding so the first undo snapshot (taken by
		// addTable) already holds it — undoing the import then only removes tables.
		if (diagramEmpty) database.set(kindToDB(kind));
		applyIntrospectedDiagram(result, { addTable, addRelationship });
		importMessage = $_('db_introspect_done', {
			values: { tables: result.tables.length, rels: result.relationships.length }
		});
		pendingImport = null;
	}

	// ---------------- migrate ----------------

	function regenerateSQL() {
		if (!selected) return;
		sqlText = generateSQL(kindToDB(selected.spec.kind), {
			tables: get(tables),
			relationships: get(relationships),
			enums: get(enums),
			types: get(types)
		});
		sqlEdited = false;
		confirmRun = false;
		execOutcome = null;
	}

	async function runDry() {
		if (!selected || !sqlText.trim()) return;
		confirmRun = false;
		try {
			const result = await execute(selected.id, sqlText, { dryRun: true, useTransaction });
			execOutcome = { dryRun: true, result };
		} catch {
			execOutcome = null;
		}
	}

	/** The ONLY path that executes with dryRun:false — reached via the explicit confirm button. */
	async function confirmAndRun() {
		if (!selected || !sqlText.trim() || !confirmRun) return;
		confirmRun = false;
		try {
			const result = await execute(selected.id, sqlText, { dryRun: false, useTransaction });
			execOutcome = { dryRun: false, result };
		} catch {
			execOutcome = null;
		}
	}

	// ---------------- modal chrome ----------------

	function close() {
		// Drop every transient secret / pending destructive step on close.
		formPassword = '';
		promptPassword = '';
		promptFor = null;
		confirmRun = false;
		pendingImport = null;
		closeConnectionManager();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && $connectionManagerOpen) close();
	}

	// Only close when the press AND release both happen on the backdrop, so a text
	// selection dragged out of the SQL textarea doesn't dismiss the dialog.
	function handleBackdropDown(e: MouseEvent) {
		backdropPress = e.target === e.currentTarget;
	}

	function handleBackdropClick(e: MouseEvent) {
		if (backdropPress && e.target === e.currentTarget) close();
		backdropPress = false;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $connectionManagerOpen}
	<!-- select-text: mounted from ControlPanel; never inherit the header's select-none. -->
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm select-text text-sm"
		onmousedown={handleBackdropDown}
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-label={$_('db_connections')}
		tabindex="-1"
	>
		<div
			class="bg-white dark:bg-zinc-800 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-700 w-full max-w-5xl mx-4 max-h-[90vh] flex flex-col overflow-hidden"
		>
			<!-- Title Bar -->
			<div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
				<h2 class="text-base font-semibold text-zinc-800 dark:text-zinc-100">{$_('db_connections')}</h2>
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

			<div class="flex flex-1 min-h-0">
				<!-- Saved connections -->
				<aside class="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-700 flex flex-col min-h-0">
					<div class="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
						<span class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{$_('db_saved_connections')}</span>
						<button
							class="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-sky-600 dark:text-sky-400"
							title={$_('db_new_connection')}
							aria-label={$_('db_new_connection')}
							onclick={() => { resetForm(); selectedId = null; tab = 'connection'; }}
						>
							<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
						</button>
					</div>
					<div class="flex-1 overflow-y-auto p-2 space-y-1">
						{#if $savedConnections.length === 0}
							<p class="text-xs text-zinc-500 dark:text-zinc-400 px-2 py-4 text-center">{$_('db_no_connections')}</p>
						{/if}
						{#each $savedConnections as conn (conn.id)}
							{@const active = !!$activeConnections[conn.id]}
							{@const status = $connectionStatus[conn.id]}
							<div
								class="rounded border px-2 py-1.5 {selectedId === conn.id
									? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20'
									: 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}"
							>
								<button class="w-full text-left" onclick={() => openFromList(conn)}>
									<div class="flex items-center gap-1.5">
										<span class="w-2 h-2 rounded-full shrink-0 {active ? 'bg-green-500' : 'bg-zinc-400'}" title={active ? $_('db_connected') : ''}></span>
										<span class="font-medium text-zinc-800 dark:text-zinc-100 truncate">{conn.name}</span>
										<span class="ml-auto text-[10px] text-zinc-400 shrink-0">{engineLabel(conn.spec.kind)}</span>
									</div>
									<div class="text-xs text-zinc-500 dark:text-zinc-400 truncate" title={describeConnection(conn.spec)}>{describeConnection(conn.spec)}</div>
								</button>

								{#if promptFor === conn.id}
									<form class="mt-1.5 flex gap-1" onsubmit={(e) => { e.preventDefault(); submitPrompt(); }}>
										<!-- svelte-ignore a11y_autofocus -->
										<input
											type="password"
											autocomplete="off"
											autofocus
											class={inputCls}
											placeholder={$_('db_enter_password', { values: { name: conn.name } })}
											aria-label={$_('db_enter_password', { values: { name: conn.name } })}
											bind:value={promptPassword}
										/>
										<button type="submit" class={primaryBtnCls}>{$_('db_connect')}</button>
									</form>
								{/if}

								{#if status?.error}
									<p class="mt-1 text-xs text-red-600 dark:text-red-400 break-words">{status.error}</p>
								{/if}

								<div class="mt-1.5 flex items-center gap-1">
									{#if active}
										<button class="{btnCls} !py-0.5 !px-2 text-xs" disabled={!!status?.busy} onclick={() => doDisconnect(conn.id)}>
											{$_('db_disconnect')}
										</button>
									{:else}
										<button class="{primaryBtnCls} !py-0.5 !px-2 text-xs" disabled={!!status?.busy} onclick={() => requestConnect(conn)}>
											{status?.busy === 'connecting' ? $_('db_connecting') : $_('db_connect')}
										</button>
									{/if}
									<button
										class="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 ml-auto"
										title={$_('edit')}
										aria-label={$_('edit')}
										onclick={() => editConnection(conn)}
									>
										<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
									</button>
									<button
										class="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-500"
										title={$_('db_delete_connection')}
										aria-label={$_('db_delete_connection')}
										disabled={!!status?.busy}
										onclick={() => (deleteCandidate = conn.id)}
									>
										<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
									</button>
								</div>

								{#if deleteCandidate === conn.id}
									<div class="mt-1.5 rounded bg-red-50 dark:bg-red-900/20 px-2 py-1.5">
										<p class="text-xs text-red-700 dark:text-red-300">
											{$_('db_confirm_delete_connection', { values: { name: conn.name } })}
										</p>
										<div class="flex justify-end gap-1 mt-1">
											<button class="{btnCls} !py-0.5 !px-2 text-xs" onclick={() => (deleteCandidate = null)}>{$_('cancel')}</button>
											<button class="{dangerBtnCls} !py-0.5 !px-2 text-xs" onclick={() => doDelete(conn)}>{$_('delete')}</button>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</aside>

				<!-- Detail -->
				<section class="flex-1 min-w-0 flex flex-col min-h-0">
					<div class="flex gap-1 px-3 pt-2 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
						{#each [['connection', 'db_tab_connection'], ['introspect', 'db_tab_introspect'], ['migrate', 'db_tab_migrate']] as [key, label] (key)}
							<button
								class="px-3 py-1.5 -mb-px border-b-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed {tab === key
									? 'border-sky-600 text-sky-700 dark:text-sky-400'
									: 'border-transparent text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-zinc-100'}"
								disabled={key !== 'connection' && !selectedActive}
								onclick={() => setTab(key as TabKey)}
							>
								{$_(label)}
							</button>
						{/each}
					</div>

					<div class="flex-1 overflow-y-auto p-4">
						{#if tab === 'connection'}
							<h3 class="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">
								{formId ? $_('db_edit_connection') : $_('db_new_connection')}
							</h3>
							<div class="grid grid-cols-2 gap-3 max-w-xl">
								<label class="col-span-2">
									<span class={labelCls}>{$_('db_connection_name')}</span>
									<input type="text" class={inputCls} bind:value={formName} />
								</label>
								<label class="col-span-2">
									<span class={labelCls}>{$_('db_kind')}</span>
									<select class={inputCls} bind:value={formKind} onchange={() => (formMessage = null)}>
										{#each DB_KINDS as k (k)}
											<option value={k}>{engineLabel(k)}</option>
										{/each}
									</select>
								</label>

								{#if formKind === 'sqlite'}
									<div class="col-span-2">
										<label for="db-file-path" class={labelCls}>{$_('db_file_path')}</label>
										<div class="flex gap-2">
											<input id="db-file-path" type="text" class={inputCls} bind:value={formFilePath} />
											<button class="{btnCls} shrink-0" onclick={browseSqlite}>{$_('db_browse')}</button>
										</div>
									</div>
								{:else}
									<label>
										<span class={labelCls}>{$_('db_host')}</span>
										<input type="text" class={inputCls} bind:value={formHost} />
									</label>
									<label>
										<span class={labelCls}>{$_('db_port')}</span>
										<input
											type="number"
											min="1"
											max="65535"
											class={inputCls}
											placeholder={String(defaultPort(formKind) ?? '')}
											bind:value={formPort}
										/>
									</label>
									<label>
										<span class={labelCls}>{$_('db_user')}</span>
										<input type="text" autocomplete="off" class={inputCls} bind:value={formUser} />
									</label>
									<label>
										<span class={labelCls}>{$_('db_password')}</span>
										<input type="password" autocomplete="off" class={inputCls} bind:value={formPassword} />
									</label>
									<label class="col-span-2">
										<span class={labelCls}>{$_('db_database_name')}</span>
										<input type="text" class={inputCls} bind:value={formDatabase} />
									</label>
									<p class="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">{$_('db_password_hint')}</p>
								{/if}
							</div>

							{#if formMessage}
								<p class="mt-3 text-sm break-words {formMessage.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
									{formMessage.text}
								</p>
							{/if}

							<div class="flex gap-2 mt-4">
								<button class={btnCls} disabled={testing} onclick={handleTest}>
									{testing ? $_('db_testing') : $_('db_test_connection')}
								</button>
								<div class="flex-1"></div>
								<button class={btnCls} onclick={() => handleSave(false)}>{$_('db_save_connection')}</button>
								<button class={primaryBtnCls} onclick={() => handleSave(true)}>{$_('db_save_and_connect')}</button>
							</div>
						{:else if !selected || !selectedActive}
							<p class="text-zinc-500 dark:text-zinc-400">{$_('db_select_connection')}</p>
						{:else if tab === 'introspect'}
							<p class="text-zinc-600 dark:text-zinc-300 mb-3">{$_('db_introspect_hint')}</p>
							<button class={primaryBtnCls} disabled={!!selectedBusy || !!pendingImport} onclick={runIntrospect}>
								{selectedBusy === 'introspecting' ? $_('db_introspecting') : $_('db_introspect')}
							</button>

							{#if selectedStatus?.error}
								<p class="mt-3 text-red-600 dark:text-red-400 break-words">{selectedStatus.error}</p>
							{/if}

							{#if pendingImport}
								<div class="mt-4 rounded border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
									<p class="text-zinc-700 dark:text-zinc-200">
										{$_('db_introspect_summary', {
											values: { tables: pendingImport.result.tables.length, rels: pendingImport.result.relationships.length }
										})}
									</p>
									{#if pendingImport.result.skippedForeignKeys.length > 0}
										<p class="text-xs text-zinc-500 dark:text-zinc-400">
											{$_('db_introspect_skipped', { values: { count: pendingImport.result.skippedForeignKeys.length } })}
										</p>
									{/if}
									{#if $tables.length > 0}
										<div class="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 px-3 py-2">
											<p>{$_('db_introspect_nonempty_warning', { values: { count: $tables.length } })}</p>
											{#if pendingImport.conflicts.length > 0}
												<p class="mt-1 text-xs break-words">
													{$_('db_introspect_conflicts', { values: { names: pendingImport.conflicts.join(', ') } })}
												</p>
											{/if}
										</div>
									{/if}
									<p class="text-zinc-700 dark:text-zinc-200">{$_('db_introspect_confirm')}</p>
									<div class="flex justify-end gap-2">
										<button class={btnCls} onclick={() => (pendingImport = null)}>{$_('cancel')}</button>
										<button class={primaryBtnCls} onclick={confirmImport}>{$_('db_introspect_add')}</button>
									</div>
								</div>
							{/if}

							{#if importMessage}
								<p class="mt-3 text-green-600 dark:text-green-400">{importMessage}</p>
							{/if}
						{:else if tab === 'migrate'}
							<p class="text-zinc-600 dark:text-zinc-300 mb-2">{$_('db_migrate_hint', { values: { engine: engineName } })}</p>
							{#if $database !== kindToDB(selected.spec.kind) && $database !== DB.GENERIC}
								<p class="mb-2 text-xs text-amber-700 dark:text-amber-300">
									{$_('db_dialect_mismatch', {
										values: { diagram: databases[$database]?.name ?? $database, engine: engineName }
									})}
								</p>
							{/if}
							{#if $tables.length === 0}
								<p class="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{$_('db_empty_sql')}</p>
							{/if}

							<textarea
								class="w-full h-64 px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-sky-500"
								spellcheck="false"
								bind:value={sqlText}
								oninput={() => { sqlEdited = true; confirmRun = false; }}
							></textarea>

							<div class="flex flex-wrap items-center gap-2 mt-2">
								<button class={btnCls} disabled={!!selectedBusy} onclick={regenerateSQL}>{$_('db_regenerate')}</button>
								<label class="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
									<input type="checkbox" bind:checked={useTransaction} onchange={() => (confirmRun = false)} />
									{$_('db_use_transaction')}
								</label>
								<div class="flex-1"></div>
								<button class={btnCls} disabled={!!selectedBusy || !sqlText.trim()} onclick={runDry}>
									{selectedBusy === 'executing' && !confirmRun ? $_('db_executing') : $_('db_dry_run')}
								</button>
								<button class={dangerBtnCls} disabled={!!selectedBusy || !sqlText.trim() || confirmRun} onclick={() => (confirmRun = true)}>
									{$_('db_run')}
								</button>
							</div>

							{#if confirmRun}
								<div class="mt-3 rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2">
									<p class="font-semibold text-red-800 dark:text-red-200">
										{$_('db_run_confirm_title', { values: { name: selected.name } })}
									</p>
									<p class="text-xs text-red-700 dark:text-red-300 mt-1">{$_('db_run_confirm_body')}</p>
									<div class="flex justify-end gap-2 mt-2">
										<button class={btnCls} onclick={() => (confirmRun = false)}>{$_('cancel')}</button>
										<button class={dangerBtnCls} disabled={!!selectedBusy} onclick={confirmAndRun}>{$_('db_run_confirm')}</button>
									</div>
								</div>
							{/if}

							{#if selectedStatus?.error}
								<p class="mt-3 text-red-600 dark:text-red-400 break-words">{selectedStatus.error}</p>
							{/if}

							{#if execOutcome && execSummary}
								<div class="mt-4">
									<div class="flex items-center gap-2 mb-2">
										<span class="font-medium {execSummary.failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}">
											{$_('db_result_summary', { values: execSummary })}
										</span>
										{#if execOutcome.dryRun}
											<span class="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">{$_('db_result_dry_run')}</span>
										{/if}
									</div>
									<ul class="space-y-1.5">
										{#each execOutcome.result.statements as stmt, i (i)}
											<li class="rounded border px-2 py-1.5 {stmt.success ? 'border-zinc-200 dark:border-zinc-700' : 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'}">
												<div class="flex items-center gap-2 text-xs">
													<span class="px-1.5 py-0.5 rounded font-semibold {stmt.success ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}">
														{stmt.success ? $_('db_result_ok') : $_('db_result_failed')}
													</span>
													{#if stmt.rowsAffected !== undefined && stmt.rowsAffected !== null}
														<span class="text-zinc-500 dark:text-zinc-400">{$_('db_rows_affected', { values: { count: stmt.rowsAffected } })}</span>
													{/if}
												</div>
												<pre class="mt-1 text-xs font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto text-zinc-700 dark:text-zinc-300">{stmt.sql}</pre>
												{#if stmt.error}
													<p class="mt-1 text-xs text-red-600 dark:text-red-400 break-words">{stmt.error}</p>
												{/if}
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						{/if}
					</div>
				</section>
			</div>
		</div>
	</div>
{/if}
