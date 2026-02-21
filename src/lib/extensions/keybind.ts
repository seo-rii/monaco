import type Monaco from 'monaco-editor';

let emacsExtensionLoader: Promise<any> | undefined;

const resolveEmacsExtension = (mod: any) =>
	mod?.EmacsExtension || mod?.default?.EmacsExtension || mod?.default;

const loadEmacsExtension = async () => {
	const g = globalThis as any;
	if (g.MonacoEmacs?.EmacsExtension) return g.MonacoEmacs.EmacsExtension;

	if (!emacsExtensionLoader) {
		emacsExtensionLoader = (async () => {
			const [monaco, emacsModule] = await Promise.all([
				import('monaco-editor'),
				import('monaco-emacs')
			]);
			if (!g.monaco) g.monaco = monaco;
			return resolveEmacsExtension(emacsModule) || g.MonacoEmacs?.default;
		})().finally(() => {
			emacsExtensionLoader = undefined;
		});
	}

	return emacsExtensionLoader;
};

const setKeybindings = {
	vim: (editor: Monaco.editor.IStandaloneCodeEditor, vimMessage: HTMLElement): { dispose(): void } | undefined => {
		if (!editor) return;
		let disposed = false;
		let dispose: (() => void) | undefined;

		void import('monaco-vim')
			.then((mod: any) => {
				if (disposed) return;
				const vim = mod.default || mod;
				dispose = vim?.initVimMode?.(editor, vimMessage)?.dispose;
			})
			.catch((e) => console.warn('[Monaco] Failed to load vim mode:', e));

		return {
			dispose() {
				disposed = true;
				dispose?.();
			}
		};
	},
	emacs: (editor: Monaco.editor.IStandaloneCodeEditor, message: HTMLElement): { dispose(): void } | undefined => {
		if (!editor) return;
		let disposed = false;
		let emacsInstance: { dispose?: () => void } | undefined;

		void loadEmacsExtension()
			.then((Emacs: any) => {
				if (disposed) return;
				if (!Emacs) return;
				const next = new Emacs(editor);
				emacsInstance = next;
				next.onDidMarkChange?.(
					(ev: boolean) => (message.textContent = ev ? 'Mark Set!' : 'Mark Unset')
				);
				next.onDidChangeKey?.((str: string) => (message.textContent = str));
				next.start?.();
			})
			.catch((e) => console.warn('[Monaco] Failed to load emacs mode:', e));

		return {
			dispose() {
				disposed = true;
				emacsInstance?.dispose?.();
			}
		};
	}
};

export default setKeybindings;
