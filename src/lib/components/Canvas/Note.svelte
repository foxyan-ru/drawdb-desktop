<script lang="ts">
  import { selectedElement } from '$lib/stores/select';
  import {
    noteWidth as defaultNoteWidth,
    noteRadius,
    noteFold,
    ObjectType,
    Tab,
    type Note
  } from '$lib/data/constants';

  let { note, onDragStart }: { note: Note; onDragStart: (e: PointerEvent) => void } =
    $props();

  let hovered = $state(false);

  let width = $derived(note.width || defaultNoteWidth);

  let isSelected = $derived(
    $selectedElement.id === note.id && $selectedElement.element === ObjectType.NOTE
  );

  /**
   * SVG path for the note body.
   * Shaped like a rectangle with a folded top-left corner:
   * - Starts at the fold point, goes right across the top with rounded right corners
   * - Down the right side, across the bottom with rounded corners, up the left side
   * - Ends at the fold
   */
  let bodyPath = $derived.by(() => {
    const x = note.x;
    const y = note.y;
    const w = width;
    const h = note.height;
    const r = noteRadius;
    const fold = noteFold;

    return [
      `M${x + fold} ${y}`,
      `L${x + w - r} ${y}`,
      `A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
      `L${x + w} ${y + h - r}`,
      `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
      `L${x + r} ${y + h}`,
      `A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
      `L${x} ${y + fold}`
    ].join(' ');
  });

  /**
   * SVG path for the folded corner triangle.
   */
  let foldPath = $derived.by(() => {
    const x = note.x;
    const y = note.y;
    const r = noteRadius;
    const fold = noteFold;

    return [
      `M${x} ${y + fold}`,
      `L${x + fold - r} ${y + fold}`,
      `A${r} ${r} 0 0 0 ${x + fold} ${y + fold - r}`,
      `L${x + fold} ${y}`,
      `L${x} ${y + fold}`,
      'Z'
    ].join(' ');
  });

  let strokeColor = $derived(
    hovered || isSelected ? 'rgb(59 130 246)' : 'rgb(168 162 158)'
  );

  function handlePointerDown(e: PointerEvent) {
    if (!e.isPrimary) return;
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    onDragStart(e);
  }

  function handleDoubleClick() {
    selectedElement.set({
      element: ObjectType.NOTE,
      id: note.id,
      open: true,
      currentTab: Tab.NOTES
    });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<g
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
  onpointerdown={(e) => {
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
  }}
  ondblclick={handleDoubleClick}
>
  <!-- Note body shape -->
  <path
    d={bodyPath}
    fill={note.color}
    stroke={strokeColor}
    stroke-dasharray={hovered ? '5' : '0'}
    stroke-linejoin="round"
    stroke-width="2"
  />
  <!-- Folded corner -->
  <path
    d={foldPath}
    fill={note.color}
    stroke={strokeColor}
    stroke-dasharray={hovered ? '5' : '0'}
    stroke-linejoin="round"
    stroke-width="2"
  />

  <!-- Content rendered via foreignObject -->
  <foreignObject
    x={note.x}
    y={note.y}
    width={width}
    height={note.height}
    onpointerdown={handlePointerDown}
  >
    <div class="text-gray-900 select-none w-full h-full cursor-move px-3 py-2">
      <!-- Title -->
      <div class="flex justify-between gap-1 w-full">
        <div
          class="overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-sm"
          style:padding-left="{noteFold + 4}px"
        >
          {note.title}
        </div>
      </div>
      <!-- Content text -->
      {#if note.content}
        <div
          class="mt-1 text-xs text-gray-700 overflow-hidden whitespace-pre-wrap"
          style:max-height="{note.height - 42}px"
        >
          {note.content}
        </div>
      {/if}
    </div>
  </foreignObject>
</g>
