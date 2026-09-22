<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import type { Tooltip, TooltipHeader, TooltipLine } from "$lib/engine.svelte";
  import { game } from "$lib/state/game.svelte";
  import ItemArt from "./ItemArt.svelte";
  import PobText from "./PobText.svelte";

  let {
    lines,
    header,
    runic = false,
    uniqueGem = false,
    itemArt,
  }: { lines: TooltipLine[]; header: NonNullable<TooltipHeader>; runic?: boolean; uniqueGem?: boolean; itemArt?: Tooltip["itemArt"] } = $props();

  // PoB's Tooltip class: header art sizes and the rarity each one frames.
  const ITEM_HEADERS: Record<string, { art: string; height: number; side: number; textY: number; color: string }> = {
    UNIQUE: { art: "unique", height: 58, side: 47, textY: 4, color: "var(--c-unique)" },
    RARE: { art: "rare", height: 58, side: 47, textY: 4, color: "var(--c-rare)" },
    RELIC: { art: "foil", height: 58, side: 47, textY: 4, color: "var(--c-rare)" },
    MAGIC: { art: "magic", height: 38, side: 32, textY: 6, color: "var(--c-magic)" },
    NORMAL: { art: "white", height: 38, side: 32, textY: 6, color: "var(--c-normal)" },
    GEM: { art: "gem", height: 38, side: 33, textY: 5, color: "var(--c-gem)" },
  };

  const asset = (name: string) => `url("${convertFileSrc(`Assets/${name}`, "pobasset")}")`;

  const gem = $derived(header === "GEM");
  const poe2Gem = $derived(gem && game.isPoe2);
  const hdr = $derived(ITEM_HEADERS[header] ?? ITEM_HEADERS.NORMAL);
  const sepArt = $derived(asset(`itemsseparator${gem ? "gem" : hdr!.art}.png`));
  const frameColor = $derived(gem ? "var(--c-gem)" : hdr!.color);

  const headerStyle = $derived.by(() => {
    // PoE1 uses the same three-piece frame as items; only PoE2 ships gemhovertitle.
    if (poe2Gem) return `background-image:${asset(uniqueGem ? "gemhovertitleunique.png" : "gemhovertitle.png")};background-size:auto 59px;background-repeat:no-repeat;min-height:59px`;
    const h = hdr!;
    const prefix = runic && !gem ? "runicitemsheader" : "itemsheader";
    const sz = `${h.side}px ${h.height}px`;
    return [
      `background-image:${asset(`${prefix}${h.art}left.png`)},${asset(`${prefix}${h.art}right.png`)},${asset(`${prefix}${h.art}middle.png`)}`,
      "background-position:left top,right top,center top",
      "background-repeat:no-repeat,no-repeat,repeat-x",
      `background-size:${sz},${sz},${sz}`,
      `min-height:${h.height}px`,
      `padding:${h.textY}px ${h.side}px 0`,
    ].join(";");
  });

  // PoB opens item and gem tooltips with the title lines and one separator;
  // the header art stands in for both, as in PoB's own draw routine.
  const split = $derived.by(() => {
    const title: TooltipLine[] = [];
    let i = 0;
    while (i < lines.length && !lines[i].sep) title.push(lines[i++]);
    if (i < lines.length && lines[i].sep) i++;
    const body = lines.slice(i);
    // The game-font description ends before PoB's comparison notes.
    let artAfter = body.length - 1;
    for (let j = body.length - 1; j >= 0; j--) {
      if (body[j].font?.startsWith("FONTIN")) { artAfter = j; break; }
    }
    return { title, body, artAfter };
  });

  // PoB's sizes are for its own UI scale; the game font reads larger, so
  // the box is scaled down to sit with the rest of the app.
  function lineStyle(l: TooltipLine): string {
    const px = Math.round(l.size * 0.78);
    const family = l.font?.includes("ITALIC") ? "font-style:italic" : l.font === "FONTIN SC" ? "font-family:'Fontin SmallCaps',var(--font-ui)" : "";
    return `font-size:${px}px;line-height:${px + 4}px;${family}`;
  }
</script>

<div class="frame scope-dark" style:border-color={frameColor}>
  <div class="head" class:gem={poe2Gem} style={headerStyle}>
    {#each split.title as l, i (i)}
      <div class="line" class:center={l.center} style={lineStyle(l)}><PobText text={l.text} /></div>
    {/each}
  </div>
  <div class="body">
    {#each split.body as l, i (i)}
      {#if l.sep}
        <div class="sep" style:background-image={sepArt}></div>
      {:else}
        <div class="line" class:center={l.center} class:note={l.size <= 14} style={lineStyle(l)}><PobText text={l.text} /></div>
      {/if}
      {#if itemArt && i === split.artAfter}
        <ItemArt item={itemArt} />
      {/if}
    {/each}
  </div>
</div>

<style>
  .frame {
    min-width: 280px;
    background: #000;
    border: 1px solid;
    color: var(--fg-0);
  }
  .head {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .head.gem {
    padding: 6px 12px 4px;
    justify-content: flex-start;
  }
  .body {
    padding: 6px 12px 9px;
  }
  .line {
    white-space: pre-wrap;
  }
  .center {
    text-align: center;
  }
  .line.note {
    font-family: var(--font-ui);
    color: var(--fg-2);
  }
  .sep {
    height: 9px;
    margin: 3px 0;
    background-repeat: no-repeat;
    background-size: 100% 100%;
  }
</style>
