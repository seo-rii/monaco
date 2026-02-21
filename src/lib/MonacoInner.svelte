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
		onerror?: (error: Error, context: string) => void;
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
		onload,
		onerror
	}: IMonacoInner = $props();

	let ins: M.editor.IStandaloneCodeEditor | undefined;
	let loaded = $state(false);
	const ownedModels = new Map<string, M.editor.IModel>();

	const normalizeError = (error: unknown): Error => {
		if (error instanceof Error) return error;
		if (typeof error === 'string') return new Error(error);
		try {
			return new Error(JSON.stringify(error));
		} catch {
			return new Error(String(error));
		}
	};

	const reportError = (error: unknown, context: string) => {
		const normalizedError = normalizeError(error);
		if (onerror) {
			try {
				onerror(normalizedError, context);
				return;
			} catch (handlerError) {
				console.warn('[Monaco] onerror callback failed:', normalizeError(handlerError));
			}
		}
		console.warn(`[Monaco] ${context}:`, normalizedError);
	};

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
						reportError(e, 'Failed to create model');
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
				delete models[key];
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
			.catch((e) => reportError(e, 'Failed to load power mode'));

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
				reportError(e, 'LSP connection failed');
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
			try {
				if (model) onchange?.(model);
			} catch (e) {
				reportError(e, 'onchange callback failed');
			}
		});

		loaded = true;
		try {
			onload?.(ins);
		} catch (e) {
			reportError(e, 'onload callback failed');
		}

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
