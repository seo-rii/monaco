<script lang="ts">
	import type * as M from 'monaco-editor';

	interface IMonaco {
		setting?: M.editor.IEditorConstructionOptions & any;
		provider?: (id: string) => Promise<[string, string, string]>;
		active?: string;
		theme?: string;
		message?: HTMLElement | null;
		lspurl?: (language: string) => string;
		children?: any;
		preload?: boolean;
		ref?: HTMLElement | null;
		model?: M.editor.IModel;
		models?: Record<string, Promise<M.editor.IModel | undefined>>;
		ins?: M.editor.IStandaloneCodeEditor;
		onchange?: (m: M.editor.IModel) => any;
	}

	let {
		ref = $bindable(null),
		ins = $bindable(null as any),
		models = $bindable({}),
		active = $bindable('default'),
		model = $bindable(),
		message = $bindable(null),
		provider,
		setting = {},
		theme = '',
		lspurl,
		children,
		onchange
	}: IMonaco = $props();

	let Monaco: typeof import('./MonacoInner.svelte').default | null = $state(null as any);

	$effect(() => {
		import('./MonacoInner.svelte').then((i) => (Monaco = i.default));
	});
</script>

{#if Monaco}
	<Monaco
		bind:ins
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
	/>
{:else}
	{@render children?.()}
{/if}
