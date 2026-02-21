<script lang="ts">
	import { Keybind, setTheme } from '$lib/extensions';
	import {
		createOwnedTextModelRegistry,
		createErrorReporter,
		createSnippetRegistry,
		setModelMarkers,
		toDiffSourcePair
	} from '$lib/MonacoBase.js';
	import * as M from 'monaco-editor';
	import lsp from '$lib/extensions/lsp.js';
	import { untrack } from 'svelte';
	import type {
		IMonacoDiffProviderResult,
		IMonacoSnippetLoader,
		IMonacoSnippetMap
	} from '$lib/MonacoTypes.js';
	import type {
		IMonacoDiffCursorEvent,
		IMonacoDiffEditorSide,
		IMonacoDiffFocusEvent,
		IMonacoDiffInputEvent,
		IMonacoDiffSetting
	} from '$lib/MonacoDiff.svelte';

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
	const ownedModelRegistry = createOwnedTextModelRegistry();
	const reportError = createErrorReporter('MonacoDiff', () => onerror);

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
						const { original, modified } = toDiffSourcePair(result);
						return {
							original: ownedModelRegistry.resolve(original, `${key}:original`, key),
							modified: ownedModelRegistry.resolve(modified, `${key}:modified`, key)
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
		return () => ownedModelRegistry.dispose(models);
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
		return setModelMarkers(currentModel, originalMarkers, markerOwner);
	});

	$effect(() => {
		const currentModel = getSideModel('modified');
		return setModelMarkers(currentModel, modifiedMarkers, markerOwner);
	});

	$effect(() =>
		createSnippetRegistry({
			snippets,
			registerSnippets,
			reportError
		})
	);

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
