<script lang="ts">
  import type { Tooltip } from "$lib/engine.svelte";
  import { itemArtUrl, tooltipArtSize } from "$lib/item-art";

  let { item }: { item: NonNullable<Tooltip["itemArt"]> } = $props();
  let src = $state<string | null>(null);
  let loaded = $state(false);
  let size = $state<{ width: number; height: number } | null>(null);
  $effect(() => {
    let live = true;
    src = null;
    loaded = false;
    size = null;
    itemArtUrl(item).then((url) => { if (live) src = url; }).catch(() => {});
    return () => { live = false; };
  });

  function imageLoaded(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    size = tooltipArtSize(image.naturalWidth, image.naturalHeight);
    loaded = true;
  }
</script>

{#if src}
  {#key src}
    <div class="art" class:loaded>
      <img src={src} alt="" width={size?.width} height={size?.height} onload={imageLoaded} onerror={() => loaded = false} />
    </div>
  {/key}
{/if}

<style>
  .art { display: none; }
  .art.loaded { display: flex; justify-content: center; padding: 10px 0; }
  img { display: block; max-width: 100%; max-height: min(141px, 18vh); object-fit: contain; }
</style>
