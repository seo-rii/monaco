<script lang="ts">
	import { Keybind, setTheme } from '$lib/extensions';
	import * as M from 'monaco-editor';
	import lsp from '$lib/extensions/lsp.js';
	import { untrack } from 'svelte';
	import type {
		IMonacoInputEvent,
		IMonacoSetting,
		IMonacoSnippet,
		IMonacoSnippetLoader,
		IMonacoSnippetMap
	} from '$lib/Monaco.svelte';

	const DEFAULT_MARKER_OWNER = 'seorii-monaco';

	interface IMonacoInner {
		ref: HTMLElement | null;
		models: Record<string, Promise<M.editor.IModel | undefined>>;
		active: string;
		provider?: (id: string) => Promise<[string, string, string]>;
		model: M.editor.IModel | undefined;
		setting: IMonacoSetting;
		readonly?: boolean;
		theme: string;
		message: HTMLElement | null;
		lspurl?: (language: string) => string;
		markers?: M.editor.IMarkerData[];
		markerOwner?: string;
		snippets?: IMonacoSnippetMap;
		registerSnippets?: IMonacoSnippetLoader;
		onchange?: (m: M.editor.IModel) => void;
		oninput?: (event: IMonacoInputEvent) => void;
		oncursor?: (position: M.Position) => void;
		onfocus?: () => void;
		onblur?: () => void;
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
		readonly: readonlyProp,
		theme,
		lspurl,
		markers,
		markerOwner,
		snippets,
		registerSnippets,
		onchange,
		oninput,
		oncursor,
		onfocus,
		onblur,
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

	const getActiveModel = (): M.editor.IModel | undefined => {
		const currentModel = ins?.getModel() ?? model;
		return currentModel ?? undefined;
	};

	const emitInput = (event: IMonacoInputEvent) => {
		if (!oninput) return;
		try {
			oninput(event);
		} catch (e) {
			reportError(e, 'oninput callback failed');
		}
	};

	const toSnippetProvider = (
		snippetList: IMonacoSnippet[]
	): M.languages.CompletionItemProvider => ({
		provideCompletionItems(currentModel, position) {
			const word = currentModel.getWordUntilPosition(position);
			const range = {
				startLineNumber: position.lineNumber,
				endLineNumber: position.lineNumber,
				startColumn: word.startColumn,
				endColumn: word.endColumn
			};
			return {
				suggestions: snippetList.map((snippet) => ({
					label: snippet.label,
					kind: snippet.kind ?? M.languages.CompletionItemKind.Snippet,
					insertText: snippet.insertText,
					insertTextRules:
						snippet.insertTextRules ??
						M.languages.CompletionItemInsertTextRule.InsertAsSnippet,
					detail: snippet.detail,
					documentation: snippet.documentation,
					sortText: snippet.sortText,
					filterText: snippet.filterText,
					range
				}))
			};
		}
	});

	$effect(() => {
		if (!loaded || !ins) return;
		const readOnly = readonlyProp ?? setting.readOnly;
		ins.updateOptions({
			...setting,
			readOnly
		});
	});

	$effect(() => {
		if (loaded && theme) setTheme(theme);
	});

	$effect(() => {
		if (loaded && ins && model) ins.setModel(model);
	});

	$effect(() => {
		if (!loaded || !ins || (!onchange && !oninput)) return;
		const disposable = ins.onDidChangeModelContent((event) => {
			const currentModel = getActiveModel();
			if (!currentModel) return;
			if (onchange) {
				try {
					onchange(currentModel);
				} catch (e) {
					reportError(e, 'onchange callback failed');
				}
			}
			emitInput({
				model: currentModel,
				value: currentModel.getValue(),
				reason: 'change',
				event
			});
		});
		return () => disposable.dispose();
	});

	$effect(() => {
		if (!loaded || !ins || !oninput) return;
		const disposable = ins.onDidAttemptReadOnlyEdit(() => {
			const currentModel = getActiveModel();
			if (!currentModel) return;
			emitInput({
				model: currentModel,
				value: currentModel.getValue(),
				reason: 'readonly-attempt'
			});
		});
		return () => disposable.dispose();
	});

	$effect(() => {
		if (!loaded || !ins || !oncursor) return;
		const disposable = ins.onDidChangeCursorPosition((event) => {
			try {
				oncursor(event.position);
			} catch (e) {
				reportError(e, 'oncursor callback failed');
			}
		});
		return () => disposable.dispose();
	});

	$effect(() => {
		if (!loaded || !ins || !onfocus) return;
		const disposable = ins.onDidFocusEditorText(() => {
			try {
				onfocus();
			} catch (e) {
				reportError(e, 'onfocus callback failed');
			}
		});
		return () => disposable.dispose();
	});

	$effect(() => {
		if (!loaded || !ins || !onblur) return;
		const disposable = ins.onDidBlurEditorText(() => {
			try {
				onblur();
			} catch (e) {
				reportError(e, 'onblur callback failed');
			}
		});
		return () => disposable.dispose();
	});

	$effect(() => {
		const currentModel = model;
		if (!currentModel) return;
		const owner = markerOwner ?? DEFAULT_MARKER_OWNER;
		M.editor.setModelMarkers(currentModel, owner, markers ?? []);
		return () => {
			if (!currentModel.isDisposed()) M.editor.setModelMarkers(currentModel, owner, []);
		};
	});

	$effect(() => {
		if (!snippets && !registerSnippets) return;
		const snippetDisposables = new Map<string, M.IDisposable>();
		let disposed = false;
		const register = (language: string, snippetList: IMonacoSnippet[]) => {
			if (disposed) return;
			snippetDisposables.get(language)?.dispose();
			snippetDisposables.delete(language);
			if (!snippetList.length) return;
			const disposable = M.languages.registerCompletionItemProvider(
				language,
				toSnippetProvider(snippetList)
			);
			snippetDisposables.set(language, disposable);
		};

		if (snippets) {
			for (const [language, snippetList] of Object.entries(snippets)) {
				register(language, snippetList);
			}
		}

		let cleanup: (() => void) | undefined;
		if (registerSnippets) {
			try {
				const result = registerSnippets(register);
				if (typeof result === 'function') {
					cleanup = result;
				} else if (result && typeof result.dispose === 'function') {
					cleanup = () => result.dispose();
				}
			} catch (e) {
				reportError(e, 'registerSnippets callback failed');
			}
		}

		return () => {
			disposed = true;
			cleanup?.();
			for (const disposable of snippetDisposables.values()) {
				disposable.dispose();
			}
			snippetDisposables.clear();
		};
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
			loaded && ins && message && setting.key ? Keybind[setting.key]?.(ins, message) : null;
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
