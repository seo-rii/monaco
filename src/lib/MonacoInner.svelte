<script lang="ts">
	import { Keybind, Power, setTheme } from '$lib/extensions';
	import * as M from 'monaco-editor';
	import lsp from '$lib/extensions/lsp.js';
	import { untrack } from 'svelte';

	interface IMonacoInner {
		ref: HTMLElement | null;
		models: Record<string, Promise<M.editor.IModel | undefined>>;
		active: string;
		provider?: (
			id: string,
			uri?: (path: string | { reader: any; writer: any }) => string
		) => Promise<[string, string, string]>;
		model: M.editor.IModel | undefined;
		setting: M.editor.IEditorConstructionOptions & any;
		theme: string;
		message: HTMLElement | null;
		lspurl?: (language: string) => string;
		onchange?: (m: M.editor.IModel) => any;
		onload?: (m: M.editor.IStandaloneCodeEditor) => any;
	}

	let {
		ref = $bindable(),
		models = $bindable(),
		active = $bindable(),
		model = $bindable(),
		message = $bindable(),
		provider,
		setting,
		theme,
		lspurl,
		onchange,
		onload
	}: IMonacoInner = $props();

	let ins: M.editor.IStandaloneCodeEditor | undefined;
	let loaded = $state(false);

	$effect(() => {
		if (loaded) ins?.updateOptions(setting);
	});

	$effect(() => {
		if (loaded && theme) setTheme(theme);
	});

	$effect(() => {
		if (loaded && ins && model) ins.setModel(model);
	});

	$effect(() => {
		if (!loaded || !provider || !ins) return;
		const key = active;
		if (!models[key]) {
			untrack(() => {
				models[key] = provider(key).then((r) => {
					try {
						const [code, lang, uri] = r;
						const model = M.editor.createModel(code, lang, M.Uri.parse(uri));
						M.editor.setModelLanguage(model, lang);
						return model;
					} catch (e) {}
				});
			});
		}
		const modelPromise = models[key];
		if (!modelPromise) return;
		let cancelled = false;
		modelPromise.then((nextModel) => {
			if (cancelled || !nextModel) return;
			if (!ins || active !== key) return;
			model = nextModel as any;
		});
		return () => {
			cancelled = true;
		};
	});

	let _keybind: any, _powermode: any;

	$effect(() => {
		_keybind =
			loaded && ins && model && message && setting.key
				? Keybind[setting.key as keyof typeof Keybind]?.(ins, message)
				: null;
		return () => _keybind?.dispose?.();
	});

	$effect(() => {
		_powermode = loaded && ins && model && setting.power ? new Power(ins) : null;
		return () => _powermode?.dispose?.();
	});

	let _lsp: (() => void) | undefined;

	$effect(() => {
		if (!loaded || !model) return;
		const language = model.getLanguageId();
		let cancelled = false;
		(async () => {
			try {
				const url = lspurl && (await lspurl(language));
				if (!url || cancelled) return;
				const dispose = await lsp(language as any, url);
				if (cancelled) {
					dispose?.();
					return;
				}
				_lsp = dispose;
			} catch {}
		})();
		return () => {
			cancelled = true;
			const dispose = untrack(() => _lsp);
			_lsp = undefined;
			dispose?.();
		};
	});

	$effect(() => {
		if (!ref) return;
		ins = M.editor.create(ref, {
			value: ' ',
			language: 'plaintext',
			automaticLayout: true,
			minimap: {
				enabled: false
			}
		});
		ins.onDidChangeModelContent(() => {
			if (model) onchange?.(model);
		});

		loaded = true;
		onload?.(ins);

		return () => {
			loaded = false;
			ins?.dispose?.();
			ins = undefined;
		};
	});
</script>

<main bind:this={ref}></main>

<style>
	main {
		width: 100%;
		height: 100%;
	}
</style>
