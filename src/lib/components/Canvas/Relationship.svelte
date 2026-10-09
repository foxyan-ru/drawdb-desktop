<script lang="ts">
  import { tables, relationships } from '$lib/stores/diagram';
  import { settings } from '$lib/stores/settings';
  import { selectedElement } from '$lib/stores/select';
  import {
    calcPath,
    calcCompositePath,
    getRelationshipFieldPairs,
    getVisibleFieldIndex
  } from '$lib/utils/calcPath';
  import {
    defaultRelationshipColor,
    Cardinality,
    ObjectType,
    Tab,
    type Relationship
  } from '$lib/data/constants';

  let { relationship }: { relationship: Relationship } = $props();

  let hovered = $state(false);
  let pathEl: SVGPathElement | undefined = $state(undefined);

  let tableWidth = $derived($settings.tableWidth || 220);

  let startTable = $derived($tables.find((t) => t.id === relationship.startTableId));
  let endTable = $derived($tables.find((t) => t.id === relationship.endTableId));

  /**
   * Geometry inputs, ported from web Relationship.jsx:24-68: field indices are
   * taken over the *visible* rows (a collapsed table renders only its linked
   * fields — see Table.svelte), not the raw `fields` array.
   * TODO(hidden tables): web also returns null when either table is `hidden`;
   * desktop's Table type has no `hidden` flag yet (tracked in a later batch).
   */
  let pathValues = $derived.by(() => {
    const st = startTable;
    const et = endTable;
    if (!st || !et) return null;
    const rels = $relationships;
    const pairs = getRelationshipFieldPairs(relationship);
    return {
      startTable: { x: st.x, y: st.y, width: tableWidth },
      endTable: { x: et.x, y: et.y, width: tableWidth },
      startFieldIndex: getVisibleFieldIndex(st, relationship.startFieldId, rels),
      endFieldIndex: getVisibleFieldIndex(et, relationship.endFieldId, rels),
      startFieldIndices: pairs.map((p) => getVisibleFieldIndex(st, p.startFieldId, rels)),
      endFieldIndices: pairs.map((p) => getVisibleFieldIndex(et, p.endFieldId, rels))
    };
  });

  // Composite (multi-column) FKs draw a fork path (web Relationship.jsx:70-84).
  let composite = $derived(
    pathValues && pathValues.startFieldIndices.length > 1 ? calcCompositePath(pathValues) : null
  );

  let pathData = $derived(composite ? composite.path : calcPath(pathValues));

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

  type LabelPoints = {
    start: { x: number; y: number };
    end: { x: number; y: number };
    mid: { x: number; y: number };
  };

  /**
   * Points for the cardinality badges and name label. Measured in an $effect
   * (after the DOM `d` attribute is updated) and keyed on `pathData`, so the
   * labels follow the line while tables are dragged. Composite paths use the
   * fork's own anchor points (web Relationship.jsx:126-132) — measuring a
   * multi-subpath `d` along its length would land on arbitrary branches.
   */
  let cardinalityPoints = $state<LabelPoints | null>(null);

  $effect(() => {
    const d = pathData;
    const c = composite;
    if (c) {
      cardinalityPoints = { start: c.startCardinality, end: c.endCardinality, mid: c.labelPoint };
      return;
    }
    if (!pathEl || !d) {
      cardinalityPoints = null;
      return;
    }
    try {
      const pathLength = pathEl.getTotalLength();
      if (pathLength < 60) {
        cardinalityPoints = null;
        return;
      }
      const offset = 28;
      const startPt = pathEl.getPointAtLength(offset);
      const endPt = pathEl.getPointAtLength(pathLength - offset);
      const midPt = pathEl.getPointAtLength(pathLength / 2);
      cardinalityPoints = {
        start: { x: startPt.x, y: startPt.y },
        end: { x: endPt.x, y: endPt.y },
        mid: { x: midPt.x, y: midPt.y }
      };
    } catch {
      cardinalityPoints = null;
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
