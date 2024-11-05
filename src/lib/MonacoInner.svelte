<script lang="ts">
	import { Keybind, Power, setTheme } from '$lib/extensions';
	import * as M from 'monaco-editor';
	import lsp from '$lib/extensions/lsp.js';
	import { untrack } from 'svelte';

	interface IMonacoInner {
		ref: HTMLElement | null;
		ins: M.editor.IStandaloneCodeEditor;
		models: Record<string, Promise<M.editor.IModel | undefined>>;
		active: string;
		provider?: (
			id: string,
			uri?: (path: string) => string
		) => Promise<[string, string, string]>;
		model: M.editor.IModel | undefined;
		setting: M.editor.IEditorConstructionOptions & any;
		theme: string;
		message: HTMLElement | null;
		lspurl?: (language: string) => string;
		onchange?: (m: M.editor.IModel) => any;
	}

	let {
		ref = $bindable(),
		ins = $bindable(),
		models = $bindable(),
		active = $bindable(),
		model = $bindable(),
		message = $bindable(),
		provider,
		setting,
		theme,
		lspurl,
		onchange
	}: IMonacoInner = $props();

	$effect(() => ins?.updateOptions(setting));

	$effect(() => {
		if (ins && theme) setTheme(theme);
	});

	$effect(() => {
		if (ins && model) ins.setModel(model);
	});

	$effect(() => {
		if (ins && provider) {
			if (!models[active])
				models[active] = provider(active).then((r) => {
					try {
						const [code, lang, uri] = r;
						const model = M.editor.createModel(code, lang, M.Uri.parse(uri));
						M.editor.setModelLanguage(model, lang);
						return model;
					} catch (e) {}
				});
			models[active].then((r) => ins.setModel((model = r as any)));
		}
	});

	let _keybind = $state<any>(),
		_powermode = $state<any>();

	$effect(() => {
		_keybind =
			ins && model && message && setting.key
				? Keybind[setting.key as keyof typeof Keybind]?.(ins, message)
				: null;
		return () => _keybind?.dispose?.();
	});

	$effect(() => {
		_powermode = ins && model && setting.power ? new Power(ins) : null;
		return () => _powermode?.dispose?.();
	});

	let _lsp = $state<any>();

	$effect(() => {
		if (model) {
			untrack(() => _lsp)?.();
			const language = model.getLanguageId();
			(async () => {
				const url = lspurl && (await lspurl(language));
				if (url) _lsp = await lsp(language as any, url);
			})();
		}
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
		return () => {
			ins?.dispose?.();
			ins = null as any;
		};
	});
</script>

<main bind:this={ref}></main>

<style lang="scss">
	main {
		width: 100%;
		height: 100%;
	}
</style>
