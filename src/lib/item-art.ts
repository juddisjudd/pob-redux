import type { Tooltip } from "./engine.svelte";

export async function itemArtUrl(item: NonNullable<Tooltip["itemArt"]>, supportGem = false): Promise<string | null> {
  const icons: Record<string, string> = item.game === "poe1"
    ? (await import("@scalpel/item-data/poe1.json")).default
    : (await import("@scalpel/item-data/poe2.json")).default;
  // PoB omits "Support" from PoE1 support names; some also name active gems.
  const baseName = supportGem && item.game === "poe1" && item.baseName && !item.baseName.endsWith(" Support")
    ? `${item.baseName} Support` : item.baseName;
  const names = item.rarity === "UNIQUE" || item.rarity === "RELIC"
    ? [item.name, item.name?.replace(/^Foulborn\s+/, ""), item.baseName]
    : [baseName];
  for (const name of names) {
    if (!name) continue;
    const key = name.replace(/\s+\([^)]*\)$/, "");
    // These PoE2 variants reuse their underlying item's art. Prefer an exact
    // entry when available, then normalize before falling back to a unique's base.
    const keys = item.game === "poe2"
      ? [name, key, key.replace(/^(?:Runeforged|Runemastered)\s+/, "")]
      : [name, key];
    for (const candidate of keys) {
      const url = Object.hasOwn(icons, candidate) ? icons[candidate] : null;
      if (url?.startsWith("https://web.poecdn.com/")) return url;
    }
  }
  return null;
}
