import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			vscode: '@hancomac/monaco-languageclient/vscode-compatibility'
		}
	},
	optimizeDeps: {
		include: [
			`monaco-editor/esm/vs/language/json/json.worker`,
			`monaco-editor/esm/vs/language/css/css.worker`,
			`monaco-editor/esm/vs/language/html/html.worker`,
			`monaco-editor/esm/vs/language/typescript/ts.worker`,
			`monaco-editor/esm/vs/editor/editor.worker`
		]
	},

	server: {
		allowedHosts: true
	}
});
