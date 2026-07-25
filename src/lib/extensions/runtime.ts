import type * as M from 'monaco-editor';

export type IMonacoEditorKind = 'code' | 'diff';
export type IMonacoEditorSide = 'main' | 'original' | 'modified';
export type IMonacoExtensionCleanup = void | M.IDisposable | (() => void);
export type IMonacoExtensionResult =
	| IMonacoExtensionCleanup
	| Promise<IMonacoExtensionCleanup>;

export interface IMonacoExtensionContext {
	monaco: typeof M;
	kind: IMonacoEditorKind;
	host: M.editor.IStandaloneCodeEditor | M.editor.IStandaloneDiffEditor;
	editors: ReadonlyMap<IMonacoEditorSide, M.editor.IStandaloneCodeEditor>;
	signal: AbortSignal;
	reportError(error: unknown, context: string): void;
}

export interface IMonacoModelExtensionContext extends IMonacoExtensionContext {
	side: IMonacoEditorSide;
	editor: M.editor.IStandaloneCodeEditor;
	model: M.editor.ITextModel;
	active: string;
}

export interface IMonacoExtension {
	readonly id: string;
	readonly enabled?: boolean;
	activate?(context: IMonacoExtensionContext): IMonacoExtensionResult;
	attachModel?(context: IMonacoModelExtensionContext): IMonacoExtensionResult;
}

export type IMonacoExtensions = readonly (IMonacoExtension | false | null | undefined)[];

const disposeResult = (cleanup: IMonacoExtensionCleanup) => {
	if (typeof cleanup === 'function') cleanup();
	else cleanup?.dispose();
};

interface ActiveHook {
	controller: AbortController;
	cleanup?: IMonacoExtensionCleanup;
}

interface ActiveExtension {
	extension: IMonacoExtension;
	activation: ActiveHook;
	models: Map<IMonacoEditorSide, ActiveHook>;
}

export interface IMonacoExtensionHostOptions {
	monaco: typeof M;
	kind: IMonacoEditorKind;
	host: M.editor.IStandaloneCodeEditor | M.editor.IStandaloneDiffEditor;
	editors: ReadonlyMap<IMonacoEditorSide, M.editor.IStandaloneCodeEditor>;
	getActive: () => string;
	reportError(error: unknown, context: string): void;
}

export interface IMonacoExtensionHost extends M.IDisposable {
	setExtensions(extensions: IMonacoExtensions): void;
	refreshModels(): void;
}

export function createMonacoExtensionHost(
	options: IMonacoExtensionHostOptions
): IMonacoExtensionHost {
	const activeExtensions: ActiveExtension[] = [];
	const editorDisposables: M.IDisposable[] = [];
	let disposed = false;

	const createContext = (signal: AbortSignal): IMonacoExtensionContext => ({
		monaco: options.monaco,
		kind: options.kind,
		host: options.host,
		editors: options.editors,
		signal,
		reportError: options.reportError
	});

	const startHook = (
		hook: ActiveHook,
		result: () => IMonacoExtensionResult,
		errorContext: string
	) => {
		void Promise.resolve()
			.then(result)
			.then((cleanup) => {
				if (hook.controller.signal.aborted) {
					disposeResult(cleanup);
					return;
				}
				hook.cleanup = cleanup;
			})
			.catch((error) => {
				if (!hook.controller.signal.aborted) options.reportError(error, errorContext);
			});
	};

	const stopHook = (hook: ActiveHook | undefined) => {
		if (!hook) return;
		hook.controller.abort();
		try {
			disposeResult(hook.cleanup);
		} catch (error) {
			options.reportError(error, 'Extension cleanup failed');
		}
		hook.cleanup = undefined;
	};

	const attachModel = (active: ActiveExtension, side: IMonacoEditorSide) => {
		stopHook(active.models.get(side));
		active.models.delete(side);
		const attach = active.extension.attachModel;
		const editor = options.editors.get(side);
		const model = editor?.getModel();
		if (!attach || !editor || !model || model.isDisposed()) return;
		const hook: ActiveHook = { controller: new AbortController() };
		active.models.set(side, hook);
		startHook(
			hook,
			() =>
				attach({
					...createContext(hook.controller.signal),
					side,
					editor,
					model,
					active: options.getActive()
				}),
			`Extension "${active.extension.id}" failed to attach model`
		);
	};

	const stopExtension = (active: ActiveExtension) => {
		const modelHooks = [...active.models.values()].reverse();
		active.models.clear();
		for (const hook of modelHooks) stopHook(hook);
		stopHook(active.activation);
	};

	const clearExtensions = () => {
		for (const active of activeExtensions.splice(0).reverse()) stopExtension(active);
	};

	for (const [side, editor] of options.editors) {
		editorDisposables.push(
			editor.onDidChangeModel(() => {
				if (disposed) return;
				for (const active of activeExtensions) attachModel(active, side);
			})
		);
	}

	return {
		setExtensions(extensions) {
			if (disposed) return;
			clearExtensions();
			const ids = new Set<string>();
			for (const extension of extensions) {
				if (!extension || extension.enabled === false) continue;
				if (ids.has(extension.id)) {
					options.reportError(
						new Error(`Duplicate Monaco extension id: ${extension.id}`),
						'Extension registration failed'
					);
					continue;
				}
				ids.add(extension.id);
				const activation: ActiveHook = { controller: new AbortController() };
				const active: ActiveExtension = {
					extension,
					activation,
					models: new Map()
				};
				activeExtensions.push(active);
				if (extension.activate) {
					startHook(
						activation,
						() => extension.activate!(createContext(activation.controller.signal)),
						`Extension "${extension.id}" failed to activate`
					);
				}
				for (const side of options.editors.keys()) attachModel(active, side);
			}
		},
		refreshModels() {
			if (disposed) return;
			for (const active of activeExtensions) {
				for (const side of options.editors.keys()) attachModel(active, side);
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			clearExtensions();
			for (const disposable of editorDisposables.splice(0).reverse()) disposable.dispose();
		}
	};
}

export interface IMonacoRuntime extends M.IDisposable {
	readonly extensions: IMonacoExtensions;
	use(extension: IMonacoExtension): M.IDisposable;
	onDidChange(listener: () => void): M.IDisposable;
}

export function createMonacoRuntime(
	initialExtensions: IMonacoExtensions = []
): IMonacoRuntime {
	const extensions = new Map<string, IMonacoExtension>();
	const listeners = new Set<() => void>();
	let disposed = false;

	const emit = () => {
		for (const listener of listeners) listener();
	};

	const use = (extension: IMonacoExtension) => {
		if (disposed) throw new Error('Monaco runtime is disposed');
		if (extensions.has(extension.id)) {
			throw new Error(`Duplicate Monaco extension id: ${extension.id}`);
		}
		extensions.set(extension.id, extension);
		emit();
		let active = true;
		return {
			dispose() {
				if (!active) return;
				active = false;
				if (extensions.get(extension.id) === extension) {
					extensions.delete(extension.id);
					emit();
				}
			}
		};
	};

	for (const extension of initialExtensions) {
		if (extension) use(extension);
	}

	return {
		get extensions() {
			return [...extensions.values()];
		},
		use,
		onDidChange(listener) {
			if (disposed) return { dispose() {} };
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			extensions.clear();
			emit();
			listeners.clear();
		}
	};
}

let defaultRuntime: IMonacoRuntime | undefined;

export function getMonacoRuntime(): IMonacoRuntime {
	defaultRuntime ??= createMonacoRuntime();
	return defaultRuntime;
}
