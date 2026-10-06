<script lang="ts">
	import '../app.css';
	import '$lib/i18n';
	import { isLoading } from 'svelte-i18n';
	import { onMount } from 'svelte';
	import { setupNativeMenu } from '$lib/menu';

	let { children } = $props();

	onMount(() => {
		// Fire and forget: builds/applies the native OS menu bar. Self-guards
		// with try/catch internally, so this never blocks or throws even when
		// no Tauri runtime is present (e.g. plain browser preview).
		setupNativeMenu();
	});
</script>

<div class="h-screen w-screen overflow-hidden flex flex-col">
	{#if $isLoading}
		<div class="flex h-full w-full items-center justify-center bg-white dark:bg-zinc-900">
			<p class="text-sm text-zinc-400 dark:text-zinc-500">Loading...</p>
		</div>
	{:else}
		{@render children()}
	{/if}
</div>
