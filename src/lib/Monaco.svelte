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
		onchange?: (m: M.editor.IModel) => any;
		onload?: (m: M.editor.IStandaloneCodeEditor) => any;
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
	}: IMonaco = $props();

	let Monaco: typeof import('./MonacoInner.svelte').default | null = $state(null as any);

	$effect(() => {
		import('./MonacoInner.svelte').then((i) => (Monaco = i.default));
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
	/>
{:else}
	{@render children?.()}
{/if}
