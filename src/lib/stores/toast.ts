import { writable } from 'svelte/store';

/**
 * Minimal toast notifications (the desktop stand-in for web's Semi UI `Toast`,
 * e.g. `Toast.success(t("copied_to_clipboard"))` in
 * drawdb-main/src/components/EditorHeader/ControlPanel.jsx:672). Rendered once
 * by `components/ui/Toast.svelte`, mounted in Workspace.svelte.
 *
 * Callers pass an already-translated message: `showToast($_('key'), 'success')`.
 */
export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
	id: number;
	message: string;
	type: ToastType;
}

/** Default lifetime before a toast dismisses itself. */
export const TOAST_DURATION_MS = 3500;

export const toasts = writable<ToastItem[]>([]);

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Shows a toast and returns its id. `duration` <= 0 keeps it until dismissed.
 */
export function showToast(
	message: string,
	type: ToastType = 'info',
	duration: number = TOAST_DURATION_MS
): number {
	const id = nextId++;
	toasts.update((prev) => [...prev, { id, message, type }]);
	if (duration > 0) {
		timers.set(
			id,
			setTimeout(() => dismissToast(id), duration)
		);
	}
	return id;
}

export function dismissToast(id: number) {
	const timer = timers.get(id);
	if (timer !== undefined) {
		clearTimeout(timer);
		timers.delete(id);
	}
	toasts.update((prev) => prev.filter((t) => t.id !== id));
}

export function clearToasts() {
	for (const timer of timers.values()) clearTimeout(timer);
	timers.clear();
	toasts.set([]);
}
