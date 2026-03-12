import Monaco from './Monaco.svelte';
import MonacoDiff from './MonacoDiff.svelte';

export { MonacoDiff };
export {
	createLineHighlightDecoration,
	createModel,
	getModelByUri,
	setModelDecorations,
	setModelLanguage,
	upsertModel
} from './MonacoBase.js';

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
	IMonacoModelSource,
	IMonacoSnippet,
	IMonacoSnippetLoader,
	IMonacoSnippetMap,
	IMonacoSnippetRegister
} from './MonacoTypes.js';
export type { editor } from 'monaco-editor';

export default Monaco;
