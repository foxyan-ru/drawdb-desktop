import type { Table, Relationship } from '$lib/data/constants';

export interface DiagramData {
	tables: Table[];
	relationships: Relationship[];
	[key: string]: unknown;
}

/**
 * Export a diagram as a formatted JSON string.
 *
 * Serializes the full diagram object (tables, relationships, and any
 * additional metadata) with 2-space indentation for readability.
 */
export function exportJSON(diagram: DiagramData): string {
	return JSON.stringify(diagram, null, 2);
}
