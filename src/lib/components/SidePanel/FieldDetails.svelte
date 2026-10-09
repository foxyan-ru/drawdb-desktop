<script lang="ts">
	// Port of drawdb.app `components/EditorSidePanel/TablesTab/FieldDetails.jsx`.
	// Web renders this inside a Popover to the right of the field row; the desktop
	// side panel is a fixed 280px column inside an overflow container, so it is
	// shown as an inline expandable panel under the row instead (TablesTab.svelte).
	// Undo: every edit goes through `updateField`/`deleteField`, which snapshot via
	// undoRedo.ts (coalesced per field), replacing web's manual setUndoStack calls.
	import { _ } from 'svelte-i18n';
	import type { Field } from '$lib/data/constants';
	import { resolveType } from '$lib/data/datatypes';
	import { databases } from '$lib/data/databases';
	import { updateField, deleteField } from '$lib/stores/diagram';

	let { field, tid, db }: { field: Field; tid: string; db: string } = $props();

	// FieldDetails.jsx:21 — metadata for the current type (BLOB fallback for enum/type names).
	const resolved = $derived(resolveType(db, field.type));
	const dbInfo = $derived(databases[db]);
	const isEnumOrSet = $derived(field.type === 'ENUM' || field.type === 'SET');
	const values = $derived(field.values ?? []);

	// FieldDetails.jsx:144 — precision is "size, digits"; an empty value is fine.
	const precisionInvalid = $derived(
		!!field.size && !/^\d+,\s*\d+$|^$/.test(String(field.size))
	);

	let tagDraft = $state('');

	const inputClass =
		'w-full rounded border bg-white px-2 py-1 text-xs text-zinc-900 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:text-zinc-100';
	const okBorder = 'border-zinc-300 focus:border-blue-500 dark:border-zinc-600';
	const errBorder = 'border-red-500 focus:border-red-500 dark:border-red-500';
	const labelClass = 'mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400';

	function update(patch: Partial<Field>) {
		updateField(tid, field.id, patch);
	}

	// FieldDetails.jsx:270 — turning increment on clears the check expression.
	function toggleIncrement() {
		update({ increment: !field.increment, check: field.increment ? field.check : '' });
	}

	// FieldDetails.jsx:306 — declaring an array turns auto-increment off.
	function toggleArray(checked: boolean) {
		update({ isArray: checked, increment: field.isArray ? field.increment : false });
	}

	// --- ENUM / SET values: minimal TagInput (web uses Semi TagInput with
	// separator [",", ", ", " ,"] and addOnBlur — FieldDetails.jsx:64-71).
	function addTags(raw: string) {
		const parts = raw
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s !== '');
		if (parts.length === 0) return;
		update({ values: [...values, ...parts] });
	}

	function handleTagInput(value: string) {
		if (value.includes(',')) {
			// Keep whatever follows the last separator as the in-progress tag.
			const lastComma = value.lastIndexOf(',');
			addTags(value.slice(0, lastComma));
			tagDraft = value.slice(lastComma + 1).trimStart();
		} else {
			tagDraft = value;
		}
	}

	function handleTagKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addTags(tagDraft);
			tagDraft = '';
		} else if (e.key === 'Backspace' && tagDraft === '' && values.length > 0) {
			update({ values: values.slice(0, -1) });
		}
	}

	function handleTagBlur() {
		addTags(tagDraft);
		tagDraft = '';
	}

	function removeTag(index: number) {
		update({ values: values.filter((_, i) => i !== index) });
	}

	function handleSizeInput(raw: string) {
		update({ size: raw === '' ? '' : Number(raw) });
	}
</script>

<div class="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-600">
	<!-- Default value (FieldDetails.jsx:29-58) -->
	<label class="mb-2 block">
		<span class={labelClass}>{$_('default_value')}</span>
		<input
			type="text"
			class="{inputClass} {okBorder}"
			placeholder={$_('default_value')}
			value={field.default ?? ''}
			disabled={!!resolved.noDefault || field.increment}
			oninput={(e) => update({ default: e.currentTarget.value })}
		/>
	</label>

	<!-- ENUM / SET values (FieldDetails.jsx:59-103) -->
	{#if isEnumOrSet}
		<div class="mb-2">
			<span class={labelClass}>{field.type} {$_('values')}</span>
			<div
				class="flex flex-wrap items-center gap-1 rounded border bg-white px-1.5 py-1 dark:bg-zinc-700 {values.length ===
				0
					? errBorder
					: okBorder}"
			>
				{#each values as val, index}
					<span
						class="inline-flex items-center gap-0.5 rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-800 dark:bg-zinc-600 dark:text-zinc-100"
					>
						{val}
						<button
							type="button"
							class="text-zinc-500 hover:text-red-600 dark:text-zinc-300 dark:hover:text-red-400"
							title={$_('remove_value')}
							onclick={() => removeTag(index)}
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
							</svg>
						</button>
					</span>
				{/each}
				<input
					type="text"
					class="min-w-[60px] flex-1 bg-transparent py-0.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder-zinc-500"
					placeholder={$_('use_for_batch_input', { default: 'Use , for batch input' })}
					value={tagDraft}
					oninput={(e) => handleTagInput(e.currentTarget.value)}
					onkeydown={handleTagKeydown}
					onblur={handleTagBlur}
				/>
			</div>
		</div>
	{/if}

	<!-- Size (FieldDetails.jsx:104-136) -->
	{#if resolved.isSized}
		<label class="mb-2 block">
			<span class={labelClass}>{$_('size')}</span>
			<input
				type="number"
				min="0"
				class="{inputClass} {okBorder}"
				placeholder={$_('size')}
				value={field.size ?? ''}
				oninput={(e) => handleSizeInput(e.currentTarget.value)}
			/>
		</label>
	{/if}

	<!-- Precision (FieldDetails.jsx:137-174) -->
	{#if resolved.hasPrecision}
		<label class="mb-2 block">
			<span class={labelClass}>{$_('precision', { default: 'Precision' })}</span>
			<input
				type="text"
				class="{inputClass} {precisionInvalid ? errBorder : okBorder}"
				placeholder={$_('set_precision', { default: "Set precision: 'size, digits'" })}
				value={field.size ?? ''}
				oninput={(e) => update({ size: e.currentTarget.value })}
			/>
		</label>
	{/if}

	<!-- Check expression (FieldDetails.jsx:175-209) -->
	{#if resolved.hasCheck}
		<label class="mb-2 block">
			<span class={labelClass}>{$_('check')}</span>
			<input
				type="text"
				class="{inputClass} {okBorder}"
				placeholder={$_('check')}
				value={field.check ?? ''}
				disabled={field.increment}
				oninput={(e) => update({ check: e.currentTarget.value })}
			/>
			<span class="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-400">
				{$_('this_will_appear_as_is', {
					default: '*This will appear in the generated script as is.'
				})}
			</span>
		</label>
	{/if}

	<!-- Toggles (FieldDetails.jsx:210-352) -->
	<label class="my-2 flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300">
		<span class="font-medium">{$_('unique')}</span>
		<input
			type="checkbox"
			class="h-3.5 w-3.5"
			checked={field.unique}
			onchange={(e) => update({ unique: e.currentTarget.checked })}
		/>
	</label>

	<label
		class="my-2 flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300 {!resolved.canIncrement ||
		field.isArray
			? 'opacity-50'
			: ''}"
	>
		<span class="font-medium">{$_('auto_increment')}</span>
		<input
			type="checkbox"
			class="h-3.5 w-3.5"
			checked={field.increment}
			disabled={!resolved.canIncrement || !!field.isArray}
			onchange={toggleIncrement}
		/>
	</label>

	{#if dbInfo?.hasArrays}
		<label class="my-2 flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300">
			<span class="font-medium">{$_('declare_array', { default: 'Declare array' })}</span>
			<input
				type="checkbox"
				class="h-3.5 w-3.5"
				checked={!!field.isArray}
				onchange={(e) => toggleArray(e.currentTarget.checked)}
			/>
		</label>
	{/if}

	{#if dbInfo?.hasUnsignedTypes && resolved.signed}
		<label class="my-2 flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300">
			<span class="font-medium">{$_('unsigned')}</span>
			<input
				type="checkbox"
				class="h-3.5 w-3.5"
				checked={!!field.unsigned}
				onchange={(e) => update({ unsigned: e.currentTarget.checked })}
			/>
		</label>
	{/if}

	<!-- Comment (FieldDetails.jsx:353-383) -->
	<label class="mb-2 block">
		<span class={labelClass}>{$_('comment')}</span>
		<textarea
			class="{inputClass} {okBorder}"
			rows="2"
			placeholder={$_('comment')}
			value={field.comment ?? ''}
			oninput={(e) => update({ comment: e.currentTarget.value })}
		></textarea>
	</label>

	<!-- Delete (FieldDetails.jsx:384-392) -->
	<button
		type="button"
		class="flex w-full items-center justify-center gap-1.5 rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
		onclick={() => deleteField(tid, field.id)}
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
		</svg>
		{$_('delete')}
	</button>
</div>
