<script lang="ts">
  import { get } from 'svelte/store';
  import { settings } from '$lib/stores/settings';
  import { selectedElement } from '$lib/stores/select';
  import { ObjectType, Tab, type Area } from '$lib/data/constants';

  let {
    area,
    onDragStart,
    onResizeStart
  }: {
    area: Area;
    onDragStart: (e: PointerEvent) => void;
    onResizeStart: (dir: string) => void;
  } = $props();

  let $settings = $state<any>({});
  let $selectedElement = $state<any>({});

  $effect(() => {
    const unsub1 = settings.subscribe((v) => ($settings = v));
    const unsub2 = selectedElement.subscribe((v) => ($selectedElement = v));
    return () => {
      unsub1();
      unsub2();
    };
  });

  let hovered = $state(false);

  let isSelected = $derived(
    $selectedElement.id === area.id && $selectedElement.element === ObjectType.AREA
  );

  let borderClass = $derived(
    hovered
      ? 'border-dashed border-blue-500'
      : isSelected
        ? 'border-blue-500'
        : 'border-slate-400'
  );

  function handlePointerDown(e: PointerEvent) {
    if (!e.isPrimary) return;
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    onDragStart(e);
  }

  function handleResizePointerDown(e: PointerEvent, dir: string) {
    if (!e.isPrimary) return;
    e.stopPropagation();
    onResizeStart(dir);
  }

  function handleDoubleClick() {
    selectedElement.set({
      element: ObjectType.AREA,
      id: area.id,
      open: true,
      currentTab: Tab.AREAS
    });
  }

  let resizeCircleFill = $derived(
    $settings.mode === 'light' ? 'white' : 'rgb(28, 31, 35)'
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<g
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
>
  <foreignObject
    x={area.x}
    y={area.y}
    width={Math.max(area.width, 0)}
    height={Math.max(area.height, 0)}
    onpointerdown={handlePointerDown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-full h-full p-2 rounded cursor-move border-2 {borderClass}"
      style:background-color="{area.color}66"
      ondblclick={handleDoubleClick}
    >
      <div class="flex justify-between gap-1 w-full">
        <div
          class="select-none overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium"
          class:text-zinc-800={$settings.mode === 'light'}
          class:text-zinc-200={$settings.mode === 'dark'}
        >
          {area.name}
        </div>
      </div>
    </div>
  </foreignObject>

  <!-- Resize handles (shown on hover) -->
  {#if hovered && !area.locked}
    <!-- Top-left -->
    <circle
      cx={area.x}
      cy={area.y}
      r="6"
      fill={resizeCircleFill}
      stroke="#5891db"
      stroke-width="2"
      class="cursor-nwse-resize"
      onpointerdown={(e) => handleResizePointerDown(e, 'tl')}
    />
    <!-- Top-right -->
    <circle
      cx={area.x + area.width}
      cy={area.y}
      r="6"
      fill={resizeCircleFill}
      stroke="#5891db"
      stroke-width="2"
      class="cursor-nesw-resize"
      onpointerdown={(e) => handleResizePointerDown(e, 'tr')}
    />
    <!-- Bottom-left -->
    <circle
      cx={area.x}
      cy={area.y + area.height}
      r="6"
      fill={resizeCircleFill}
      stroke="#5891db"
      stroke-width="2"
      class="cursor-nesw-resize"
      onpointerdown={(e) => handleResizePointerDown(e, 'bl')}
    />
    <!-- Bottom-right -->
    <circle
      cx={area.x + area.width}
      cy={area.y + area.height}
      r="6"
      fill={resizeCircleFill}
      stroke="#5891db"
      stroke-width="2"
      class="cursor-nwse-resize"
      onpointerdown={(e) => handleResizePointerDown(e, 'br')}
    />
  {/if}
</g>
