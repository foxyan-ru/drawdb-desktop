import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	clearScreen: false,
	build: {
		// node-sql-parser's per-dialect build/*.js files are single-line,
		// jison-generated parser tables with extremely deep call nesting.
		// Rollup's tree-shake pass (includeCallArgumentsWhenCalledAtPath)
		// recurses into every call expression and overflows the stack on
		// them ("Maximum call stack size exceeded") even though they're
		// only reached via dynamic import() (src/lib/utils/importSQL/parse.ts).
		// Disabling tree-shaking avoids that recursion; these parsers are
		// lazy-loaded anyway so the bundle-size cost is paid only on use.
		rollupOptions: {
			treeshake: false
		}
	},
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: 'ws',
					host,
					port: 1421
				}
			: undefined,
		watch: {
			ignored: ['**/src-tauri/**']
		}
	}
});
