import * as M from 'monaco-editor';

const store: any = {};
let themeNo = 0;

export default async function setTheme(src: any) {
	const name = `--theme-${++themeNo}`;
	if (typeof src !== 'string') {
		store[name] = src;
	} else {
		const response = await fetch(src);
		if (!response.ok) {
			throw new Error(`Failed to fetch theme (${response.status}): ${src}`);
		}
		store[name] = await response.json();
	}
	M.editor.defineTheme(name, store[name]);
	M.editor.setTheme(name);
}
