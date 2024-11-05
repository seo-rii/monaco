import type Monaco from 'monaco-editor';
// @ts-ignore
import MonacoVim from 'monaco-vim';
import { EmacsExtension } from 'monaco-emacs';

const setKeybindings = {
	vim: (editor: Monaco.editor.IStandaloneCodeEditor, vimMessage: HTMLElement) => {
		if (!editor) return;
		return MonacoVim.initVimMode(editor, vimMessage);
	},
	emacs: (editor: Monaco.editor.IStandaloneCodeEditor, message: HTMLElement) => {
		if (!editor) return;
		const emacsInstance = new EmacsExtension(editor);
		emacsInstance.onDidMarkChange(
			(ev: boolean) => (message.textContent = ev ? 'Mark Set!' : 'Mark Unset')
		);
		emacsInstance.onDidChangeKey((str: string) => (message.textContent = str));
		emacsInstance.start();
		return emacsInstance;
	}
};

export default setKeybindings;
