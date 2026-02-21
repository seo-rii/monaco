<script lang="ts">
	import type * as M from 'monaco-editor';
	import type { Snippet } from 'svelte';

	export interface IMonacoSetting extends M.editor.IEditorConstructionOptions {
		/** Enable vim or emacs keybinding mode */
		key?: 'vim' | 'emacs';
		/** Enable power mode (explosion effects on typing) */
		power?: boolean;
	}

	interface IMonaco {
		setting?: IMonacoSetting;
		provider?: (id: string) => Promise<[string, string, string]>;
		active?: string;
		theme?: string;
		message?: HTMLElement | null;
		lspurl?: (language: string) => string;
		children?: Snippet;
		ref?: HTMLElement | null;
		model?: M.editor.IModel;
		models?: Record<string, Promise<M.editor.IModel | undefined>>;
		onchange?: (m: M.editor.IModel) => void;
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
		theme = '',
		lspurl,
		children,
		onchange,
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
		{theme}
		{lspurl}
		{onchange}
		{onload}
		{onerror}
	/>
{:else}
	{@render children?.()}
{/if}
