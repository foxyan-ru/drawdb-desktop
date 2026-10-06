import { writable, derived } from 'svelte/store';

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

export const transform = writable({
	zoom: 1,
	pan: { x: 0, y: 0 }
});

export function setTransform(update: {
	zoom?: number;
	pan?: { x?: number; y?: number };
}) {
	transform.update((prev) => ({
		zoom: clamp(update.zoom ?? prev.zoom, 0.02, 5),
		pan: {
			x: update.pan?.x ?? prev.pan.x,
			y: update.pan?.y ?? prev.pan.y
		}
	}));
}

export const screenSize = writable({ x: 0, y: 0 });

export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * When set, the viewBox store yields this rect instead of the pan/zoom-derived one.
 * Used to temporarily frame the entire diagram (not just the visible viewport)
 * while capturing an image/PDF export, without disturbing the user's live pan/zoom state.
 */
export const exportBoundsOverride = writable<Bounds | null>(null);

/** Live reference to the canvas's root <svg> element, set by Canvas.svelte on mount. */
export const canvasSvgEl = writable<SVGSVGElement | null>(null);

export const viewBox = derived(
	[transform, screenSize, exportBoundsOverride],
	([$t, $s, $override]) => {
		if ($override) return $override;
		const w = $s.x / $t.zoom;
		const h = $s.y / $t.zoom;
		return {
			x: $t.pan.x - w / 2,
			y: $t.pan.y - h / 2,
			width: w,
			height: h
		};
	}
);

export function toDiagramSpace(
	coord: { x?: number; y?: number },
	$screenSize: { x: number; y: number },
	$viewBox: { x: number; y: number; width: number; height: number }
) {
	return {
		x: coord.x !== undefined ? (coord.x / $screenSize.x) * $viewBox.width + $viewBox.x : undefined,
		y: coord.y !== undefined ? (coord.y / $screenSize.y) * $viewBox.height + $viewBox.y : undefined
	};
}

export function toScreenSpace(
	coord: { x?: number; y?: number },
	$screenSize: { x: number; y: number },
	$viewBox: { x: number; y: number; width: number; height: number }
) {
	return {
		x:
			coord.x !== undefined
				? ((coord.x - $viewBox.x) / $viewBox.width) * $screenSize.x
				: undefined,
		y:
			coord.y !== undefined
				? ((coord.y - $viewBox.y) / $viewBox.height) * $screenSize.y
				: undefined
	};
}
