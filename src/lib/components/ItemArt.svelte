<script lang="ts">
  import type { Tooltip } from "$lib/engine.svelte";
  import { itemArtUrl } from "$lib/item-art";

  let { item }: { item: NonNullable<Tooltip["itemArt"]> } = $props();
  let src = $state<string | null>(null);
  let loaded = $state(false);
  $effect(() => {
    let live = true;
    src = null;
    loaded = false;
    itemArtUrl(item).then((url) => { if (live) src = url; }).catch(() => {});
    return () => { live = false; };
  });
</script>

{#if src}
  {#key src}
    <div class="art" class:loaded>
      <img src={src} alt="" referrerpolicy="no-referrer" onload={() => loaded = true} onerror={() => loaded = false} />
    </div>
  {/key}
{/if}

<style>
  .art { display: none; }
  .art.loaded { display: flex; justify-content: center; padding: 10px 0; }
  img { display: block; max-width: 100%; max-height: min(140px, 18vh); object-fit: contain; }
</style>
