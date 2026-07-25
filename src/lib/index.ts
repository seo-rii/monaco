import Monaco from './Monaco.svelte';
import MonacoDiff from './MonacoDiff.svelte';
import { registerAonohakoLanguages } from './customLanguages.js';

export { MonacoDiff };
export {
	createLineHighlightDecoration,
	createModel,
	getModelByUri,
	setModelDecorations,
	setModelLanguage,
	upsertModel
} from './MonacoBase.js';
export { aonohakoLanguageDefinitions, registerAonohakoLanguages } from './customLanguages.js';
export {
	createMonacoFeatureActions,
	createMonacoLanguageFeaturesExtension,
	createMonacoRuntime,
	getMonacoProblems,
	getMonacoRuntime,
	isMonacoBuiltinFeatureEnabled,
	queryMonacoWorkspaceSymbols
} from './extensions/index.js';

export type { IMonacoInputEvent, IMonacoProps, IMonacoSetting } from './Monaco.svelte';
export type {
	IMonacoDiffCursorEvent,
	IMonacoDiffEditorSide,
	IMonacoDiffFocusEvent,
	IMonacoDiffInputEvent,
	IMonacoDiffProps,
	IMonacoDiffSetting
} from './MonacoDiff.svelte';
export type {
	IMonacoDecoration,
	IMonacoDecorationHover,
	IMonacoDiffProviderResult,
	IMonacoDiffSourcePair,
	IMonacoLineHighlightOptions,
	IMonacoLspClientOptions,
	IMonacoLspConnection,
	IMonacoLspDocumentSyncOptions,
	IMonacoLspFeatureOptions,
	IMonacoLspMessage,
	IMonacoLspMessageReader,
	IMonacoLspMessageTransports,
	IMonacoLspMessageWriter,
	IMonacoLspNativeTransport,
	IMonacoLspProvider,
	IMonacoLspProviderContext,
	IMonacoLspProviderResult,
	IMonacoLspServerHandle,
	IMonacoLspStatus,
	IMonacoLspStatusHandler,
	IMonacoLspTraceEvent,
	IMonacoModelSource,
	IMonacoSnippet,
	IMonacoSnippetLoader,
	IMonacoSnippetMap,
	IMonacoSnippetRegister
} from './MonacoTypes.js';
export type {
	IMonacoBuiltinFeature,
	IMonacoBuiltinFeatureOptions,
	IMonacoBuiltinFeatures,
	IMonacoCodeActionContribution,
	IMonacoEditorKind,
	IMonacoEditorSide,
	IMonacoExtension,
	IMonacoExtensionCleanup,
	IMonacoExtensionContext,
	IMonacoExtensionResult,
	IMonacoExtensions,
	IMonacoFeatureActionOptions,
	IMonacoLanguageFeatureContributions,
	IMonacoLanguageFeaturesExtensionOptions,
	IMonacoModelExtensionContext,
	IMonacoProviderContribution,
	IMonacoRuntime,
	IMonacoWorkspaceSymbolProvider
} from './extensions/index.js';
export type { editor } from 'monaco-editor';

export default Monaco;

export async function loadMonaco(options: { aonohakoLanguages?: boolean } = {}) {
	const monaco = await import('monaco-editor');
	if (options.aonohakoLanguages !== false) registerAonohakoLanguages(monaco);
	return monaco;
}
