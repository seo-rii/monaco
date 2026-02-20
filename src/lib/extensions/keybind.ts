import type Monaco from 'monaco-editor';

let emacsExtensionLoader: Promise<any> | undefined;

const loadEmacsExtension = async () => {
	const g = globalThis as any;
	if (g.MonacoEmacs?.EmacsExtension) return g.MonacoEmacs.EmacsExtension;

	if (!emacsExtensionLoader) {
		emacsExtensionLoader = (async () => {
			const [monaco, { default: emacsUrl }] = await Promise.all([
				import('monaco-editor'),
				import('monaco-emacs/dist/monaco-emacs.js?url')
			]);
			if (!g.monaco) g.monaco = monaco;
			if (!g.MonacoEmacs) {
				if (typeof document === 'undefined') return undefined;
				await new Promise<void>((resolve, reject) => {
					const script = document.createElement('script');
					script.src = emacsUrl;
					script.async = true;
					script.dataset.seoriiMonacoEmacs = 'true';
					script.onload = () => resolve();
					script.onerror = () => reject(new Error('Failed to load monaco-emacs bundle'));
					document.head.append(script);
				});
			}
			return g.MonacoEmacs?.EmacsExtension || g.MonacoEmacs?.default;
		})().finally(() => {
			emacsExtensionLoader = undefined;
		});
	}

	return emacsExtensionLoader;
};

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
