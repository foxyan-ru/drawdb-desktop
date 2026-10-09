<script lang="ts">
  // Canvas node for a database view (web drawdb-main/src/components/EditorCanvas/View.jsx,
  // 390 lines). Modeled on Table.svelte's foreignObject/header/rows layout (a view
  // renders like a read-only table of its resolved output columns) plus Area.svelte's
  // hover-resize-circle convention, since a view resizes by width only (web
  // ResizeHandles, `minViewWidth`/`maxViewWidth` in utils/views.ts).
  import { settings } from '$lib/stores/settings';
  import { selectedElement } from '$lib/stores/select';
  import {
    ObjectType,
    Tab,
    tableHeaderHeight,
    tableColorStripHeight,
    tableFieldHeight,
    type View,
    type Table
  } from '$lib/data/constants';
  import {
    resolveViewColumns,
    getViewWidth,
    getViewHeight,
    viewCommentHeight
  } from '$lib/utils/views';

  let {
    view,
    tables,
    onDragStart,
    onResizeStart
  }: {
    view: View;
    tables: Table[];
    onDragStart: (e: PointerEvent) => void;
    onResizeStart: (dir: 'l' | 'r') => void;
  } = $props();

  let hovered = $state(false);

  let isSelected = $derived(
    $selectedElement.id === view.id && $selectedElement.element === ObjectType.VIEW
  );

  let viewWidth = $derived(getViewWidth(view));
  let columns = $derived(resolveViewColumns(view, tables));
  let showComment = $derived($settings.showComments && !!view.comment?.trim());
  let viewHeight = $derived(getViewHeight(view, columns.length, $settings.showComments));

  let borderColor = $derived($settings.mode === 'light' ? '#d4d4d8' : '#52525b');
  let resizeCircleFill = $derived($settings.mode === 'light' ? 'white' : 'rgb(28, 31, 35)');

  function handlePointerDown(e: PointerEvent) {
    if (!e.isPrimary) return;
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    onDragStart(e);
  }

  function handleResizePointerDown(e: PointerEvent, dir: 'l' | 'r') {
    if (!e.isPrimary) return;
    e.stopPropagation();
    onResizeStart(dir);
  }

  function handleDoubleClick() {
    selectedElement.set({
      element: ObjectType.VIEW,
      id: view.id,
      open: true,
      currentTab: Tab.VIEWS
    });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<g
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
>
  <foreignObject
    x={view.x}
    y={view.y}
    width={viewWidth}
    height={viewHeight}
    class="drop-shadow-lg rounded-md cursor-move"
    onpointerdown={handlePointerDown}
    ondblclick={handleDoubleClick}
  >
    <div
      class="border-2 select-none rounded-lg w-full h-full overflow-hidden"
      class:bg-zinc-100={$settings.mode === 'light'}
      class:text-zinc-800={$settings.mode === 'light'}
      class:bg-zinc-800={$settings.mode === 'dark'}
      class:text-zinc-200={$settings.mode === 'dark'}
      class:border-blue-500={isSelected || hovered}
      class:border-dashed={hovered && !isSelected}
      style:border-color={!isSelected && !hovered ? borderColor : undefined}
    >
      <!-- Color strip -->
      <div
        class="w-full rounded-t-md"
        style:background-color={view.color}
        style:height="{tableColorStripHeight}px"
      ></div>

      <!-- Header -->
      <div
        class="flex items-center justify-between gap-1 px-3 border-b border-gray-400"
        class:bg-zinc-100={$settings.mode === 'light'}
        class:bg-zinc-900={$settings.mode === 'dark'}
        style:height="{tableHeaderHeight}px"
      >
        <div class="overflow-hidden text-ellipsis whitespace-nowrap font-bold flex-1 min-w-0">
          {view.name}
        </div>
        <!-- Distinguishes a view node from a table node at a glance (web View.jsx header icon). -->
        <span
          class="shrink-0 rounded px-1 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          {view.materialized ? 'MVIEW' : 'VIEW'}
        </span>
      </div>

      <!-- Resolved output columns -->
      {#each columns as column, i (column.id)}
        <div
          class="flex items-center justify-between px-2 py-1 gap-1 w-full overflow-hidden"
          class:border-b={i < columns.length - 1 || showComment}
          class:border-gray-400={i < columns.length - 1 || showComment}
          style:height="{tableFieldHeight}px"
        >
          <span class="overflow-hidden text-ellipsis whitespace-nowrap text-sm flex-1 min-w-0">
            {column.name}
          </span>
          {#if $settings.showDataTypes}
            <span class="font-mono text-emerald-600 dark:text-emerald-400 text-xs shrink-0">
              {column.type}{column.size ? `(${column.size})` : ''}
            </span>
          {/if}
        </div>
      {/each}

      {#if showComment}
        <div
          class="px-2 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400 flex items-center"
          style:height="{viewCommentHeight}px"
          title={view.comment}
        >
          {view.comment}
        </div>
      {/if}
    </div>
  </foreignObject>

  <!-- Width resize handles: left/right edges, mid-height (web ResizeHandles.jsx; height is derived, not resizable). -->
  {#if hovered && !view.locked}
    <circle
      cx={view.x}
      cy={view.y + viewHeight / 2}
      r="6"
      fill={resizeCircleFill}
      stroke="#5891db"
      stroke-width="2"
      class="cursor-ew-resize"
      onpointerdown={(e) => handleResizePointerDown(e, 'l')}
    />
    <circle
      cx={view.x + viewWidth}
      cy={view.y + viewHeight / 2}
      r="6"
      fill={resizeCircleFill}
      stroke="#5891db"
      stroke-width="2"
      class="cursor-ew-resize"
      onpointerdown={(e) => handleResizePointerDown(e, 'r')}
    />
  {/if}
</g>
