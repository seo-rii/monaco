<script lang="ts">
    import {onMount} from "svelte";
    import {browser} from "$app/environment";
    import type * as M from "monaco-editor";

    export let preload = false;

    export let ref: HTMLElement, ins: M.editor.IStandaloneCodeeditor;
    export let models = {}, active = 'default', provider;
    export let model: M.editor.IModel;
    export let setting: M.editor.IEditorConstructionOptions = {}, theme: any = '';
    export let message = '';
    export let lspurl;
    let Monaco: any;

    if (preload || browser) onMount(() => {
        import("./MonacoInner.svelte").then((i) => Monaco = i.default);
    })
</script>

{#if Monaco}
    <Monaco bind:ins bind:models bind:active bind:model bind:message on:change
            {ref} {provider} {setting} {theme} {lspurl}/>
{:else}
    <slot/>
{/if}