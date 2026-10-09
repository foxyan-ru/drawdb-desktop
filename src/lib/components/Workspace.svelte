<script lang="ts">
	import ControlPanel from './Header/ControlPanel.svelte';
	import Modal from './Header/Modal.svelte';
	import FloatingControls from './FloatingControls.svelte';
	import SidePanel from './SidePanel/SidePanel.svelte';
	import Canvas from './Canvas/Canvas.svelte';
	import Toast from './ui/Toast.svelte';
	import { get } from 'svelte/store';
	import { _ } from 'svelte-i18n';
	import { layout } from '$lib/stores/layout';
	import { currentModal, connectionManagerOpen } from '$lib/stores/modal';
	import { selectedElement } from '$lib/stores/select';
	import { settings } from '$lib/stores/settings';
	import { transform, setTransform, screenSize } from '$lib/stores/transform';
	import { showToast } from '$lib/stores/toast';
	import {
		tables,
		areas,
		notes,
		relationships,
		deleteTable,
		deleteArea,
		deleteNote,
		copyElement,
		pasteElement,
		duplicateElement,
		hasCopyableSelection
	} from '$lib/stores/diagram';
	import {
		handleSave,
		handleSaveAs,
		handleOpen,
		handleImport,
		handleUndo,
		handleRedo
	} from '$lib/actions/fileActions';
	import { MODAL, ObjectType, keyboardPanStep } from '$lib/data/constants';
	import {
		matchShortcut,
		isEditableTarget,
		isActivatableTarget,
		computeFitTransform,
		REPEATABLE_ACTIONS,
		type ShortcutAction
	} from '$lib/utils/shortcuts';

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

	// --- Shortcut actions (web ControlPanel.jsx:635-681, 880-1047) ---

	function deleteSelected() {
		const $sel = get(selectedElement);
		// Same element kinds as web's `del` (ControlPanel.jsx:880-900): relationships are not deleted by key.
		switch ($sel.element) {
			case ObjectType.TABLE:
				deleteTable($sel.id as string);
				break;
			case ObjectType.AREA:
				deleteArea($sel.id as number);
				break;
			case ObjectType.NOTE:
				deleteNote($sel.id as number);
				break;
		}
	}

	function copy() {
		if (copyElement()) showToast(get(_)('copied_to_clipboard'), 'success');
	}

	function cut() {
		if (!copyElement()) return;
		deleteSelected();
		showToast(get(_)('copied_to_clipboard'), 'success');
	}

	async function paste() {
		try {
			if (!(await pasteElement())) showToast(get(_)('nothing_to_paste'), 'info');
		} catch (err) {
			console.error('[shortcuts] paste failed:', err);
			showToast(get(_)('oops_smth_went_wrong'), 'error');
		}
	}

	function duplicate() {
		if (!duplicateElement()) showToast(get(_)('select_element_first'), 'info');
	}

	function panBy(dx: number, dy: number) {
		const $t = get(transform);
		setTransform({ pan: { x: $t.pan.x + dx / $t.zoom, y: $t.pan.y + dy / $t.zoom } });
	}

	function fitWindow() {
		const fit = computeFitTransform(
			{ tables: get(tables), areas: get(areas), notes: get(notes), relationships: get(relationships) },
			get(screenSize),
			get(settings).tableWidth || 220
		);
		if (fit) setTransform(fit);
	}

	function toggleSetting(key: 'showGrid' | 'strictMode' | 'showFieldSummary') {
		settings.update((s) => ({ ...s, [key]: !s[key] }));
	}

	const actions: Record<ShortcutAction, () => void> = {
		undo: handleUndo,
		redo: handleRedo,
		save: () => void handleSave(),
		saveAs: () => void handleSaveAs(),
		open: () => void handleOpen(),
		import: () => void handleImport(),
		copy,
		cut,
		paste: () => void paste(),
		duplicate,
		delete: deleteSelected,
		resetView: () => setTransform({ zoom: 1, pan: { x: 0, y: 0 } }),
		fitWindow,
		zoomIn: () => setTransform({ zoom: get(transform).zoom * 1.2 }),
		zoomOut: () => setTransform({ zoom: get(transform).zoom / 1.2 }),
		panLeft: () => panBy(-keyboardPanStep, 0),
		panRight: () => panBy(keyboardPanStep, 0),
		panUp: () => panBy(0, -keyboardPanStep),
		panDown: () => panBy(0, keyboardPanStep),
		toggleGrid: () => toggleSetting('showGrid'),
		toggleStrictMode: () => toggleSetting('strictMode'),
		toggleFieldSummary: () => toggleSetting('showFieldSummary')
	};

	/**
	 * Global editor hotkeys (web ControlPanel.jsx:1983-2008). Stands down inside
	 * text-editing targets so native typing, text undo and text cut/copy/paste
	 * (incl. the native Edit menu's predefined items) are never hijacked, and
	 * while a dialog is open (dialogs own Enter/Escape and their own inputs).
	 *
	 * Overlap with native-menu accelerators (menu.ts: Ctrl+N/O/S/Shift+S/Z/Shift+Z):
	 * preventDefault() here consumes the keystroke in the webview; on macOS that
	 * also stops WKWebView from forwarding it as a menu key-equivalent, so the
	 * action runs once.
	 */
	function handleKeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.isComposing) return;
		if (isEditableTarget(e.target)) return;
		if (get(currentModal) !== MODAL.NONE || get(connectionManagerOpen)) return;

		const action = matchShortcut(e, isMac);
		if (!action) return;

		// Nothing to act on: let the key through untouched (e.g. native copy of selected page text).
		if ((action === 'copy' || action === 'cut') && !hasCopyableSelection()) return;
		if (action === 'delete') {
			const el = get(selectedElement).element;
			if (el !== ObjectType.TABLE && el !== ObjectType.AREA && el !== ObjectType.NOTE) return;
		}
		// Enter on a focused button/link activates it; don't also reset the view.
		if (action === 'resetView' && isActivatableTarget(e.target)) return;

		e.preventDefault();
		// Holding Ctrl+O/S/V/D… must not stack dialogs or paste dozens of copies.
		if (e.repeat && !REPEATABLE_ACTIONS.has(action)) return;
		actions[action]();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col h-full w-full overflow-hidden">
	<!-- Header -->
	{#if $layout.header}
		<ControlPanel />
	{/if}

	<!-- Main Content Area -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Side Panel -->
		{#if $layout.sidebar}
			<SidePanel />
		{/if}

		<!-- Canvas Area -->
		<main class="flex-1 relative bg-[var(--color-canvas-bg)] overflow-hidden">
			<Canvas />

			<!-- Floating Controls -->
			{#if $layout.toolbar}
				<FloatingControls />
			{/if}
		</main>
	</div>

	<!-- Modal -->
	<Modal bind:modal={$currentModal} />

	<!-- Toast notifications (stores/toast.ts → showToast) -->
	<Toast />
</div>
