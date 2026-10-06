<script lang="ts">
  import { get } from 'svelte/store';
  import {
    transform,
    setTransform,
    screenSize,
    viewBox,
    toDiagramSpace,
    canvasSvgEl
  } from '$lib/stores/transform';
  import { tables, relationships, areas, notes, updateTable, updateArea, updateNote } from '$lib/stores/diagram';
  import { settings } from '$lib/stores/settings';
  import { selectedElement, clearSelection } from '$lib/stores/select';
  import {
    gridSize,
    gridCircleRadius,
    ObjectType,
    type Table as TableType,
    type Area as AreaType,
    type Note as NoteType
  } from '$lib/data/constants';
  import Table from './Table.svelte';
  import Relationship from './Relationship.svelte';
  import Area from './Area.svelte';
  import Note from './Note.svelte';

  let svgEl: SVGSVGElement | undefined = $state(undefined);
  let containerEl: HTMLDivElement | undefined = $state(undefined);

  // Panning state
  let isPanning = $state(false);
  let panStart = $state({ x: 0, y: 0 });
  let cursorScreenStart = $state({ x: 0, y: 0 });

  // Dragging element state
  let dragging = $state<{
    id: string | number;
    type: number;
    grabOffset: { x: number; y: number };
  }>({ id: -1, type: ObjectType.NONE, grabOffset: { x: 0, y: 0 } });

  // Area resize state
  let areaResize = $state<{ id: number; dir: string }>({ id: -1, dir: 'none' });
  let areaInitDims = $state({ x: 0, y: 0, width: 0, height: 0 });

  // Current pointer in diagram space
  let pointerDiagram = $state({ x: 0, y: 0 });

  // Track screen size with ResizeObserver
  $effect(() => {
    if (!containerEl) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        screenSize.set({ x: width, y: height });
      }
    });
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  // Publish the live SVG element so utilities outside the canvas (e.g. image/PDF export)
  // can read/capture it without prop-drilling a ref through the component tree.
  $effect(() => {
    canvasSvgEl.set(svgEl ?? null);
    return () => canvasSvgEl.set(null);
  });

  function getPointerDiagram(e: PointerEvent | MouseEvent | WheelEvent) {
    const $screenSize = get(screenSize);
    const $viewBox = get(viewBox);
    const rect = svgEl?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const result = toDiagramSpace({ x: sx, y: sy }, $screenSize, $viewBox);
    return { x: result.x ?? 0, y: result.y ?? 0 };
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const $t = get(transform);
    const diagPt = getPointerDiagram(e);

    if (e.ctrlKey || e.metaKey) {
      // Zoom toward pointer
      const eagernessFactor = 0.05;
      const direction = Math.sign(e.deltaY);
      const newZoom = e.deltaY <= 0 ? $t.zoom * 1.05 : $t.zoom / 1.05;
      setTransform({
        zoom: newZoom,
        pan: {
          x: $t.pan.x - (diagPt.x - $t.pan.x) * eagernessFactor * direction,
          y: $t.pan.y - (diagPt.y - $t.pan.y) * eagernessFactor * direction
        }
      });
    } else if (e.shiftKey) {
      // Horizontal scroll
      setTransform({
        pan: { x: $t.pan.x + e.deltaY / $t.zoom, y: $t.pan.y }
      });
    } else {
      // Vertical scroll
      setTransform({
        pan: { x: $t.pan.x, y: $t.pan.y + e.deltaY / $t.zoom }
      });
    }
  }

  function handlePointerDown(e: PointerEvent) {
    if (!e.isPrimary) return;

    const isMiddle = e.button === 1;
    const isRight = e.button === 2;
    const isLeft = e.button === 0;

    if (isMiddle || isRight) {
      // Start panning
      isPanning = true;
      const $t = get(transform);
      panStart = { x: $t.pan.x, y: $t.pan.y };
      const rect = svgEl?.getBoundingClientRect();
      cursorScreenStart = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0)
      };
      (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId);
      return;
    }

    if (isLeft) {
      // Click on empty canvas = deselect
      // Will be overridden by child onpointerdown if an element is clicked
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (!e.isPrimary) return;

    const diagPt = getPointerDiagram(e);
    pointerDiagram = diagPt;

    if (isPanning) {
      const $t = get(transform);
      const rect = svgEl?.getBoundingClientRect();
      const cursorScreen = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0)
      };
      setTransform({
        pan: {
          x: panStart.x + (cursorScreenStart.x - cursorScreen.x) / $t.zoom,
          y: panStart.y + (cursorScreenStart.y - cursorScreen.y) / $t.zoom
        }
      });
      return;
    }

    // Handle element dragging
    if (dragging.type !== ObjectType.NONE && dragging.id !== -1) {
      const newX = diagPt.x - dragging.grabOffset.x;
      const newY = diagPt.y - dragging.grabOffset.y;

      if (dragging.type === ObjectType.TABLE) {
        updateTable(dragging.id as string, { x: newX, y: newY });
      } else if (dragging.type === ObjectType.AREA) {
        updateArea(dragging.id as number, { x: newX, y: newY });
      } else if (dragging.type === ObjectType.NOTE) {
        updateNote(dragging.id as number, { x: newX, y: newY });
      }
      return;
    }

    // Handle area resize
    if (areaResize.id !== -1 && areaResize.dir !== 'none') {
      const $areas = get(areas);
      const area = $areas.find((a) => a.id === areaResize.id);
      if (!area) return;

      let newDims = { ...areaInitDims };
      const { x, y } = diagPt;

      switch (areaResize.dir) {
        case 'br':
          newDims.width = x - areaInitDims.x;
          newDims.height = y - areaInitDims.y;
          break;
        case 'tl':
          newDims.x = x;
          newDims.y = y;
          newDims.width = areaInitDims.width - (x - areaInitDims.x);
          newDims.height = areaInitDims.height - (y - areaInitDims.y);
          break;
        case 'tr':
          newDims.y = y;
          newDims.width = x - areaInitDims.x;
          newDims.height = areaInitDims.height - (y - areaInitDims.y);
          break;
        case 'bl':
          newDims.x = x;
          newDims.width = areaInitDims.width - (x - areaInitDims.x);
          newDims.height = y - areaInitDims.y;
          break;
      }

      const minSize = 120;
      if (newDims.width < minSize) {
        newDims.width = minSize;
        if (areaResize.dir === 'tl' || areaResize.dir === 'bl') {
          newDims.x = areaInitDims.x + areaInitDims.width - minSize;
        }
      }
      if (newDims.height < minSize) {
        newDims.height = minSize;
        if (areaResize.dir === 'tl' || areaResize.dir === 'tr') {
          newDims.y = areaInitDims.y + areaInitDims.height - minSize;
        }
      }

      updateArea(areaResize.id, newDims);
      return;
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (!e.isPrimary) return;
    isPanning = false;
    dragging = { id: -1, type: ObjectType.NONE, grabOffset: { x: 0, y: 0 } };
    areaResize = { id: -1, dir: 'none' };
  }

  function handleCanvasClick(e: MouseEvent) {
    // Only deselect if clicking on the SVG background itself
    if (e.target === svgEl || (e.target as Element)?.closest?.('.grid-pattern')) {
      clearSelection();
    }
  }

  function handleElementDragStart(
    id: string | number,
    type: number,
    elementX: number,
    elementY: number,
    e: PointerEvent
  ) {
    const diagPt = getPointerDiagram(e);
    dragging = {
      id,
      type,
      grabOffset: {
        x: diagPt.x - elementX,
        y: diagPt.y - elementY
      }
    };
    selectedElement.set({
      element: type,
      id,
      open: false,
      currentTab: get(selectedElement).currentTab
    });
  }

  function handleAreaResizeStart(
    areaId: number,
    dir: string,
    area: AreaType
  ) {
    areaResize = { id: areaId, dir };
    areaInitDims = {
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height
    };
  }

  // Derived values from stores
  let $tables = $state<TableType[]>([]);
  let $relationships = $state<any[]>([]);
  let $areas = $state<AreaType[]>([]);
  let $notes = $state<NoteType[]>([]);
  let $settings = $state<any>({});
  let $viewBox = $state({ x: 0, y: 0, width: 0, height: 0 });

  $effect(() => {
    const unsubTables = tables.subscribe((v) => ($tables = v));
    const unsubRels = relationships.subscribe((v) => ($relationships = v));
    const unsubAreas = areas.subscribe((v) => ($areas = v));
    const unsubNotes = notes.subscribe((v) => ($notes = v));
    const unsubSettings = settings.subscribe((v) => ($settings = v));
    const unsubViewBox = viewBox.subscribe((v) => ($viewBox = v));

    return () => {
      unsubTables();
      unsubRels();
      unsubAreas();
      unsubNotes();
      unsubSettings();
      unsubViewBox();
    };
  });
</script>

<div
  bind:this={containerEl}
  class="relative grow h-full w-full touch-none overflow-hidden"
  class:bg-white={$settings.mode === 'light'}
  class:bg-zinc-900={$settings.mode === 'dark'}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <svg
    bind:this={svgEl}
    class="absolute inset-0 w-full h-full touch-none"
    viewBox="{$viewBox.x} {$viewBox.y} {$viewBox.width} {$viewBox.height}"
    onwheel={handleWheel}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onclick={handleCanvasClick}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#if $settings.showGrid}
      <defs>
        <pattern
          id="pattern-grid"
          x={-gridCircleRadius}
          y={-gridCircleRadius}
          width={gridSize}
          height={gridSize}
          patternUnits="userSpaceOnUse"
          patternContentUnits="userSpaceOnUse"
        >
          <circle
            cx={gridCircleRadius}
            cy={gridCircleRadius}
            r={gridCircleRadius}
            fill="rgb(99, 152, 191)"
            opacity="1"
          />
        </pattern>
      </defs>
      <rect
        class="grid-pattern"
        x={$viewBox.x}
        y={$viewBox.y}
        width={$viewBox.width}
        height={$viewBox.height}
        fill="url(#pattern-grid)"
      />
    {/if}

    <!-- Areas rendered first (behind everything) -->
    {#each $areas as area (area.id)}
      <Area
        {area}
        onDragStart={(e) => {
          if (!area.locked) {
            handleElementDragStart(area.id, ObjectType.AREA, area.x, area.y, e);
          }
        }}
        onResizeStart={(dir) => handleAreaResizeStart(area.id, dir, area)}
      />
    {/each}

    <!-- Relationships rendered on top of areas -->
    {#each $relationships as rel (rel.id)}
      <Relationship relationship={rel} />
    {/each}

    <!-- Tables rendered on top of relationships -->
    {#each $tables as table (table.id)}
      <Table
        {table}
        onDragStart={(e) => {
          if (!table.locked) {
            handleElementDragStart(table.id, ObjectType.TABLE, table.x, table.y, e);
          }
        }}
      />
    {/each}

    <!-- Notes rendered on top of everything -->
    {#each $notes as note (note.id)}
      <Note
        {note}
        onDragStart={(e) => {
          if (!note.locked) {
            handleElementDragStart(note.id, ObjectType.NOTE, note.x, note.y, e);
          }
        }}
      />
    {/each}
  </svg>
</div>
