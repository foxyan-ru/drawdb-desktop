import { get } from 'svelte/store';
import type { MenuItem as MenuItemInstance, PredefinedMenuItem as PredefinedMenuItemInstance } from '@tauri-apps/api/menu';

/**
 * Builds and applies a REAL native OS menu (macOS global menu bar / Windows &
 * Linux window menu) using Tauri v2's JS menu API (`@tauri-apps/api/menu`).
 *
 * This mirrors the actions already reachable through the in-app HTML header
 * bar (see `src/lib/components/Header/ControlPanel.svelte`) so both surfaces
 * stay behaviorally identical, without duplicating any logic — every handler
 * below just calls into the existing shared action functions/stores.
 *
 * The whole body is wrapped in try/catch and never throws: this app is also
 * previewed in a plain browser (no Tauri runtime present), where importing/
 * calling `@tauri-apps/api/menu` would throw, and that must not crash the app.
 */
export async function setupNativeMenu(): Promise<void> {
	try {
		const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');

		const { handleNew, handleSave, handleSaveAs, handleOpen, handleImport, handleUndo, handleRedo } =
			await import('$lib/actions/fileActions');
		const { openModal } = await import('$lib/stores/modal');
		const { MODAL } = await import('$lib/data/constants');
		const { layout } = await import('$lib/stores/layout');
		const { settings } = await import('$lib/stores/settings');
		const { transform, setTransform } = await import('$lib/stores/transform');

		// Export actions live in a file owned by a concurrently-running task
		// (src/lib/utils/exportImage.ts). Import it defensively: if it doesn't
		// exist yet (or fails to load for any other reason) the rest of the
		// native menu should still be built and applied.
		let exportDiagramPNG: (() => Promise<void>) | undefined;
		let exportDiagramSVG: (() => Promise<void>) | undefined;
		let exportDiagramPDF: (() => Promise<void>) | undefined;
		let exportDiagramJSON: (() => Promise<void>) | undefined;
		try {
			const exportImage = await import('$lib/utils/exportImage');
			exportDiagramPNG = exportImage.exportDiagramPNG;
			exportDiagramSVG = exportImage.exportDiagramSVG;
			exportDiagramPDF = exportImage.exportDiagramPDF;
			exportDiagramJSON = exportImage.exportDiagramJSON;
		} catch (err) {
			console.warn('[menu] $lib/utils/exportImage not available yet, export items will be no-ops', err);
		}

		const callOrWarn = (fn: (() => Promise<void>) | undefined, label: string) => async () => {
			if (fn) {
				await fn();
			} else {
				console.warn(`[menu] ${label} handler not available`);
			}
		};

		let quitItem: MenuItemInstance | PredefinedMenuItemInstance;
		try {
			quitItem = await PredefinedMenuItem.new({ text: 'Quit', item: 'Quit' });
		} catch {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			quitItem = await MenuItem.new({
				text: 'Quit',
				action: () => {
					getCurrentWindow().close();
				}
			});
		}

		const exportSubmenu = await Submenu.new({
			text: 'Export',
			items: [
				await MenuItem.new({
					text: 'Export SQL',
					action: () => openModal(MODAL.EXPORT_SQL)
				}),
				await MenuItem.new({
					text: 'Export JSON',
					action: callOrWarn(exportDiagramJSON, 'Export JSON')
				}),
				await MenuItem.new({
					text: 'Export PNG',
					action: callOrWarn(exportDiagramPNG, 'Export PNG')
				}),
				await MenuItem.new({
					text: 'Export SVG',
					action: callOrWarn(exportDiagramSVG, 'Export SVG')
				}),
				await MenuItem.new({
					text: 'Export PDF',
					action: callOrWarn(exportDiagramPDF, 'Export PDF')
				})
			]
		});

		const fileMenu = await Submenu.new({
			text: 'File',
			items: [
				await MenuItem.new({ text: 'New', accelerator: 'CmdOrCtrl+N', action: () => handleNew() }),
				await MenuItem.new({ text: 'Open...', accelerator: 'CmdOrCtrl+O', action: () => handleOpen() }),
				await PredefinedMenuItem.new({ item: 'Separator' }),
				await MenuItem.new({ text: 'Save', accelerator: 'CmdOrCtrl+S', action: () => handleSave() }),
				await MenuItem.new({
					text: 'Save As...',
					accelerator: 'CmdOrCtrl+Shift+S',
					action: () => handleSaveAs()
				}),
				await PredefinedMenuItem.new({ item: 'Separator' }),
				await MenuItem.new({ text: 'Import...', action: () => handleImport() }),
				await PredefinedMenuItem.new({ item: 'Separator' }),
				exportSubmenu,
				await PredefinedMenuItem.new({ item: 'Separator' }),
				quitItem
			]
		});

		// WHY: a native menu accelerator receives CmdOrCtrl+Z before the webview, which
		// hijacked text-field undo into diagram undo (audit F-10). Tauri's predefined
		// Undo/Redo items are macOS-only (unsupported on Windows/Linux), so keep custom
		// items and route by focus: text undo/redo when an editable element is focused
		// (standard OS behavior), diagram undo/redo otherwise.
		const isEditableFocused = () => {
			const el = document.activeElement as HTMLElement | null;
			if (!el) return false;
			const tag = el.tagName;
			return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
		};
		const undoOrTextUndo = () => {
			if (isEditableFocused()) document.execCommand('undo');
			else handleUndo();
		};
		const redoOrTextRedo = () => {
			if (isEditableFocused()) document.execCommand('redo');
			else handleRedo();
		};

		// WHY: on macOS, Cmd+X/C/V/A inside webview text inputs only work when the app
		// menu provides the corresponding predefined items. Windows/Linux webviews handle
		// these shortcuts natively, and predefined clipboard items there could intercept
		// the keys away from WebView2/WebKitGTK, so add them on macOS only.
		const isMac = /Mac/i.test(navigator.userAgent);
		const clipboardItems = isMac
			? [
					await PredefinedMenuItem.new({ item: 'Separator' }),
					await PredefinedMenuItem.new({ item: 'Cut' }),
					await PredefinedMenuItem.new({ item: 'Copy' }),
					await PredefinedMenuItem.new({ item: 'Paste' }),
					await PredefinedMenuItem.new({ item: 'SelectAll' })
				]
			: [];

		const editMenu = await Submenu.new({
			text: 'Edit',
			items: [
				await MenuItem.new({ text: 'Undo', accelerator: 'CmdOrCtrl+Z', action: undoOrTextUndo }),
				await MenuItem.new({
					text: 'Redo',
					accelerator: 'CmdOrCtrl+Shift+Z',
					action: redoOrTextRedo
				}),
				...clipboardItems
			]
		});

		const viewMenu = await Submenu.new({
			text: 'View',
			items: [
				await MenuItem.new({
					text: 'Toggle Sidebar',
					action: () => layout.update((l) => ({ ...l, sidebar: !l.sidebar }))
				}),
				await MenuItem.new({
					text: 'Toggle Toolbar',
					action: () => layout.update((l) => ({ ...l, toolbar: !l.toolbar }))
				}),
				await PredefinedMenuItem.new({ item: 'Separator' }),
				await MenuItem.new({
					text: 'Zoom In',
					action: () => setTransform({ zoom: get(transform).zoom * 1.2 })
				}),
				await MenuItem.new({
					text: 'Zoom Out',
					action: () => setTransform({ zoom: get(transform).zoom / 1.2 })
				}),
				await MenuItem.new({
					text: 'Fit to Screen',
					action: () => setTransform({ zoom: 1, pan: { x: 0, y: 0 } })
				}),
				await PredefinedMenuItem.new({ item: 'Separator' }),
				await MenuItem.new({
					text: 'Toggle Dark Mode',
					action: () =>
						settings.update((s) => ({ ...s, mode: s.mode === 'dark' ? 'light' : 'dark' }))
				}),
				await PredefinedMenuItem.new({ item: 'Separator' }),
				await MenuItem.new({
					text: 'Show Grid',
					action: () => settings.update((s) => ({ ...s, showGrid: !s.showGrid }))
				}),
				await MenuItem.new({
					text: 'Show Cardinality',
					action: () => settings.update((s) => ({ ...s, showCardinality: !s.showCardinality }))
				}),
				await MenuItem.new({
					text: 'Field Summary',
					action: () => settings.update((s) => ({ ...s, showFieldSummary: !s.showFieldSummary }))
				}),
				await MenuItem.new({
					text: 'Snap to Grid',
					action: () => settings.update((s) => ({ ...s, snapToGrid: !s.snapToGrid }))
				})
			]
		});

		const menu = await Menu.new({
			items: [fileMenu, editMenu, viewMenu]
		});

		// macOS: install as the global application menu bar.
		await menu.setAsAppMenu();
		// Windows/Linux (and harmless if already covered on macOS): install as
		// the current window's menu bar.
		await menu.setAsWindowMenu();
	} catch (err) {
		// No Tauri runtime present (e.g. plain browser preview) or menu API
		// unavailable/failed for some other reason — the app must keep working
		// via the in-app header bar regardless.
		console.warn('[menu] setupNativeMenu failed, continuing without a native menu', err);
	}
}
