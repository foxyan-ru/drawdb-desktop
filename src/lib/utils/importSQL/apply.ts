import { nanoid } from 'nanoid';
import type { CustomType, EnumType, Relationship, Table } from '../../data/constants';
import type { ImportedDiagram } from './shared';

/**
 * The `diagram.ts` / `undoRedo.ts` / `transform.ts` entry points the import
 * goes through — injected (like `applyIntrospectedDiagram`'s helpers) so this
 * stays unit-testable without the store graph.
 */
export interface ApplyImportHelpers {
	exportDiagram: () => {
		relationships: Relationship[];
		types: CustomType[];
		enums: EnumType[];
		[key: string]: unknown;
	};
	loadDiagram: (data: Record<string, unknown>) => void;
	addTable: (data: { table: Table }) => void;
	addRelationship: (rel: Relationship, addToHistory?: boolean) => void;
	addEnum: (data: { enum: EnumType }) => void;
	addType: (data: { type: CustomType }) => void;
	clearHistory: () => void;
	resetPan: () => void;
}

export interface ApplyImportOptions {
	/** Replace the diagram instead of appending to it (web "Overwrite existing diagram"). */
	overwrite: boolean;
	/** `databases[diagramDb].hasTypes` / `.hasEnums` — composite types / enums are only kept where supported. */
	hasTypes: boolean;
	hasEnums: boolean;
}

/**
 * Applies an imported diagram (port of web Modal.jsx:167-195 `applyImportedDiagram`).
 *
 * - overwrite: tables, relationships (and types/enums where the engine has them)
 *   are replaced; notes and areas are cleared; pan resets to the origin. Goes
 *   through `loadDiagram`, the store's bulk-replace path (also used by open/undo).
 * - merge: tables/relationships/types/enums are appended through the normal
 *   `add*` helpers. Web re-indexes relationship ids to `0..n` because its ids
 *   are array positions; here ids are nanoid strings, so only an (unlikely)
 *   collision with an existing id is re-keyed.
 *
 * Both modes clear undo/redo afterwards, as web does (Modal.jsx:191-192).
 */
export function applyImportedDiagram(
	diagram: ImportedDiagram,
	opts: ApplyImportOptions,
	helpers: ApplyImportHelpers
): void {
	const current = helpers.exportDiagram();

	if (opts.overwrite) {
		helpers.loadDiagram({
			...current,
			tables: diagram.tables,
			relationships: diagram.relationships,
			subjectAreas: [],
			notes: [],
			types: opts.hasTypes ? (diagram.types ?? []) : current.types,
			enums: opts.hasEnums ? (diagram.enums ?? []) : current.enums
		});
		helpers.resetPan();
	} else {
		const usedIds = new Set(current.relationships.map((r) => r.id));
		for (const table of diagram.tables) helpers.addTable({ table });
		for (const rel of diagram.relationships) {
			const id = usedIds.has(rel.id) ? nanoid() : rel.id;
			usedIds.add(id);
			helpers.addRelationship(id === rel.id ? rel : { ...rel, id }, false);
		}
		if (opts.hasTypes) for (const type of diagram.types ?? []) helpers.addType({ type });
		if (opts.hasEnums) for (const e of diagram.enums ?? []) helpers.addEnum({ enum: e });
	}

	helpers.clearHistory();
}
