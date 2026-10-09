<script lang="ts">
  import { get } from 'svelte/store';
  import { nanoid } from 'nanoid';
  import {
    transform,
    setTransform,
    screenSize,
    viewBox,
    toDiagramSpace,
    canvasSvgEl
  } from '$lib/stores/transform';
  import {
    tables,
    relationships,
    areas,
    notes,
    updateArea,
    addRelationship,
    exportDiagram
  } from '$lib/stores/diagram';
  import { snapshotForUndo } from '$lib/stores/undoRedo';
  import { connecting } from '$lib/stores/connect';
  import { settings } from '$lib/stores/settings';
  import {
    selectedElement,
    clearSelection,
    bulkSelectedElements,
    isSameElement,
    getRectFromEndpoints,
    isInsideRect,
    type BulkElement,
    type Rect
  } from '$lib/stores/select';
  import { getVisibleFields, getVisibleFieldIndex, fieldAnchorY } from '$lib/utils/calcPath';
  import {
    gridSize,
    gridCircleRadius,
    noteWidth,
    tableHeaderHeight,
    tableFieldHeight,
    tableColorStripHeight,
    Cardinality,
    Constraint,
    ObjectType,
    Tab,
    type Relationship as RelationshipType,
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

  // Whether the in-progress drag has already pushed its (single) undo snapshot.
  // Bulk moves write the stores directly instead of via updateTable/updateArea/
  // updateNote: those snapshot per element with per-element coalesce keys, so
  // moving N elements would interleave keys and push N entries per pointermove.
  // Web records one `bulk_update` entry per move (Canvas.jsx:560-575).
  let dragSnapshotTaken = false;

  // Rubber-band selection rectangle, in diagram space (web Canvas.jsx:136-144).
  let bulkSelectRect = $state({
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    show: false,
    ctrlKey: false,
    metaKey: false
  });

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
    const currentScreenSize = get(screenSize);
    const currentViewBox = get(viewBox);
    const rect = svgEl?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const result = toDiagramSpace({ x: sx, y: sy }, currentScreenSize, currentViewBox);
    return { x: result.x ?? 0, y: result.y ?? 0 };
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const currentTransform = get(transform);
    const diagPt = getPointerDiagram(e);

    if (e.ctrlKey || e.metaKey) {
      // Zoom toward pointer
      const eagernessFactor = 0.05;
      const direction = Math.sign(e.deltaY);
      const newZoom = e.deltaY <= 0 ? currentTransform.zoom * 1.05 : currentTransform.zoom / 1.05;
      setTransform({
        zoom: newZoom,
        pan: {
          x: currentTransform.pan.x - (diagPt.x - currentTransform.pan.x) * eagernessFactor * direction,
          y: currentTransform.pan.y - (diagPt.y - currentTransform.pan.y) * eagernessFactor * direction
        }
      });
    } else if (e.shiftKey) {
      // Horizontal scroll
      setTransform({
        pan: { x: currentTransform.pan.x + e.deltaY / currentTransform.zoom, y: currentTransform.pan.y }
      });
    } else {
      // Vertical scroll
      setTransform({
        pan: { x: currentTransform.pan.x, y: currentTransform.pan.y + e.deltaY / currentTransform.zoom }
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
      const currentTransform = get(transform);
      panStart = { x: currentTransform.pan.x, y: currentTransform.pan.y };
      const rect = svgEl?.getBoundingClientRect();
      cursorScreenStart = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0)
      };
      (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId);
      return;
    }

    if (isLeft && isCanvasBackground(e.target)) {
      // Left-drag on empty canvas starts a rubber-band selection (web Canvas.jsx:497-506).
      // Element pointerdowns bubble here too, but their target is inside the element,
      // so only true background presses start the rectangle. Middle/right-drag pan is
      // handled above and never reaches this branch.
      const diagPt = getPointerDiagram(e);
      bulkSelectRect = {
        x1: diagPt.x,
        y1: diagPt.y,
        x2: diagPt.x,
        y2: diagPt.y,
        show: true,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey
      };
      // Keep receiving moves while the pointer leaves the SVG mid-drag.
      (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId);
    }
  }

  function isCanvasBackground(target: EventTarget | null): boolean {
    return target === svgEl || !!(target as Element | null)?.closest?.('.grid-pattern');
  }

  function snapToGrid(p: { x: number; y: number }) {
    // Web Canvas.jsx:332-340 — round to the same `gridSize` the dot grid is drawn with.
    if (!$settings.snapToGrid) return p;
    return {
      x: Math.round(p.x / gridSize) * gridSize,
      y: Math.round(p.y / gridSize) * gridSize
    };
  }

  function elementCoords(type: number, id: string | number): { x: number; y: number } | null {
    if (type === ObjectType.TABLE) {
      const t = get(tables).find((t) => t.id === id);
      return t ? { x: t.x, y: t.y } : null;
    }
    if (type === ObjectType.AREA) {
      const a = get(areas).find((a) => a.id === id);
      return a ? { x: a.x, y: a.y } : null;
    }
    if (type === ObjectType.NOTE) {
      const n = get(notes).find((n) => n.id === id);
      return n ? { x: n.x, y: n.y } : null;
    }
    return null;
  }

  function isElementLocked(type: number, id: string | number): boolean {
    if (type === ObjectType.TABLE) return !!get(tables).find((t) => t.id === id)?.locked;
    if (type === ObjectType.AREA) return !!get(areas).find((a) => a.id === id)?.locked;
    if (type === ObjectType.NOTE) return !!get(notes).find((n) => n.id === id)?.locked;
    return false;
  }

  /** Canvas bounds of an element, as rendered by Table/Area/Note.svelte. */
  function elementRect(type: number, id: string | number): Rect | null {
    if (type === ObjectType.TABLE) {
      const t = $tables.find((t) => t.id === id);
      if (!t) return null;
      return {
        x: t.x,
        y: t.y,
        width: $settings.tableWidth || 220,
        height:
          tableColorStripHeight +
          tableHeaderHeight +
          getVisibleFields(t, $relationships).length * tableFieldHeight
      };
    }
    if (type === ObjectType.AREA) {
      const a = $areas.find((a) => a.id === id);
      return a ? { x: a.x, y: a.y, width: a.width, height: a.height } : null;
    }
    if (type === ObjectType.NOTE) {
      const n = $notes.find((n) => n.id === id);
      return n ? { x: n.x, y: n.y, width: n.width || noteWidth, height: n.height } : null;
    }
    return null;
  }

  /** Web Canvas.jsx:153-256 — select every unlocked element fully inside the rubber band. */
  function collectSelectedElements() {
    const rect = getRectFromEndpoints(bulkSelectRect);
    const additive = bulkSelectRect.ctrlKey || bulkSelectRect.metaKey;
    const existing = get(bulkSelectedElements);
    const picked: BulkElement[] = [];

    const consider = (type: number, el: { id: string | number; x: number; y: number; locked: boolean }) => {
      if (el.locked) return;
      const r = elementRect(type, el.id);
      if (!r || !isInsideRect(r, rect)) return;
      const candidate = { id: el.id, type };
      // With ctrl/cmd held, add only elements not already selected.
      if (additive && existing.some((s) => isSameElement(s, candidate))) return;
      picked.push({
        id: el.id,
        type,
        currentCoords: { x: el.x, y: el.y },
        initialCoords: { x: el.x, y: el.y }
      });
    };

    $tables.forEach((t) => consider(ObjectType.TABLE, t));
    $areas.forEach((a) => consider(ObjectType.AREA, a));
    $notes.forEach((n) => consider(ObjectType.NOTE, n));

    bulkSelectedElements.set(additive ? [...existing, ...picked] : picked);
  }

  /**
   * Moves every bulk-selected element so the dragged one lands at `target`
   * (web Canvas.jsx:376-416). Writes the stores directly — see `dragSnapshotTaken`.
   */
  function moveBulkTo(target: { x: number; y: number }) {
    const bulk = get(bulkSelectedElements);
    const main = bulk.find((el) => isSameElement(el, dragging));
    if (!main) return;
    const dx = target.x - main.currentCoords.x;
    const dy = target.y - main.currentCoords.y;
    if (dx === 0 && dy === 0) return;

    if (!dragSnapshotTaken) {
      const label =
        bulk.length > 1
          ? 'Bulk update'
          : dragging.type === ObjectType.TABLE
            ? 'Move table'
            : dragging.type === ObjectType.AREA
              ? 'Move area'
              : 'Move note';
      snapshotForUndo(label, exportDiagram());
      dragSnapshotTaken = true;
    }

    const moved = bulk.map((el) => ({
      ...el,
      currentCoords: { x: el.currentCoords.x + dx, y: el.currentCoords.y + dy }
    }));
    const posOf = (type: number, id: string | number) =>
      moved.find((el) => el.type === type && el.id === id)?.currentCoords;

    if (moved.some((el) => el.type === ObjectType.TABLE)) {
      tables.update((prev) =>
        prev.map((t) => {
          const p = posOf(ObjectType.TABLE, t.id);
          return p ? { ...t, x: p.x, y: p.y } : t;
        })
      );
    }
    if (moved.some((el) => el.type === ObjectType.AREA)) {
      areas.update((prev) =>
        prev.map((a) => {
          const p = posOf(ObjectType.AREA, a.id);
          return p ? { ...a, x: p.x, y: p.y } : a;
        })
      );
    }
    if (moved.some((el) => el.type === ObjectType.NOTE)) {
      notes.update((prev) =>
        prev.map((n) => {
          const p = posOf(ObjectType.NOTE, n.id);
          return p ? { ...n, x: p.x, y: p.y } : n;
        })
      );
    }
    bulkSelectedElements.set(moved);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!e.isPrimary) return;

    const diagPt = getPointerDiagram(e);
    pointerDiagram = diagPt;

    if ($connecting) {
      connecting.update((c) => (c ? { ...c, x: diagPt.x, y: diagPt.y } : c));
    }

    if (isPanning) {
      const currentTransform = get(transform);
      const rect = svgEl?.getBoundingClientRect();
      const cursorScreen = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0)
      };
      setTransform({
        pan: {
          x: panStart.x + (cursorScreenStart.x - cursorScreen.x) / currentTransform.zoom,
          y: panStart.y + (cursorScreenStart.y - cursorScreen.y) / currentTransform.zoom
        }
      });
      return;
    }

    // Handle element dragging
    if (dragging.type !== ObjectType.NONE && dragging.id !== -1) {
      // Snap the dragged element; the rest of the selection follows by the same delta.
      moveBulkTo(
        snapToGrid({
          x: diagPt.x - dragging.grabOffset.x,
          y: diagPt.y - dragging.grabOffset.y
        })
      );
      return;
    }

    // Handle area resize
    if (areaResize.id !== -1 && areaResize.dir !== 'none') {
      const currentAreas = get(areas);
      const area = currentAreas.find((a) => a.id === areaResize.id);
      if (!area) return;

      let newDims = { ...areaInitDims };
      // Web Canvas.jsx:422 snaps the resize pointer too.
      const { x, y } = snapToGrid(diagPt);

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

    if (bulkSelectRect.show) {
      bulkSelectRect = { ...bulkSelectRect, x2: diagPt.x, y2: diagPt.y };
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (!e.isPrimary) return;
    isPanning = false;
    if ($connecting) finishConnect(e);

    if (dragSnapshotTaken) {
      // The move is committed: the next drag measures from here (web Canvas.jsx:576-581).
      bulkSelectedElements.update((prev) =>
        prev.map((el) => ({ ...el, initialCoords: { ...el.currentCoords } }))
      );
      dragSnapshotTaken = false;
    }

    if (bulkSelectRect.show) {
      const diagPt = getPointerDiagram(e);
      bulkSelectRect = { ...bulkSelectRect, x2: diagPt.x, y2: diagPt.y, show: false };
      // A plain click on empty canvas yields an empty rect → clears the bulk selection.
      collectSelectedElements();
    }

    dragging = { id: -1, type: ObjectType.NONE, grabOffset: { x: 0, y: 0 } };
    areaResize = { id: -1, dir: 'none' };
  }

  function finishConnect(e: PointerEvent) {
    const c = $connecting;
    connecting.set(null);
    if (!c) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest?.('[data-field-row]') as HTMLElement | null;
    if (!row?.dataset) return;
    const endTableId = row.dataset.tableId;
    const endFieldId = row.dataset.fieldId;
    if (!endTableId || !endFieldId) return;
    if (endTableId === c.from.tableId && endFieldId === c.from.fieldId) return;

    const startTable = $tables.find((t) => t.id === c.from.tableId);
    const endTable = $tables.find((t) => t.id === endTableId);
    if (!startTable || !endTable) return;

    const alreadyLinked = $relationships.some(
      (r) =>
        (r.startTableId === c.from.tableId &&
          r.startFieldId === c.from.fieldId &&
          r.endTableId === endTableId &&
          r.endFieldId === endFieldId) ||
        (r.endTableId === c.from.tableId &&
          r.endFieldId === c.from.fieldId &&
          r.startTableId === endTableId &&
          r.startFieldId === endFieldId)
    );
    if (alreadyLinked) return;

    const rel: RelationshipType = {
      id: nanoid(),
      name: `${startTable.name}_${endTable.name}`,
      startTableId: c.from.tableId,
      startFieldId: c.from.fieldId,
      endTableId,
      endFieldId,
      cardinality: Cardinality.MANY_TO_ONE,
      updateConstraint: Constraint.NONE,
      deleteConstraint: Constraint.NONE
    };
    addRelationship(rel);
    selectedElement.set({
      element: ObjectType.RELATIONSHIP,
      id: rel.id,
      open: false,
      currentTab: Tab.RELATIONSHIPS
    });
  }

  // Live preview line while dragging a connection between fields
  let connectPath = $derived.by(() => {
    const c = $connecting;
    if (!c || c.x === null || c.y === null) return '';
    const sourceTable = $tables.find((t) => t.id === c.from.tableId);
    if (!sourceTable) return '';
    // Visible-row index, so the preview starts at the right row of a collapsed table.
    const fieldIndex = getVisibleFieldIndex(sourceTable, c.from.fieldId, $relationships);
    const w = $settings.tableWidth || 220;
    const anchorY = fieldAnchorY(sourceTable, fieldIndex);
    const anchorX = c.x >= sourceTable.x + w / 2 ? sourceTable.x + w : sourceTable.x;
    const midX = (anchorX + c.x) / 2;
    return `M ${anchorX} ${anchorY} Q ${midX} ${anchorY} ${c.x} ${c.y}`;
  });

  function handleCanvasClick(e: MouseEvent) {
    // Only deselect if clicking on the SVG background itself
    if (e.target === svgEl || (e.target as Element)?.closest?.('.grid-pattern')) {
      clearSelection();
    }
  }

  /** Port of web handlePointerDownOnElement (Canvas.jsx:258-330). */
  function handleElementDragStart(
    id: string | number,
    type: number,
    elementX: number,
    elementY: number,
    e: PointerEvent,
    locked = false
  ) {
    // Middle/right presses on an element pan the canvas (handlePointerDown); like web,
    // only the left button selects or drags (Canvas.jsx:497-509).
    if (e.button !== 0) return;
    const additive = e.ctrlKey || e.metaKey;

    // Locked elements can still be selected by a plain click, just not moved
    // or ctrl-added to the multi-selection.
    if (!locked || !additive) {
      selectedElement.set({
        element: type,
        id,
        open: false,
        currentTab: get(selectedElement).currentTab
      });
    }
    if (locked) {
      if (!additive) bulkSelectedElements.set([]);
      return;
    }

    const elementInBulk: BulkElement = {
      id,
      type,
      currentCoords: { x: elementX, y: elementY },
      initialCoords: { x: elementX, y: elementY }
    };
    const bulk = get(bulkSelectedElements);
    const isSelected = bulk.some((el) => isSameElement(el, elementInBulk));

    if (additive) {
      // Ctrl/Cmd-click toggles membership instead of starting a drag.
      if (isSelected) {
        if (bulk.length > 1) {
          bulkSelectedElements.set(bulk.filter((el) => !isSameElement(el, elementInBulk)));
          selectedElement.update((s) => ({ ...s, element: ObjectType.NONE, id: -1, open: false }));
        }
      } else {
        bulkSelectedElements.set([...bulk, elementInBulk]);
      }
      return;
    }

    if (!isSelected) {
      bulkSelectedElements.set([elementInBulk]);
    } else {
      // Re-read positions from the stores: undo/redo or side-panel edits since the
      // selection was made would otherwise leave stale coords and make the group jump.
      // Locked or deleted members are dropped from the group.
      bulkSelectedElements.set(
        bulk.flatMap((el) => {
          const c = elementCoords(el.type, el.id);
          if (!c || isElementLocked(el.type, el.id)) return [];
          return [{ ...el, currentCoords: { ...c }, initialCoords: { ...c } }];
        })
      );
    }

    const diagPt = getPointerDiagram(e);
    dragSnapshotTaken = false;
    dragging = {
      id,
      type,
      grabOffset: {
        x: diagPt.x - elementX,
        y: diagPt.y - elementY
      }
    };
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

</script>

<div
  bind:this={containerEl}
  class="relative grow h-full w-full touch-none overflow-hidden"
  class:bg-white={$settings.mode === 'light'}
  style:background-color={$settings.mode === 'dark' ? 'var(--color-canvas-bg)' : undefined}
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
    onpointercancel={handlePointerUp}
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
        onDragStart={(e) =>
          handleElementDragStart(area.id, ObjectType.AREA, area.x, area.y, e, area.locked)}
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
        onDragStart={(e) =>
          handleElementDragStart(table.id, ObjectType.TABLE, table.x, table.y, e, table.locked)}
      />
    {/each}

    <!-- Notes rendered on top of everything -->
    {#each $notes as note (note.id)}
      <Note
        {note}
        onDragStart={(e) =>
          handleElementDragStart(note.id, ObjectType.NOTE, note.x, note.y, e, note.locked)}
      />
    {/each}

    <!-- Multi-selection outlines. Web marks bulk members via each element's own
         selected style (Table.jsx:108-116); drawn here so the canvas owns it. -->
    {#if $bulkSelectedElements.length > 1}
      {#each $bulkSelectedElements as el (`${el.type}:${el.id}`)}
        {@const r = elementRect(el.type, el.id)}
        {#if r}
          <rect
            x={r.x - 3}
            y={r.y - 3}
            width={r.width + 6}
            height={r.height + 6}
            rx="8"
            fill="none"
            stroke="rgb(59 130 246)"
            stroke-width="2"
            pointer-events="none"
          />
        {/if}
      {/each}
    {/if}

    <!-- Rubber-band selection rectangle (web Canvas.jsx:878-886) -->
    {#if bulkSelectRect.show}
      {@const r = getRectFromEndpoints(bulkSelectRect)}
      <rect
        x={r.x}
        y={r.y}
        width={r.width}
        height={r.height}
        stroke="grey"
        fill="grey"
        fill-opacity="0.15"
        stroke-dasharray="10"
        pointer-events="none"
      />
    {/if}

    <!-- Live connection preview line -->
    {#if $connecting && connectPath}
      <path
        d={connectPath}
        fill="none"
        stroke="#7c3aed"
        stroke-width="2"
        stroke-dasharray="6 4"
        stroke-linecap="round"
        pointer-events="none"
      />
      {#if $connecting.x !== null && $connecting.y !== null}
        <circle cx={$connecting.x} cy={$connecting.y} r="5" fill="#7c3aed" pointer-events="none" />
      {/if}
    {/if}
  </svg>
</div>
