<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { fly, fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { toasts, dismissToast } from '$lib/stores/toast';
</script>

<!--
	WHY top-center: web's Semi UI Toast (used throughout
	drawdb-main/src/components/EditorHeader/ControlPanel.jsx) stacks at the top
	center of the viewport; top-12 keeps it clear of the 40px header bar.
	z-[200] sits above Header/Modal.svelte's z-[100] overlay.
-->
<div
	class="fixed top-12 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none select-none"
>
	{#each $toasts as toast (toast.id)}
		<div
			class="pointer-events-auto flex items-center gap-2 min-w-56 max-w-md px-3 py-2 rounded shadow-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-200"
			role={toast.type === 'error' ? 'alert' : 'status'}
			aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
			in:fly={{ y: -8, duration: 150 }}
			out:fade={{ duration: 150 }}
			animate:flip={{ duration: 150 }}
		>
			{#if toast.type === 'success'}
				<svg class="w-4 h-4 shrink-0 text-green-600 dark:text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="16 9 10.5 15 8 12.5"/></svg>
			{:else if toast.type === 'error'}
				<svg class="w-4 h-4 shrink-0 text-red-600 dark:text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
			{:else}
				<svg class="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
			{/if}
			<span class="flex-1 break-words">{toast.message}</span>
			<button
				class="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
				title={$_('close')}
				aria-label={$_('close')}
				onclick={() => dismissToast(toast.id)}
			>
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
			</button>
		</div>
	{/each}
</div>
