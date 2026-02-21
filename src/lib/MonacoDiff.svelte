<script lang="ts">
	import type * as M from 'monaco-editor';
	import type { Snippet } from 'svelte';
	import type { IMonacoSnippetLoader, IMonacoSnippetMap } from '$lib/Monaco.svelte';

	export type IMonacoDiffEditorSide = 'original' | 'modified';
	export type IMonacoModelSource = [code: string, language: string, uri: string];

	export interface IMonacoDiffSourcePair {
		original: IMonacoModelSource;
		modified: IMonacoModelSource;
	}

	export type IMonacoDiffProviderResult =
		| IMonacoDiffSourcePair
		| [original: IMonacoModelSource, modified: IMonacoModelSource];

	export interface IMonacoDiffSetting extends M.editor.IStandaloneDiffEditorConstructionOptions {
		/** Enable vim or emacs keybinding mode on modified editor */
		key?: 'vim' | 'emacs';
		/** Enable power mode (explosion effects on typing) on modified editor */
		power?: boolean;
	}

	export interface IMonacoDiffInputEvent {
		side: IMonacoDiffEditorSide;
		model: M.editor.IModel;
		value: string;
		reason: 'change' | 'readonly-attempt';
		event?: M.editor.IModelContentChangedEvent;
	}

	export interface IMonacoDiffCursorEvent {
		side: IMonacoDiffEditorSide;
		model: M.editor.IModel;
		position: M.Position;
	}

	export interface IMonacoDiffFocusEvent {
		side: IMonacoDiffEditorSide;
		model: M.editor.IModel;
	}

	interface IMonacoDiff {
		setting?: IMonacoDiffSetting;
		readonly?: boolean;
		provider?: (id: string) => Promise<IMonacoDiffProviderResult>;
		active?: string;
		theme?: string;
		message?: HTMLElement | null;
		lspurl?: (language: string) => string;
		children?: Snippet;
		ref?: HTMLElement | null;
		model?: M.editor.IDiffEditorModel;
		models?: Record<string, Promise<M.editor.IDiffEditorModel | undefined>>;
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
		ref = $bindable(null),
		models = $bindable({}),
		active = $bindable('default'),
		model = $bindable(),
		message = $bindable(null),
		provider,
		setting = {},
		readonly: readonlyProp,
		theme = '',
		lspurl,
		children,
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
	}: IMonacoDiff = $props();

	let MonacoDiffInner: typeof import('./MonacoDiffInner.svelte').default | null = $state(null);

	$effect(() => {
		import('./MonacoDiffInner.svelte')
			.then((i) => (MonacoDiffInner = i.default))
			.catch((e: unknown) => {
				const error = e instanceof Error ? e : new Error(String(e));
				onerror?.(error, 'Failed to load MonacoDiffInner component');
				if (!onerror) {
					console.warn('[MonacoDiff] Failed to load MonacoDiffInner component:', error);
				}
			});
	});
</script>

{#if MonacoDiffInner}
	<MonacoDiffInner
		bind:models
		bind:active
		bind:model
		bind:message
		bind:ref
		{provider}
		{setting}
		readonly={readonlyProp}
		{theme}
		{lspurl}
		{originalMarkers}
		{modifiedMarkers}
		{markerOwner}
		{snippets}
		{registerSnippets}
		{onchange}
		{oninput}
		{oncursor}
		{onfocus}
		{onblur}
		{onupdate}
		{onload}
		{onerror}
	/>
{:else}
	{@render children?.()}
{/if}
