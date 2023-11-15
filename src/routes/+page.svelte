<script lang="ts">
    import Monaco from "$lib/Monaco.svelte";
</script>

<Monaco setting={{
            power: true,
            automaticLayout: true,
            renderWhitespace: true,
            lightbulb: {enabled: true},
            fontLigatures: true
        }} provider={(f, uri) => f('', 'python', uri('inmemory://workspace/file'))}
        lspurl={(language) => `ws://localhost:2500/${language}`}/>

<style lang="scss">
  :global(html, body, body > div) {
    margin: 0;
    padding: 0;
    height: 100%;
  }
</style>