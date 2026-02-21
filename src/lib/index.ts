import Monaco from './Monaco.svelte';
import MonacoDiff from './MonacoDiff.svelte';

export { MonacoDiff };

export type {
	IMonacoInputEvent,
	IMonacoSetting,
	IMonacoSnippet,
	IMonacoSnippetLoader,
	IMonacoSnippetMap,
	IMonacoSnippetRegister
} from './Monaco.svelte';
export type {
	IMonacoDiffCursorEvent,
	IMonacoDiffEditorSide,
	IMonacoDiffFocusEvent,
	IMonacoDiffInputEvent,
	IMonacoDiffProviderResult,
	IMonacoDiffSetting,
	IMonacoDiffSourcePair,
	IMonacoModelSource
} from './MonacoDiff.svelte';

export default Monaco;
