<script lang="ts">
	import { Keybind, setTheme } from '$lib/extensions';
	import * as M from 'monaco-editor';
	import lsp from '$lib/extensions/lsp.js';
	import { untrack } from 'svelte';
	import type { IMonacoSetting } from '$lib/Monaco.svelte';

	interface IMonacoInner {
		ref: HTMLElement | null;
		models: Record<string, Promise<M.editor.IModel | undefined>>;
		active: string;
		provider?: (id: string) => Promise<[string, string, string]>;
		model: M.editor.IModel | undefined;
		setting: IMonacoSetting;
		theme: string;
		message: HTMLElement | null;
		lspurl?: (language: string) => string;
		onchange?: (m: M.editor.IModel) => void;
		onload?: (m: M.editor.IStandaloneCodeEditor) => void;
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
	const ownedModels = new Map<string, M.editor.IModel>();

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
						const modelUri = M.Uri.parse(uri);
						const existingModel = M.editor.getModel(modelUri);
						if (existingModel) {
							M.editor.setModelLanguage(existingModel, lang);
							existingModel.setValue(code);
							return existingModel;
						}
						const nextModel = M.editor.createModel(code, lang, modelUri);
						ownedModels.set(key, nextModel);
						return nextModel;
					} catch (e) {
						console.warn('[Monaco] Failed to create model:', e);
					}
				});
			});
		}
		const modelPromise = models[key];
		if (!modelPromise) return;
		let cancelled = false;
		modelPromise.then((nextModel) => {
			if (cancelled || !nextModel) return;
			if (!ins || active !== key) return;
			model = nextModel;
		});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		return () => {
			for (const [key, ownedModel] of ownedModels) {
				if (!ownedModel.isDisposed()) ownedModel.dispose();
				if (models[key]) delete models[key];
			}
			ownedModels.clear();
		};
	});

	let _keybind: M.IDisposable | null | undefined = null;
	let _powermode: M.IDisposable | null | undefined = null;

	$effect(() => {
		_keybind =
			loaded && ins && message && setting.key
				? Keybind[setting.key]?.(ins, message)
				: null;
		return () => _keybind?.dispose?.();
	});

	$effect(() => {
		if (!loaded || !ins || !setting.power) {
			_powermode?.dispose?.();
			_powermode = null;
			return;
		}

		let cancelled = false;
		void import('$lib/extensions/power.js')
			.then(({ default: Power }) => {
				if (cancelled || !ins || !setting.power) return;
				const nextPower = new Power(ins);
				if (cancelled) {
					nextPower.dispose?.();
					return;
				}
				_powermode = nextPower;
			})
			.catch((e) => console.warn('[Monaco] Failed to load power mode:', e));

		return () => {
			cancelled = true;
			const power = _powermode;
			_powermode = null;
			power?.dispose?.();
		};
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
				const dispose = await lsp(language, url);
				if (cancelled) {
					dispose?.();
					return;
				}
				_lsp = dispose;
			} catch (e) {
				console.warn('[Monaco] LSP connection failed:', e);
			}
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
