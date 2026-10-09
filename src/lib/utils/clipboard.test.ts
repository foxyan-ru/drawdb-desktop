import { describe, expect, test } from 'bun:test';
import {
	PASTE_OFFSET,
	parseClipboardElement,
	prepareForPaste,
	serializeClipboardElement,
	type ClipboardElement
} from './clipboard';
import { noteWidth, type Area, type Note, type Table } from '../data/constants';

const table: Table = {
	id: 'tbl1',
	name: 'users',
	x: 100,
	y: 50,
	fields: [
		{
			id: 'f1',
			name: 'id',
			type: 'INT',
			default: '',
			check: '',
			primary: true,
			unique: false,
			notNull: true,
			increment: true,
			comment: ''
		}
	],
	comment: '',
	indices: [{ id: 0, name: 'users_index_0', unique: false, fields: ['id'] } as any],
	uniqueConstraints: [],
	color: '#175e7a',
	collapsed: false,
	locked: false
};

const area: Area = {
	id: 2,
	name: 'area_2',
	x: -10,
	y: 20,
	width: 200,
	height: 150,
	color: '#175e7a',
	locked: false
};

const note: Note = {
	id: 0,
	x: 5,
	y: 6,
	title: 'note_0',
	content: 'hello',
	color: '#fcf7ac',
	height: 88,
	width: 180,
	locked: false
};

describe('parseClipboardElement', () => {
	test('round-trips a serialized table, area and note', () => {
		for (const el of [
			{ kind: 'table', data: table },
			{ kind: 'area', data: area },
			{ kind: 'note', data: note }
		] as ClipboardElement[]) {
			expect(parseClipboardElement(serializeClipboardElement(el))).toEqual(el);
		}
	});

	test('rejects non-JSON, empty and unrelated JSON', () => {
		expect(parseClipboardElement(null)).toBeNull();
		expect(parseClipboardElement('')).toBeNull();
		expect(parseClipboardElement('hello world')).toBeNull();
		expect(parseClipboardElement('[1,2,3]')).toBeNull();
		expect(parseClipboardElement(JSON.stringify({ foo: 'bar' }))).toBeNull();
	});

	test('rejects shapes that break the web schema (bad color, missing field keys)', () => {
		expect(parseClipboardElement(JSON.stringify({ ...table, color: 'blue' }))).toBeNull();
		const brokenField = { ...table, fields: [{ id: 'f1', name: 'id' }] };
		expect(parseClipboardElement(JSON.stringify(brokenField))).toBeNull();
		const { height: _h, ...noteWithoutHeight } = note;
		expect(parseClipboardElement(JSON.stringify(noteWithoutHeight))).toBeNull();
	});

	test('defaults desktop-only keys missing from web-copied JSON', () => {
		const { uniqueConstraints: _u, collapsed: _c, locked: _l, ...webTable } = table;
		const parsedTable = parseClipboardElement(JSON.stringify(webTable));
		expect(parsedTable?.kind).toBe('table');
		expect(parsedTable?.data).toEqual(table);

		const { width: _w, locked: _nl, ...webNote } = note;
		const parsedNote = parseClipboardElement(JSON.stringify(webNote));
		expect(parsedNote?.kind).toBe('note');
		expect((parsedNote?.data as Note).width).toBe(noteWidth);
		expect((parsedNote?.data as Note).locked).toBe(false);
	});
});

describe('prepareForPaste', () => {
	test('offsets a table by +20/+20 with the new id, leaving the original untouched', () => {
		const out = prepareForPaste({ kind: 'table', data: table }, { newTableId: 'tbl2', newIndex: 9 });
		expect(out.kind).toBe('table');
		expect(out.data.id).toBe('tbl2');
		expect(out.data.x).toBe(table.x + PASTE_OFFSET);
		expect(out.data.y).toBe(table.y + PASTE_OFFSET);
		expect((out.data as Table).fields).toEqual(table.fields);
		// Deep copy: no shared arrays with the source table.
		expect((out.data as Table).fields).not.toBe(table.fields);
		expect(table.id).toBe('tbl1');
		expect(table.x).toBe(100);
	});

	test('areas and notes take the next index as id', () => {
		const a = prepareForPaste({ kind: 'area', data: area }, { newTableId: 'unused', newIndex: 4 });
		expect(a).toEqual({ kind: 'area', data: { ...area, id: 4, x: -10 + PASTE_OFFSET, y: 20 + PASTE_OFFSET } });

		const n = prepareForPaste({ kind: 'note', data: note }, { newTableId: 'unused', newIndex: 1 });
		expect(n).toEqual({ kind: 'note', data: { ...note, id: 1, x: 5 + PASTE_OFFSET, y: 6 + PASTE_OFFSET } });
	});
});
