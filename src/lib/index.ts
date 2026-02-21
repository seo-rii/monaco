import Monaco from './Monaco.svelte';
import MonacoDiff from './MonacoDiff.svelte';

export { MonacoDiff };

export type { IMonacoInputEvent, IMonacoSetting } from './Monaco.svelte';
export type {
	IMonacoDiffCursorEvent,
	IMonacoDiffEditorSide,
	IMonacoDiffFocusEvent,
	IMonacoDiffInputEvent,
	IMonacoDiffSetting
} from './MonacoDiff.svelte';
export type {
	IMonacoDiffProviderResult,
	IMonacoDiffSourcePair,
	IMonacoModelSource,
	IMonacoSnippet,
	IMonacoSnippetLoader,
	IMonacoSnippetMap,
	IMonacoSnippetRegister
} from './MonacoTypes.js';

export default Monaco;
