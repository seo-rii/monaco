import type Monaco from 'monaco-editor';

const setKeybindings = {
	vim: (editor: Monaco.editor.IStandaloneCodeEditor, vimMessage: HTMLElement) => {
		if (!editor) return;
		let disposed = false;
		let dispose: (() => void) | undefined;

		void import('monaco-vim')
			.then((mod: any) => {
				if (disposed) return;
				const vim = mod.default || mod;
				dispose = vim?.initVimMode?.(editor, vimMessage)?.dispose;
			})
			.catch(() => {});

		return {
			dispose() {
				disposed = true;
				dispose?.();
			}
		};
	},
	emacs: (editor: Monaco.editor.IStandaloneCodeEditor, message: HTMLElement) => {
		if (!editor) return;
		let disposed = false;
		let emacsInstance: { dispose?: () => void } | undefined;

		// Import the ESM source path to avoid monaco-emacs CJS -> monaco-editor(require) AMD path.
		void import('monaco-emacs/src/emacs/index')
			.then((mod: any) => {
				if (disposed) return;
				const Emacs = mod.EmacsExtension || mod.default;
				if (!Emacs) return;
				const next = new Emacs(editor);
				emacsInstance = next;
				next.onDidMarkChange?.((ev: boolean) => (message.textContent = ev ? 'Mark Set!' : 'Mark Unset'));
				next.onDidChangeKey?.((str: string) => (message.textContent = str));
				next.start?.();
			})
			.catch(() => {});

		return {
			dispose() {
				disposed = true;
				emacsInstance?.dispose?.();
			}
		};
	}
};

export default setKeybindings;
