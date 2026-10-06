<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { ObjectType, type Note } from '$lib/data/constants';
	import { notes, addNote, deleteNote, updateNote } from '$lib/stores/diagram';
	import { selectedElement, clearSelection } from '$lib/stores/select';

	let noteList = $state<Note[]>([]);
	let selectedId = $state<number>(-1);
	let search = $state('');

	$effect(() => {
		return notes.subscribe((v) => {
			noteList = v;
		});
	});

	$effect(() => {
		return selectedElement.subscribe((sel) => {
			if (sel.element === ObjectType.NOTE) {
				selectedId = sel.id as number;
			} else {
				selectedId = -1;
			}
		});
	});

	const filtered = $derived(
		search.trim()
			? noteList.filter(
					(n) =>
						n.title.toLowerCase().includes(search.toLowerCase()) ||
						n.content.toLowerCase().includes(search.toLowerCase())
				)
			: noteList
	);

	function selectNote(note: Note) {
		if (selectedId === note.id) {
			clearSelection();
		} else {
			selectedElement.set({
				element: ObjectType.NOTE,
				id: note.id,
				open: true,
				currentTab: '4'
			});
		}
	}

	function handleTitleChange(id: number, value: string) {
		updateNote(id, { title: value });
	}

	function handleContentChange(id: number, value: string) {
		updateNote(id, { content: value });
	}

	function handleColorChange(id: number, value: string) {
		updateNote(id, { color: value });
	}

	function handleDelete(id: number) {
		deleteNote(id);
	}

	function handleAdd() {
		addNote();
	}
</script>

<div class="p-3">
	<!-- Search -->
	<div class="mb-3">
		<input
			type="text"
			placeholder={$_('search')}
			class="w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
			bind:value={search}
		/>
	</div>

	{#each filtered as note (note.id)}
		<div class="mb-2 rounded border border-zinc-200 dark:border-zinc-700">
			<!-- Note header -->
			<button
				class="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 {selectedId === note.id
					? 'bg-blue-50 dark:bg-blue-900/30'
					: ''}"
				onclick={() => selectNote(note)}
			>
				<div class="flex items-center gap-2">
					<span
						class="inline-block h-3 w-3 rounded-sm"
						style="background-color: {note.color}"
					></span>
					<span class="font-medium text-zinc-900 dark:text-zinc-100">{note.title}</span>
				</div>
			</button>

			<!-- Expanded details -->
			{#if selectedId === note.id}
				<div class="border-t border-zinc-200 p-3 dark:border-zinc-700">
					<!-- Title -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('title')}</span>
						<input
							type="text"
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							value={note.title}
							oninput={(e) => handleTitleChange(note.id, e.currentTarget.value)}
						/>
					</label>

					<!-- Color -->
					<label class="mb-2 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('color')}</span>
						<input
							type="color"
							class="h-8 w-full cursor-pointer rounded border border-zinc-300 dark:border-zinc-600"
							value={note.color}
							oninput={(e) => handleColorChange(note.id, e.currentTarget.value)}
						/>
					</label>

					<!-- Content -->
					<label class="mb-3 block">
						<span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{$_('content')}</span>
						<textarea
							class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
							rows="4"
							value={note.content}
							oninput={(e) => handleContentChange(note.id, e.currentTarget.value)}
						></textarea>
					</label>

					<!-- Delete button -->
					<button
						class="w-full rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
						onclick={() => handleDelete(note.id)}
					>
						{$_('delete_note')}
					</button>
				</div>
			{/if}
		</div>
	{/each}

	{#if filtered.length === 0 && search}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_notes_search')}</p>
	{:else if filtered.length === 0}
		<p class="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{$_('no_notes')}.</p>
	{/if}

	<!-- Add note button -->
	<button
		class="mt-2 w-full rounded bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
		onclick={handleAdd}
	>
		+ {$_('add_note')}
	</button>
</div>
