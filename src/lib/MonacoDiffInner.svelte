<script lang="ts">
	import { Keybind, setTheme } from '$lib/extensions';
	import * as M from 'monaco-editor';
	import lsp from '$lib/extensions/lsp.js';
	import { untrack } from 'svelte';
	import type {
		IMonacoSnippet,
		IMonacoSnippetLoader,
		IMonacoSnippetMap
	} from '$lib/Monaco.svelte';
	import type {
		IMonacoDiffCursorEvent,
		IMonacoDiffEditorSide,
		IMonacoDiffFocusEvent,
		IMonacoDiffInputEvent,
		IMonacoDiffProviderResult,
		IMonacoDiffSetting,
		IMonacoDiffSourcePair,
		IMonacoModelSource
	} from '$lib/MonacoDiff.svelte';

	const DEFAULT_MARKER_OWNER = 'seorii-monaco';
	const SIDES: IMonacoDiffEditorSide[] = ['original', 'modified'];

	interface IMonacoDiffInner {
		ref: HTMLElement | null;
		models: Record<string, Promise<M.editor.IDiffEditorModel | undefined>>;
		active: string;
		provider?: (id: string) => Promise<IMonacoDiffProviderResult>;
		model: M.editor.IDiffEditorModel | undefined;
		setting: IMonacoDiffSetting;
		readonly?: boolean;
		theme: string;
		message: HTMLElement | null;
		lspurl?: (language: string) => string;
		originalMarkers?: M.editor.IMarkerData[];
		modifiedMarkers?: M.editor.IMarkerData[];
		markerOwner?: string;
		snippets?: IMonacoSnippetMap;
		registerSnippets?: IMonacoSnippetLoader;
		onchange?: (model: M.editor.IDiffEditorModel) => void;
		oninput?: (event: IMonacoDiffInputEvent) => void;
		oncursor?: (event: IMonacoDiffCursorEvent) => void;
		onfocus?: (event: IMonacoDiffFocusEvent) => void;
		onblur?: (event: IMonacoDiffFocusEvent) => void;
		onupdate?: (lineChanges: M.editor.ILineChange[] | null) => void;
		onload?: (m: M.editor.IStandaloneDiffEditor) => void;
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
		originalMarkers,
		modifiedMarkers,
		markerOwner,
		snippets,
		registerSnippets,
		onchange,
		oninput,
		oncursor,
		onfocus,
		onblur,
		onupdate,
		onload,
		onerror
	}: IMonacoDiffInner = $props();

	let ins: M.editor.IStandaloneDiffEditor | undefined;
	let loaded = $state(false);
	const ownedModels = new Map<string, M.editor.IModel>();
	const ownedModelKeys = new Set<string>();

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
				console.warn('[MonacoDiff] onerror callback failed:', normalizeError(handlerError));
			}
		}
		console.warn(`[MonacoDiff] ${context}:`, normalizedError);
	};

	const sideEditorList = (): Array<[IMonacoDiffEditorSide, M.editor.IStandaloneCodeEditor]> => {
		if (!ins) return [];
		return [
			['original', ins.getOriginalEditor()],
			['modified', ins.getModifiedEditor()]
		];
	};

	const getSideModel = (side: IMonacoDiffEditorSide): M.editor.IModel | undefined => {
		const editorModel = sideEditorList()
			.find(([editorSide]) => editorSide === side)?.[1]
			?.getModel();
		return editorModel ?? model?.[side] ?? undefined;
	};

	const emitInput = (event: IMonacoDiffInputEvent) => {
		if (!oninput) return;
		try {
			oninput(event);
		} catch (e) {
			reportError(e, 'oninput callback failed');
		}
	};

	const emitCursor = (event: IMonacoDiffCursorEvent) => {
		if (!oncursor) return;
		try {
			oncursor(event);
		} catch (e) {
			reportError(e, 'oncursor callback failed');
		}
	};

	const emitFocus = (
		event: IMonacoDiffFocusEvent,
		callback: typeof onfocus | typeof onblur,
		context: string
	) => {
		if (!callback) return;
		try {
			callback(event);
		} catch (e) {
			reportError(e, context);
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

	const toSourcePair = (value: IMonacoDiffProviderResult): IMonacoDiffSourcePair => {
		if (Array.isArray(value)) {
			const [original, modified] = value;
			return { original, modified };
		}
		return value;
	};

	const getOrCreateModel = (
		source: IMonacoModelSource,
		ownedModelKey: string,
		activeKey: string
	) => {
		const [code, language, uri] = source;
		const modelUri = M.Uri.parse(uri);
		const existingModel = M.editor.getModel(modelUri);
		if (existingModel) {
			M.editor.setModelLanguage(existingModel, language);
			existingModel.setValue(code);
			return existingModel;
		}
		const nextModel = M.editor.createModel(code, language, modelUri);
		ownedModels.set(ownedModelKey, nextModel);
		ownedModelKeys.add(activeKey);
		return nextModel;
	};

	const applyMarkers = (
		targetModel: M.editor.IModel | undefined,
		markers: M.editor.IMarkerData[] | undefined
	) => {
		if (!targetModel) return;
		const owner = markerOwner ?? DEFAULT_MARKER_OWNER;
		M.editor.setModelMarkers(targetModel, owner, markers ?? []);
		return () => {
			if (!targetModel.isDisposed()) M.editor.setModelMarkers(targetModel, owner, []);
		};
	};

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
		if (!loaded || !ins) return;
		ins.setModel(model ?? null);
	});

	$effect(() => {
		if (!loaded || !provider || !ins) return;
		const key = active;
		if (!models[key]) {
			untrack(() => {
				models[key] = provider(key).then((result) => {
					try {
						const { original, modified } = toSourcePair(result);
						return {
							original: getOrCreateModel(original, `${key}:original`, key),
							modified: getOrCreateModel(modified, `${key}:modified`, key)
						};
					} catch (e) {
						reportError(e, 'Failed to create diff model');
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
			for (const ownedModel of ownedModels.values()) {
				if (!ownedModel.isDisposed()) ownedModel.dispose();
			}
			for (const key of ownedModelKeys) {
				delete models[key];
			}
			ownedModels.clear();
			ownedModelKeys.clear();
		};
	});

	$effect(() => {
		if (!loaded || !ins || (!onchange && !oninput)) return;
		const disposables = sideEditorList().map(([side, editor]) =>
			editor.onDidChangeModelContent((event) => {
				const currentModel = editor.getModel();
				const currentDiffModel = ins?.getModel() ?? model;
				if (!currentModel || !currentDiffModel) return;
				if (onchange) {
					try {
						onchange(currentDiffModel);
					} catch (e) {
						reportError(e, 'onchange callback failed');
					}
				}
				emitInput({
					side,
					model: currentModel,
					value: currentModel.getValue(),
					reason: 'change',
					event
				});
			})
		);
		return () => {
			for (const disposable of disposables) disposable.dispose();
		};
	});

	$effect(() => {
		if (!loaded || !ins || !oninput) return;
		const disposables = sideEditorList().map(([side, editor]) =>
			editor.onDidAttemptReadOnlyEdit(() => {
				const currentModel = editor.getModel();
				if (!currentModel) return;
				emitInput({
					side,
					model: currentModel,
					value: currentModel.getValue(),
					reason: 'readonly-attempt'
				});
			})
		);
		return () => {
			for (const disposable of disposables) disposable.dispose();
		};
	});

	$effect(() => {
		if (!loaded || !ins || !oncursor) return;
		const disposables = sideEditorList().map(([side, editor]) =>
			editor.onDidChangeCursorPosition((event) => {
				const currentModel = editor.getModel();
				if (!currentModel) return;
				emitCursor({
					side,
					model: currentModel,
					position: event.position
				});
			})
		);
		return () => {
			for (const disposable of disposables) disposable.dispose();
		};
	});

	$effect(() => {
		if (!loaded || !ins || !onfocus) return;
		const disposables = sideEditorList().map(([side, editor]) =>
			editor.onDidFocusEditorText(() => {
				const currentModel = editor.getModel();
				if (!currentModel) return;
				emitFocus({ side, model: currentModel }, onfocus, 'onfocus callback failed');
			})
		);
		return () => {
			for (const disposable of disposables) disposable.dispose();
		};
	});

	$effect(() => {
		if (!loaded || !ins || !onblur) return;
		const disposables = sideEditorList().map(([side, editor]) =>
			editor.onDidBlurEditorText(() => {
				const currentModel = editor.getModel();
				if (!currentModel) return;
				emitFocus({ side, model: currentModel }, onblur, 'onblur callback failed');
			})
		);
		return () => {
			for (const disposable of disposables) disposable.dispose();
		};
	});

	$effect(() => {
		if (!loaded || !ins || !onupdate) return;
		const disposable = ins.onDidUpdateDiff(() => {
			try {
				onupdate(ins?.getLineChanges() ?? null);
			} catch (e) {
				reportError(e, 'onupdate callback failed');
			}
		});
		return () => disposable.dispose();
	});

	$effect(() => {
		const currentModel = getSideModel('original');
		return applyMarkers(currentModel, originalMarkers);
	});

	$effect(() => {
		const currentModel = getSideModel('modified');
		return applyMarkers(currentModel, modifiedMarkers);
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

	let _keybind: M.IDisposable | null | undefined = null;
	let _powermode: M.IDisposable | null | undefined = null;

	$effect(() => {
		const modifiedEditor = loaded ? ins?.getModifiedEditor() : undefined;
		_keybind =
			modifiedEditor && message && setting.key
				? Keybind[setting.key]?.(modifiedEditor, message)
				: null;
		return () => _keybind?.dispose?.();
	});

	$effect(() => {
		const modifiedEditor = loaded ? ins?.getModifiedEditor() : undefined;
		if (!modifiedEditor || !setting.power) {
			_powermode?.dispose?.();
			_powermode = null;
			return;
		}

		let cancelled = false;
		void import('$lib/extensions/power.js')
			.then(({ default: Power }) => {
				if (cancelled || !setting.power) return;
				const nextPower = new Power(modifiedEditor);
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
		if (!loaded || !model?.modified) return;
		const language = model.modified.getLanguageId();
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
		ins = M.editor.createDiffEditor(ref, {
			automaticLayout: true,
			renderSideBySide: true
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
