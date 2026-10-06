<script lang="ts">
  import { get } from 'svelte/store';
  import { settings } from '$lib/stores/settings';
  import { selectedElement } from '$lib/stores/select';
  import { relationships, updateTable } from '$lib/stores/diagram';
  import {
    tableHeaderHeight,
    tableFieldHeight,
    tableColorStripHeight,
    ObjectType,
    type Table,
    type Field
  } from '$lib/data/constants';

  let { table, onDragStart }: { table: Table; onDragStart: (e: PointerEvent) => void } =
    $props();

  let $settings = $state<any>({});
  let $selectedElement = $state<any>({});
  let $relationships = $state<any[]>([]);

  $effect(() => {
    const unsub1 = settings.subscribe((v) => ($settings = v));
    const unsub2 = selectedElement.subscribe((v) => ($selectedElement = v));
    const unsub3 = relationships.subscribe((v) => ($relationships = v));
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  });

  let hovered = $state(false);

  let tableWidth = $derived($settings.tableWidth || 220);

  let isSelected = $derived(
    ($selectedElement.id === table.id && $selectedElement.element === ObjectType.TABLE)
  );

  let visibleFields = $derived(
    table.collapsed ? table.fields.filter((f) => isFieldLinked(f)) : table.fields
  );

  function isFieldLinked(field: Field): boolean {
    return $relationships.some(
      (r) =>
        (r.startTableId === table.id && r.startFieldId === field.id) ||
        (r.endTableId === table.id && r.endFieldId === field.id)
    );
  }

  let tableHeight = $derived(
    tableColorStripHeight + tableHeaderHeight + visibleFields.length * tableFieldHeight
  );

  let borderColor = $derived($settings.mode === 'light' ? '#d4d4d8' : '#52525b');

  function handlePointerDown(e: PointerEvent) {
    if (!e.isPrimary) return;
    // Required for pointer leave to fire properly on touch
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    onDragStart(e);
  }

  function getFieldIcon(field: Field): string {
    if (field.primary) return 'PK';
    // Check if this field is a foreign key
    const isFk = $relationships.some(
      (r) => r.startTableId === table.id && r.startFieldId === field.id
    );
    if (isFk) return 'FK';
    return '';
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<foreignObject
  x={table.x}
  y={table.y}
  width={tableWidth}
  height={tableHeight}
  class="drop-shadow-lg rounded-md cursor-move"
  onpointerdown={handlePointerDown}
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
>
  <div
    class="border-2 select-none rounded-lg w-full overflow-hidden"
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
      style:background-color={table.color}
      style:height="{tableColorStripHeight}px"
    ></div>

    <!-- Header -->
    <div
      class="flex items-center justify-between px-3 border-b border-gray-400"
      class:bg-zinc-100={$settings.mode === 'light'}
      class:bg-zinc-900={$settings.mode === 'dark'}
      style:height="{tableHeaderHeight}px"
    >
      <div class="overflow-hidden text-ellipsis whitespace-nowrap font-bold flex-1 min-w-0">
        {table.name}
      </div>
      {#if hovered}
        <button
          class="shrink-0 ml-2 text-xs px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => {
            e.stopPropagation();
            updateTable(table.id, { collapsed: !table.collapsed });
          }}
        >
          {table.collapsed ? '+' : '-'}
        </button>
      {/if}
    </div>

    <!-- Fields -->
    {#each visibleFields as field, i (field.id)}
      {@const icon = getFieldIcon(field)}
      <div
        class="flex items-center justify-between px-2 py-1 gap-1 w-full overflow-hidden"
        class:border-b={i < visibleFields.length - 1}
        class:border-gray-400={i < visibleFields.length - 1}
        style:height="{tableFieldHeight}px"
      >
        <div class="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
          <!-- Field grip dot -->
          <span
            class="shrink-0 w-2.5 h-2.5 rounded-full"
            style:background-color="#2f68adcc"
          ></span>
          <span class="overflow-hidden text-ellipsis whitespace-nowrap text-sm">
            {field.name}
          </span>
        </div>
        <div class="flex items-center gap-1 text-zinc-400 text-xs shrink-0">
          {#if icon}
            <span class="font-mono font-bold text-blue-500">{icon}</span>
          {/if}
          {#if !field.notNull}
            <span class="font-mono">?</span>
          {/if}
          {#if $settings.showDataTypes}
            <span class="font-mono text-emerald-600 dark:text-emerald-400">
              {field.type}{field.size ? `(${field.size})` : ''}
            </span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</foreignObject>
