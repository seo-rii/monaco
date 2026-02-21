import * as M from 'monaco-editor';
import type {
	IMonacoDiffProviderResult,
	IMonacoDiffSourcePair,
	IMonacoModelSource,
	IMonacoSnippet,
	IMonacoSnippetLoader,
	IMonacoSnippetMap,
	IMonacoSnippetRegister
} from '$lib/MonacoTypes.js';

export type MonacoOnError = (error: Error, context: string) => void;
export type MonacoErrorReporter = (error: unknown, context: string) => void;

export const normalizeError = (error: unknown): Error => {
	if (error instanceof Error) return error;
	if (typeof error === 'string') return new Error(error);
	try {
		return new Error(JSON.stringify(error));
	} catch {
		return new Error(String(error));
	}
};

export const createErrorReporter = (
	scope: string,
	getHandler: () => MonacoOnError | undefined
): MonacoErrorReporter => {
	return (error: unknown, context: string) => {
		const normalizedError = normalizeError(error);
		const onerror = getHandler();
		if (onerror) {
			try {
				onerror(normalizedError, context);
				return;
			} catch (handlerError) {
				console.warn(`[${scope}] onerror callback failed:`, normalizeError(handlerError));
			}
		}
		console.warn(`[${scope}] ${context}:`, normalizedError);
	};
};

export const getOrCreateTextModel = (
	source: IMonacoModelSource
): { model: M.editor.IModel; created: boolean } => {
	const [code, language, uri] = source;
	const modelUri = M.Uri.parse(uri);
	const existingModel = M.editor.getModel(modelUri);
	if (existingModel) {
		M.editor.setModelLanguage(existingModel, language);
		existingModel.setValue(code);
		return { model: existingModel, created: false };
	}
	return {
		model: M.editor.createModel(code, language, modelUri),
		created: true
	};
};

export const toDiffSourcePair = (value: IMonacoDiffProviderResult): IMonacoDiffSourcePair => {
	if (Array.isArray(value)) {
		const [original, modified] = value;
		return { original, modified };
	}
	return value;
};

export interface IMonacoOwnedTextModelRegistry {
	resolve(source: IMonacoModelSource, ownedModelKey: string, activeKey: string): M.editor.IModel;
	dispose(models: Record<string, unknown>): void;
}

export const createOwnedTextModelRegistry = (): IMonacoOwnedTextModelRegistry => {
	const ownedModels = new Map<string, M.editor.IModel>();
	const ownedModelKeys = new Set<string>();

	return {
		resolve(source, ownedModelKey, activeKey) {
			const resolvedModel = getOrCreateTextModel(source);
			if (resolvedModel.created) {
				ownedModels.set(ownedModelKey, resolvedModel.model);
				ownedModelKeys.add(activeKey);
			}
			return resolvedModel.model;
		},
		dispose(models) {
			for (const ownedModel of ownedModels.values()) {
				if (!ownedModel.isDisposed()) ownedModel.dispose();
			}
			for (const key of ownedModelKeys) {
				delete models[key];
			}
			ownedModels.clear();
			ownedModelKeys.clear();
		}
	};
};

export const setModelMarkers = (
	targetModel: M.editor.IModel | undefined,
	markers: M.editor.IMarkerData[] | undefined,
	markerOwner: string = 'seorii-monaco'
) => {
	if (!targetModel) return;
	M.editor.setModelMarkers(targetModel, markerOwner, markers ?? []);
	return () => {
		if (!targetModel.isDisposed()) M.editor.setModelMarkers(targetModel, markerOwner, []);
	};
};

const createSnippetProvider = (
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

interface ISnippetRegistryOptions {
	snippets?: IMonacoSnippetMap;
	registerSnippets?: IMonacoSnippetLoader;
	reportError: MonacoErrorReporter;
}

export const createSnippetRegistry = ({
	snippets,
	registerSnippets,
	reportError
}: ISnippetRegistryOptions) => {
	if (!snippets && !registerSnippets) return;
	const snippetDisposables = new Map<string, M.IDisposable>();
	let disposed = false;
	const register: IMonacoSnippetRegister = (language, snippetList) => {
		if (disposed) return;
		snippetDisposables.get(language)?.dispose();
		snippetDisposables.delete(language);
		if (!snippetList.length) return;
		const disposable = M.languages.registerCompletionItemProvider(
			language,
			createSnippetProvider(snippetList)
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
};
