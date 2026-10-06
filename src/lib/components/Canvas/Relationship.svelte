<script lang="ts">
  import { get } from 'svelte/store';
  import { tables } from '$lib/stores/diagram';
  import { settings } from '$lib/stores/settings';
  import { selectedElement } from '$lib/stores/select';
  import {
    tableHeaderHeight,
    tableFieldHeight,
    tableColorStripHeight,
    defaultRelationshipColor,
    Cardinality,
    ObjectType,
    Tab,
    type Relationship,
    type Table
  } from '$lib/data/constants';

  let { relationship }: { relationship: Relationship } = $props();

  let $tables = $state<Table[]>([]);
  let $settings = $state<any>({});
  let $selectedElement = $state<any>({});

  $effect(() => {
    const unsub1 = tables.subscribe((v) => ($tables = v));
    const unsub2 = settings.subscribe((v) => ($settings = v));
    const unsub3 = selectedElement.subscribe((v) => ($selectedElement = v));
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  });

  let hovered = $state(false);
  let pathEl: SVGPathElement | undefined = $state(undefined);

  let tableWidth = $derived($settings.tableWidth || 220);

  let startTable = $derived($tables.find((t) => t.id === relationship.startTableId));
  let endTable = $derived($tables.find((t) => t.id === relationship.endTableId));

  /**
   * Get field index within visible fields list.
   */
  function getFieldIndex(table: Table | undefined, fieldId: string): number {
    if (!table) return 0;
    const idx = table.fields.findIndex((f) => f.id === fieldId);
    return idx >= 0 ? idx : 0;
  }

  let startFieldIndex = $derived(getFieldIndex(startTable, relationship.startFieldId));
  let endFieldIndex = $derived(getFieldIndex(endTable, relationship.endFieldId));

  /**
   * Calculate the path between two table fields.
   * Uses the same logic as the original calcPath:
   * - Determine y positions based on field index
   * - Determine whether to exit left or right of each table
   * - Draw cubic bezier with rounded corners
   */
  let pathData = $derived.by(() => {
    if (!startTable || !endTable) return '';

    const w = tableWidth;
    const x1 = startTable.x;
    const y1 =
      startTable.y +
      tableColorStripHeight +
      tableHeaderHeight +
      startFieldIndex * tableFieldHeight +
      tableFieldHeight / 2;
    const x2 = endTable.x;
    const y2 =
      endTable.y +
      tableColorStripHeight +
      tableHeaderHeight +
      endFieldIndex * tableFieldHeight +
      tableFieldHeight / 2;

    let radius = 10;
    const midX = (x2 + x1 + w) / 2;
    const endX = x2 + w < x1 ? x2 + w : x2;

    if (Math.abs(y1 - y2) <= 36) {
      radius = Math.abs(y2 - y1) / 3;
      if (radius <= 2) {
        if (x1 + w <= x2) return `M ${x1 + w} ${y1} L ${x2} ${y2 + 0.1}`;
        else if (x2 + w < x1)
          return `M ${x1} ${y1} L ${x2 + w} ${y2 + 0.1}`;
      }
    }

    if (y1 <= y2) {
      if (x1 + w <= x2) {
        return `M ${x1 + w} ${y1} L ${midX - radius} ${y1} A ${radius} ${radius} 0 0 1 ${midX} ${y1 + radius} L ${midX} ${y2 - radius} A ${radius} ${radius} 0 0 0 ${midX + radius} ${y2} L ${endX} ${y2}`;
      } else if (x2 <= x1 + w && x1 <= x2) {
        return `M ${x1 + w} ${y1} L ${x2 + w} ${y1} A ${radius} ${radius} 0 0 1 ${x2 + w + radius} ${y1 + radius} L ${x2 + w + radius} ${y2 - radius} A ${radius} ${radius} 0 0 1 ${x2 + w} ${y2} L ${x2 + w} ${y2}`;
      } else if (x2 + w >= x1 && x2 + w <= x1 + w) {
        return `M ${x1} ${y1} L ${x2 - radius} ${y1} A ${radius} ${radius} 0 0 0 ${x2 - radius - radius} ${y1 + radius} L ${x2 - radius - radius} ${y2 - radius} A ${radius} ${radius} 0 0 0 ${x2 - radius} ${y2} L ${x2} ${y2}`;
      } else {
        return `M ${x1} ${y1} L ${midX + radius} ${y1} A ${radius} ${radius} 0 0 0 ${midX} ${y1 + radius} L ${midX} ${y2 - radius} A ${radius} ${radius} 0 0 1 ${midX - radius} ${y2} L ${endX} ${y2}`;
      }
    } else {
      if (x1 + w <= x2) {
        return `M ${x1 + w} ${y1} L ${midX - radius} ${y1} A ${radius} ${radius} 0 0 0 ${midX} ${y1 - radius} L ${midX} ${y2 + radius} A ${radius} ${radius} 0 0 1 ${midX + radius} ${y2} L ${endX} ${y2}`;
      } else if (x1 + w >= x2 && x1 + w <= x2 + w) {
        return `M ${x1} ${y1} L ${x1 - radius - radius} ${y1} A ${radius} ${radius} 0 0 1 ${x1 - radius - radius - radius} ${y1 - radius} L ${x1 - radius - radius - radius} ${y2 + radius} A ${radius} ${radius} 0 0 1 ${x1 - radius - radius} ${y2} L ${endX} ${y2}`;
      } else if (x1 >= x2 && x1 <= x2 + w) {
        return `M ${x1 + w} ${y1} L ${x1 + w + radius} ${y1} A ${radius} ${radius} 0 0 0 ${x1 + w + radius + radius} ${y1 - radius} L ${x1 + w + radius + radius} ${y2 + radius} A ${radius} ${radius} 0 0 0 ${x1 + w + radius} ${y2} L ${x2 + w} ${y2}`;
      } else {
        return `M ${x1} ${y1} L ${midX + radius} ${y1} A ${radius} ${radius} 0 0 1 ${midX} ${y1 - radius} L ${midX} ${y2 + radius} A ${radius} ${radius} 0 0 0 ${midX - radius} ${y2} L ${endX} ${y2}`;
      }
    }
  });

  let isSelected = $derived(
    $selectedElement.element === ObjectType.RELATIONSHIP &&
    $selectedElement.id === relationship.id
  );

  let strokeColor = $derived(
    hovered || isSelected
      ? '#0284c7'
      : relationship.color || defaultRelationshipColor
  );

  let cardinalityStart = $derived.by(() => {
    switch (relationship.cardinality) {
      case Cardinality.MANY_TO_ONE:
        return 'n';
      case Cardinality.ONE_TO_MANY:
        return '1';
      case Cardinality.ONE_TO_ONE:
      default:
        return '1';
    }
  });

  let cardinalityEnd = $derived.by(() => {
    switch (relationship.cardinality) {
      case Cardinality.MANY_TO_ONE:
        return '1';
      case Cardinality.ONE_TO_MANY:
        return 'n';
      case Cardinality.ONE_TO_ONE:
      default:
        return '1';
    }
  });

  /**
   * Get points along the path for cardinality labels.
   */
  let cardinalityPoints = $derived.by(() => {
    if (!pathEl) return null;
    try {
      const pathLength = pathEl.getTotalLength();
      if (pathLength < 60) return null;
      const offset = 28;
      const startPt = pathEl.getPointAtLength(offset);
      const endPt = pathEl.getPointAtLength(pathLength - offset);
      const midPt = pathEl.getPointAtLength(pathLength / 2);
      return {
        start: { x: startPt.x, y: startPt.y },
        end: { x: endPt.x, y: endPt.y },
        mid: { x: midPt.x, y: midPt.y }
      };
    } catch {
      return null;
    }
  });

  function handleClick() {
    selectedElement.set({
      element: ObjectType.RELATIONSHIP,
      id: relationship.id,
      open: false,
      currentTab: Tab.RELATIONSHIPS
    });
  }
</script>

{#if startTable && endTable && pathData}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <g
    class="select-none group"
    onpointerenter={() => (hovered = true)}
    onpointerleave={() => (hovered = false)}
    onclick={handleClick}
  >
    <!-- Invisible wider path for better hover/click target -->
    <path
      d={pathData}
      fill="none"
      stroke="transparent"
      stroke-width="12"
      class="cursor-pointer"
    />
    <!-- Visible relationship line -->
    <path
      bind:this={pathEl}
      d={pathData}
      fill="none"
      stroke={strokeColor}
      stroke-width="2"
      class="cursor-pointer"
    />

    <!-- Relationship name label -->
    {#if $settings.showRelationshipLabels && cardinalityPoints}
      <text
        x={cardinalityPoints.mid.x}
        y={cardinalityPoints.mid.y - 8}
        fill={strokeColor}
        font-size="14"
        font-weight="500"
        text-anchor="middle"
      >
        {relationship.name}
      </text>
    {/if}

    <!-- Cardinality labels -->
    {#if $settings.showCardinality && cardinalityPoints}
      <!-- Start cardinality -->
      <g>
        <rect
          x={cardinalityPoints.start.x - 10}
          y={cardinalityPoints.start.y - 10}
          rx="10"
          ry="10"
          width="20"
          height="20"
          fill={strokeColor}
        />
        <text
          x={cardinalityPoints.start.x}
          y={cardinalityPoints.start.y}
          fill="white"
          font-size="12"
          text-anchor="middle"
          dominant-baseline="central"
        >
          {cardinalityStart}
        </text>
      </g>
      <!-- End cardinality -->
      <g>
        <rect
          x={cardinalityPoints.end.x - 10}
          y={cardinalityPoints.end.y - 10}
          rx="10"
          ry="10"
          width="20"
          height="20"
          fill={strokeColor}
        />
        <text
          x={cardinalityPoints.end.x}
          y={cardinalityPoints.end.y}
          fill="white"
          font-size="12"
          text-anchor="middle"
          dominant-baseline="central"
        >
          {cardinalityEnd}
        </text>
      </g>
    {/if}
  </g>
{/if}
