<script lang="ts">
    import Monaco from "$lib/Monaco.svelte";
</script>

<Monaco setting={{power: true}}/>

<style lang="scss">
  :global(html, body, body > div) {
    margin: 0;
    padding: 0;
    height: 100%;
  }
</style>