// Type declarations for Bun's built-in test runner (`bun test`).
// Deliberately minimal: only the test-runner surface this project uses, so
// `svelte-check` can type-check the tests without pulling in Bun's full typings.
declare module 'bun:test' {
	export function describe(name: string, fn: () => void): void;
	export function test(name: string, fn: () => void | Promise<void>): void;
	export const it: typeof test;
	export function expect(actual?: unknown): any;
}
