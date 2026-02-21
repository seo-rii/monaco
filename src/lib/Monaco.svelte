<script lang="ts">
	import type * as M from 'monaco-editor';
	import type { Snippet } from 'svelte';
	import type { IMonacoSnippetLoader, IMonacoSnippetMap } from '$lib/MonacoTypes.js';

	export interface IMonacoSetting extends M.editor.IEditorConstructionOptions {
		/** Enable vim or emacs keybinding mode */
		key?: 'vim' | 'emacs';
		/** Enable power mode (explosion effects on typing) */
		power?: boolean;
	}

	export interface IMonacoInputEvent {
		model: M.editor.IModel;
		value: string;
		reason: 'change' | 'readonly-attempt';
		event?: M.editor.IModelContentChangedEvent;
	}

	interface IMonaco {
		setting?: IMonacoSetting;
		readonly?: boolean;
		provider?: (id: string) => Promise<[string, string, string]>;
		active?: string;
		theme?: string;
		message?: HTMLElement | null;
		lspurl?: (language: string) => string;
		children?: Snippet;
		ref?: HTMLElement | null;
		model?: M.editor.IModel;
		models?: Record<string, Promise<M.editor.IModel | undefined>>;
		markers?: M.editor.IMarkerData[];
		markerOwner?: string;
		snippets?: IMonacoSnippetMap;
		registerSnippets?: IMonacoSnippetLoader;
		onchange?: (m: M.editor.IModel) => void;
		oninput?: (event: IMonacoInputEvent) => void;
		oncursor?: (position: M.Position) => void;
		onfocus?: () => void;
		onblur?: () => void;
		onload?: (m: M.editor.IStandaloneCodeEditor) => void;
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
		markers,
		markerOwner,
		snippets,
		registerSnippets,
		onchange,
		oninput,
		oncursor,
		onfocus,
		onblur,
		onload,
		onerror
	}: IMonaco = $props();

	let Monaco: typeof import('./MonacoInner.svelte').default | null = $state(null);

	$effect(() => {
		import('./MonacoInner.svelte')
			.then((i) => (Monaco = i.default))
			.catch((e: unknown) => {
				const error = e instanceof Error ? e : new Error(String(e));
				onerror?.(error, 'Failed to load MonacoInner component');
				if (!onerror) {
					console.warn('[Monaco] Failed to load MonacoInner component:', error);
				}
			});
	});
</script>

{#if Monaco}
	<Monaco
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
		{markers}
		{markerOwner}
		{snippets}
		{registerSnippets}
		{onchange}
		{oninput}
		{oncursor}
		{onfocus}
		{onblur}
		{onload}
		{onerror}
	/>
{:else}
	{@render children?.()}
{/if}
