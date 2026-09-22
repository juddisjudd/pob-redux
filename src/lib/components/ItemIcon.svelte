<script lang="ts">
  import type { Tooltip } from "$lib/engine.svelte";
  import { itemArtUrl } from "$lib/item-art";

  let { item, fallback = "", supportGem = false }: { item: NonNullable<Tooltip["itemArt"]>; fallback?: string; supportGem?: boolean } = $props();
  let src = $state<string | null>(null);
  let loaded = $state(false);
  $effect(() => {
    let live = true;
    src = null;
    loaded = false;
    itemArtUrl(item, supportGem).then((url) => { if (live) src = url; }).catch(() => {});
    return () => { live = false; };
  });
</script>

{#if src}
  {#key src}
    <img src={src} alt="" class:loaded onload={() => loaded = true} onerror={() => loaded = false} />
  {/key}
{/if}
{#if !loaded}<span class="fallback">{fallback}</span>{/if}

<style>
  img { display: none; width: 100%; height: 100%; object-fit: contain; }
  img.loaded { display: block; }
  .fallback { font-size: 10px; line-height: 1.25; color: var(--fg-2); overflow-wrap: anywhere; }
</style>
