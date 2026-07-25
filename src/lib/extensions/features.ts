import type * as M from 'monaco-editor';
import type { IMonacoExtension } from './runtime.js';

export interface IMonacoBuiltinFeatureOptions {
	aonohakoLanguages?: boolean;
	snippets?: boolean;
	keybindings?: boolean;
	powerMode?: boolean;
	lsp?: boolean;
}

export type IMonacoBuiltinFeatures = boolean | IMonacoBuiltinFeatureOptions;
export type IMonacoBuiltinFeature = keyof IMonacoBuiltinFeatureOptions;

export function isMonacoBuiltinFeatureEnabled(
	features: IMonacoBuiltinFeatures | undefined,
	feature: IMonacoBuiltinFeature
): boolean {
	if (features === false) return false;
	if (features === true || features === undefined) return true;
	return features[feature] !== false;
}

export interface IMonacoProviderContribution<TProvider> {
	selector: M.languages.LanguageSelector;
	provider: TProvider;
}

export interface IMonacoCodeActionContribution
	extends IMonacoProviderContribution<M.languages.CodeActionProvider> {
	metadata?: M.languages.CodeActionProviderMetadata;
}

export interface IMonacoWorkspaceSymbolProvider {
	provideWorkspaceSymbols(
		query: string,
		token: M.CancellationToken
	): M.languages.ProviderResult<M.languages.SymbolInformation[]>;
	resolveWorkspaceSymbol?(
		symbol: M.languages.SymbolInformation,
		token: M.CancellationToken
	): M.languages.ProviderResult<M.languages.SymbolInformation>;
}

type Contributions<T> =
	| false
	| IMonacoProviderContribution<T>
	| readonly IMonacoProviderContribution<T>[];
type CodeActionContributions =
	| false
	| IMonacoCodeActionContribution
	| readonly IMonacoCodeActionContribution[];
type WorkspaceSymbolContributions =
	| false
	| IMonacoWorkspaceSymbolProvider
	| readonly IMonacoWorkspaceSymbolProvider[];

export interface IMonacoLanguageFeatureContributions {
	documentSymbols?: Contributions<M.languages.DocumentSymbolProvider>;
	references?: Contributions<M.languages.ReferenceProvider>;
	rename?: Contributions<M.languages.RenameProvider>;
	codeActions?: CodeActionContributions;
	documentFormatting?: Contributions<M.languages.DocumentFormattingEditProvider>;
	rangeFormatting?: Contributions<M.languages.DocumentRangeFormattingEditProvider>;
	onTypeFormatting?: Contributions<M.languages.OnTypeFormattingEditProvider>;
	inlayHints?: Contributions<M.languages.InlayHintsProvider>;
	semanticTokens?: Contributions<M.languages.DocumentSemanticTokensProvider>;
	rangeSemanticTokens?: Contributions<M.languages.DocumentRangeSemanticTokensProvider>;
	codeLens?: Contributions<M.languages.CodeLensProvider>;
	inlineCompletions?: Contributions<M.languages.InlineCompletionsProvider>;
	workspaceSymbols?: WorkspaceSymbolContributions;
}

export interface IMonacoLanguageFeaturesExtensionOptions {
	id?: string;
	enabled?: boolean;
	features: IMonacoLanguageFeatureContributions;
}

const workspaceSymbolProviders = new Set<IMonacoWorkspaceSymbolProvider>();

const asList = <T>(value: false | T | readonly T[] | undefined): readonly T[] => {
	if (!value) return [];
	return Array.isArray(value) ? value : [value as T];
};

export function createMonacoLanguageFeaturesExtension({
	id = 'language-features',
	enabled = true,
	features
}: IMonacoLanguageFeaturesExtensionOptions): IMonacoExtension {
	return {
		id,
		enabled,
		activate({ monaco }) {
			const disposables: M.IDisposable[] = [];
			const register = <T>(
				contributions:
					| false
					| IMonacoProviderContribution<T>
					| readonly IMonacoProviderContribution<T>[]
					| undefined,
				installer: (selector: M.languages.LanguageSelector, provider: T) => M.IDisposable
			) => {
				for (const contribution of asList(contributions)) {
					disposables.push(installer(contribution.selector, contribution.provider));
				}
			};

			register(features.documentSymbols, monaco.languages.registerDocumentSymbolProvider);
			register(features.references, monaco.languages.registerReferenceProvider);
			register(features.rename, monaco.languages.registerRenameProvider);
			for (const contribution of asList(features.codeActions)) {
				disposables.push(
					monaco.languages.registerCodeActionProvider(
						contribution.selector,
						contribution.provider,
						contribution.metadata
					)
				);
			}
			register(
				features.documentFormatting,
				monaco.languages.registerDocumentFormattingEditProvider
			);
			register(
				features.rangeFormatting,
				monaco.languages.registerDocumentRangeFormattingEditProvider
			);
			register(features.onTypeFormatting, monaco.languages.registerOnTypeFormattingEditProvider);
			register(features.inlayHints, monaco.languages.registerInlayHintsProvider);
			register(features.semanticTokens, monaco.languages.registerDocumentSemanticTokensProvider);
			register(
				features.rangeSemanticTokens,
				monaco.languages.registerDocumentRangeSemanticTokensProvider
			);
			register(features.codeLens, monaco.languages.registerCodeLensProvider);
			register(features.inlineCompletions, monaco.languages.registerInlineCompletionsProvider);
			for (const provider of asList(features.workspaceSymbols)) {
				workspaceSymbolProviders.add(provider);
				disposables.push({ dispose: () => workspaceSymbolProviders.delete(provider) });
			}

			return {
				dispose() {
					for (const disposable of disposables.reverse()) disposable.dispose();
				}
			};
		}
	};
}

const neverCancelled: M.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} })
};

export async function queryMonacoWorkspaceSymbols(
	query: string,
	token: M.CancellationToken = neverCancelled
): Promise<M.languages.SymbolInformation[]> {
	const results = await Promise.all(
		[...workspaceSymbolProviders].map((provider) =>
			Promise.resolve(provider.provideWorkspaceSymbols(query, token))
		)
	);
	return results.flatMap((result) => result ?? []);
}

export function getMonacoProblems(
	monaco: typeof M,
	filter: { owner?: string; resource?: M.Uri; take?: number } = {}
): M.editor.IMarker[] {
	return monaco.editor.getModelMarkers(filter);
}

export interface IMonacoFeatureActionOptions {
	problems?: boolean;
	outline?: boolean;
	rename?: boolean;
	references?: boolean;
	codeActions?: boolean;
	formatting?: boolean;
}

const actionIds = {
	problems: 'editor.action.marker.nextInFiles',
	outline: 'editor.action.quickOutline',
	rename: 'editor.action.rename',
	references: 'editor.action.referenceSearch.trigger',
	codeActions: 'editor.action.quickFix',
	formatting: 'editor.action.formatDocument'
} as const;

export function createMonacoFeatureActions(
	editor: M.editor.IStandaloneCodeEditor,
	options: IMonacoFeatureActionOptions = {}
) {
	const run = async (name: keyof typeof actionIds): Promise<boolean> => {
		if (options[name] === false) return false;
		const action = editor.getAction(actionIds[name]);
		if (!action) return false;
		await action.run();
		return true;
	};
	return {
		problems: () => run('problems'),
		outline: () => run('outline'),
		rename: () => run('rename'),
		references: () => run('references'),
		codeActions: () => run('codeActions'),
		formatting: () => run('formatting')
	};
}
