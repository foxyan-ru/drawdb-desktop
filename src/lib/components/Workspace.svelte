<script lang="ts">
	import { get } from 'svelte/store';
	import ControlPanel from './Header/ControlPanel.svelte';
	import Modal from './Header/Modal.svelte';
	import FloatingControls from './FloatingControls.svelte';
	import SidePanel from './SidePanel/SidePanel.svelte';
	import Canvas from './Canvas/Canvas.svelte';
	import { layout } from '$lib/stores/layout';
	import { currentModal } from '$lib/stores/modal';

	let $layout = $state(get(layout));

	$effect(() => {
		return layout.subscribe((v) => ($layout = v));
	});
</script>

<div class="flex flex-col h-full w-full overflow-hidden">
	<!-- Header -->
	{#if $layout.header}
		<ControlPanel />
	{/if}

	<!-- Main Content Area -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Side Panel -->
		{#if $layout.sidebar}
			<SidePanel />
		{/if}

		<!-- Canvas Area -->
		<main class="flex-1 relative bg-[var(--color-canvas-bg)] overflow-hidden">
			<Canvas />

			<!-- Floating Controls -->
			{#if $layout.toolbar}
				<FloatingControls />
			{/if}
		</main>
	</div>

	<!-- Modal -->
	<Modal bind:modal={$currentModal} />
</div>
