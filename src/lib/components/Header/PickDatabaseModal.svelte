<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { pickDatabaseOpen, closePickDatabase } from '$lib/stores/modal';
	import { databases, type DatabaseInfo } from '$lib/data/databases';
	import { DB, type DBType } from '$lib/data/constants';
	import { createNewDiagram, hasDiagramContent } from '$lib/actions/fileActions';

	/**
	 * Pick-database dialog shown on File ▸ New — port of web Workspace.jsx:615-663
	 * (3-column grid of engine cards: name, Beta tag, logo, description).
	 *
	 * Desktop deviations (deliberate):
	 * - Web shows this on an already-blank diagram and is not closable. Here it
	 *   opens BEFORE the current diagram is discarded, so Cancel/Escape/backdrop
	 *   abort "New" and keep the current document, and the discard warning that
	 *   used to be the separate MODAL.NEW confirm is shown inline instead.
	 * - "Skip (use Generic)" keeps the old one-click quick-create path.
	 * - Double-clicking a card confirms it directly.
	 */

	let selectedDb = $state<DBType | ''>('');
	let discardsContent = $state(false);
	let backdropPress = false;

	const engines: DatabaseInfo[] = Object.values(databases);

	// Re-evaluate on every open: reset the selection (web starts at "" with OK
	// disabled, Workspace.jsx:66,628) and check whether "New" would discard work.
	$effect(() => {
		if ($pickDatabaseOpen) {
			selectedDb = '';
			discardsContent = hasDiagramContent();
		}
	});

	function displayName(db: DatabaseInfo): string {
		return db.nameKey ? $_(db.nameKey) : db.name;
	}

	function create(db: DBType) {
		createNewDiagram(db);
		closePickDatabase();
	}

	function confirm() {
		if (selectedDb === '') return;
		create(selectedDb);
	}

	function cancel() {
		closePickDatabase();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!$pickDatabaseOpen) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		} else if (e.key === 'Enter' && selectedDb !== '' && !(e.target instanceof HTMLButtonElement)) {
			// A focused button (card, Cancel, Skip) keeps its own Enter activation.
			e.preventDefault();
			confirm();
		}
	}

	function handleBackdropDown(e: MouseEvent) {
		backdropPress = e.target === e.currentTarget;
	}

	function handleBackdropClick(e: MouseEvent) {
		if (backdropPress && e.target === e.currentTarget) cancel();
		backdropPress = false;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $pickDatabaseOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm select-none text-sm"
		onmousedown={handleBackdropDown}
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-label={$_('pick_db')}
		tabindex="-1"
	>
		<div
			class="bg-white dark:bg-zinc-800 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden"
		>
			<!-- Title Bar -->
			<div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
				<h2 class="text-base font-semibold text-zinc-800 dark:text-zinc-100">{$_('pick_db')}</h2>
				<button
					class="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
					onclick={cancel}
					aria-label={$_('close')}
				>
					<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"/>
						<line x1="6" y1="6" x2="18" y2="18"/>
					</svg>
				</button>
			</div>

			<div class="p-4 overflow-y-auto">
				{#if discardsContent}
					<p class="mb-3 px-3 py-2 rounded border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
						{$_('confirm_new')}
					</p>
				{/if}
				<p class="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{$_('pick_db_hint')}</p>

				<!-- web Workspace.jsx:630-662 -->
				<div class="grid grid-cols-3 gap-4 place-content-center" role="radiogroup" aria-label={$_('pick_db')}>
					{#each engines as db (db.label)}
						<button
							type="button"
							role="radio"
							aria-checked={selectedDb === db.label}
							class="space-y-3 p-3 rounded-md border-2 text-left text-zinc-800 dark:text-zinc-100 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 {selectedDb ===
							db.label
								? 'border-zinc-400'
								: 'border-transparent'}"
							onclick={() => (selectedDb = db.label as DBType)}
							ondblclick={() => create(db.label as DBType)}
						>
							<div class="flex items-center justify-between">
								<div class="font-semibold">{displayName(db)}</div>
								{#if db.beta}
									<!-- Semi <Tag size="small" color="light-blue"> -->
									<span class="px-1.5 py-0.5 rounded text-xs bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">Beta</span>
								{/if}
							</div>
							{#if db.image}
								<!-- Filter verbatim from web Workspace.jsx:653-656 (washed-out monochrome logo). -->
								<img
									src={db.image}
									alt=""
									class="h-8"
									style="filter: opacity(0.4) drop-shadow(0 0 0 white) drop-shadow(0 0 0 white);"
								/>
							{/if}
							{#if db.descriptionKey}
								<div class="text-xs">{$_(db.descriptionKey)}</div>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<div class="flex items-center justify-between gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 shrink-0">
				<button
					class="px-4 py-2 rounded text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
					onclick={() => create(DB.GENERIC)}
				>
					{$_('pick_db_skip')}
				</button>
				<div class="flex gap-2">
					<button
						class="px-4 py-2 rounded text-sm bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600"
						onclick={cancel}
					>
						{$_('cancel')}
					</button>
					<button
						class="px-4 py-2 rounded text-sm bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-sky-600"
						disabled={selectedDb === ''}
						onclick={confirm}
					>
						{$_('confirm')}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
