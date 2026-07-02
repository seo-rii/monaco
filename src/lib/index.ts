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

export type { IMonacoInputEvent, IMonacoSetting } from './Monaco.svelte';
export type {
	IMonacoDiffCursorEvent,
	IMonacoDiffEditorSide,
	IMonacoDiffFocusEvent,
	IMonacoDiffInputEvent,
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
	IMonacoLspMessage,
	IMonacoLspMessageReader,
	IMonacoLspMessageTransports,
	IMonacoLspMessageWriter,
	IMonacoLspNativeTransport,
	IMonacoLspProvider,
	IMonacoLspProviderResult,
	IMonacoLspServerHandle,
	IMonacoLspTraceEvent,
	IMonacoModelSource,
	IMonacoSnippet,
	IMonacoSnippetLoader,
	IMonacoSnippetMap,
	IMonacoSnippetRegister
} from './MonacoTypes.js';
export type { editor } from 'monaco-editor';

export default Monaco;

export async function loadMonaco() {
	const monaco = await import('monaco-editor');
	registerAonohakoLanguages(monaco);
	return monaco;
}
