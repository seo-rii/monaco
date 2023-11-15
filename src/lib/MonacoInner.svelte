<script lang="ts" context="module">
    let serviceInit = false;
</script>

<script lang="ts">
    import {createEventDispatcher, onMount} from "svelte";
    import {Keybind, Power, setTheme} from "$lib/extensions";
    //import "$lib/extensions/worker.js";
    import * as M from "monaco-editor";
    import lsp from "$lib/extensions/lsp.js";

    const dispatch = createEventDispatcher();

    export let ref, ins: M.editor.IStandaloneCodeeditor;
    export let models = {}, active = 'default',
        provider = (f, uri) => f('', 'text', uri('inmemory://workspace/file'));
    export let model: M.editor.IModel;
    export let setting = {}, theme: any = '';
    export let message = '';
    export let lspurl: any;

    $: ins && (async () => model = models[active] = models[active] || await provider(M.editor.createModel, M.Uri.parse))();
    $: ins && ins.updateOptions(setting);
    $: ins && theme && setTheme(M.editor, theme);
    $: model && ins.setModel(model);

    let _keybind: any, _powermode: any;

    $: if (model) {
        if (_keybind) _keybind?.dispose?.();
        _keybind = setting.key ? Keybind[key]?.(ins, message) : null;
    }

    $: if (model) {
        if (_powermode) _powermode?.dispose?.()
        _powermode = setting.power ? new Power(ins) : null;
    }

    $: if (model) (async () => {
        const language = model.getLanguageId();
        const url = lspurl && await lspurl(language);
        if (url) await lsp(language, url);
    })()

    onMount(() => {
        ins = M.editor.create(ref, setting);
        ins.onDidChangeModelContent(() => dispatch('change'));
        return () => ins?.dispose?.();
    });
</script>

<main bind:this={ref}></main>

<style lang="scss">
  main {
    width: 100%;
    height: 100%;
  }
</style>
