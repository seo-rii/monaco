<script lang="ts">
    import Monaco from "$lib/Monaco.svelte";

    let id = "test", lang = "cpp";
</script>

<input bind:value={id}>
<input bind:value={lang}>
<Monaco setting={{
            power: true,
            automaticLayout: true,
            renderWhitespace: true,
            lightbulb: {enabled: true},
            fontLigatures: true
        }} provider={(id) => ['', lang, 'inmemory://workspace/' + id]}
        lspurl={(language) => `ws://localhost:2500/${language}`} active={id}/>

<style lang="scss">
  :global(html, body, body > div) {
    margin: 0;
    padding: 0;
    height: 100%;
  }
</style>