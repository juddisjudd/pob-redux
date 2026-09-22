import { expect, test } from "bun:test";
import { itemArtUrl } from "../src/lib/item-art";

test("PoE2 runic prefixes fall back to the underlying base or unique art", async () => {
  const base = { game: "poe2" as const, name: "Storm Stride", baseName: "Dragonscale Boots", rarity: "RARE" };
  const boots = await itemArtUrl(base);
  expect(boots).toBeTruthy();
  for (const prefix of ["Runeforged", "Runemastered"]) {
    expect(await itemArtUrl({ ...base, baseName: `${prefix} Dragonscale Boots` })).toBe(boots);
    expect(await itemArtUrl({ ...base, baseName: `${prefix} Dragonscale Boots (legacy)` })).toBe(boots);
    const unique = { ...base, name: "Headhunter", baseName: "Heavy Belt", rarity: "UNIQUE" };
    const art = await itemArtUrl(unique);
    expect(art).toBeTruthy();
    expect(await itemArtUrl({ ...unique, name: `${prefix} Headhunter`, baseName: `${prefix} Heavy Belt` })).toBe(art);
    expect(await itemArtUrl({ ...base, name: "Unknown unique", rarity: "UNIQUE", baseName: `${prefix} Dragonscale Boots` })).toBe(boots);
  }
  expect(await itemArtUrl({ ...base, game: "poe1", baseName: "Runemastered Dragonscale Boots" })).toBeNull();
});

test("PoB support names resolve to support art, including names shared with active gems", async () => {
  const item = (name: string) => ({ game: "poe1" as const, name, baseName: name, rarity: null });
  for (const name of ["Spell Echo", "Empower", "Added Cold Damage", "Awakened Added Cold Damage", "Barrage"]) {
    const url = await itemArtUrl(item(name), true);
    expect(url).toBeTruthy();
    expect(url).toBe(await itemArtUrl(item(`${name} Support`)));
  }
  expect(await itemArtUrl(item("Barrage"), true)).not.toBe(await itemArtUrl(item("Barrage")));
  expect(await itemArtUrl(item("Spell Echo Support"), true)).toBe(await itemArtUrl(item("Spell Echo"), true));
  expect(await itemArtUrl(item("Missing Gem"), true)).toBeNull();
});

test("unique art is game-specific, including relics and Foulborn variants", async () => {
  const item = { game: "poe1" as const, name: "Headhunter", baseName: "Leather Belt", rarity: "UNIQUE" };
  const poe1 = await itemArtUrl(item);
  const poe2 = await itemArtUrl({ ...item, game: "poe2" });
  expect(poe1).toContain("Headhunter");
  expect(poe2).toBeTruthy();
  expect(poe2).not.toBe(poe1);
  expect(await itemArtUrl({ ...item, rarity: "RELIC" })).toBe(poe1);
  expect(await itemArtUrl({ ...item, name: "Foulborn Headhunter" })).toBe(poe1);
});

test("crafted items use their base, and missing uniques fall back to base art", async () => {
  const item = { game: "poe1" as const, name: "Headhunter", baseName: "Leather Belt", rarity: "RARE" };
  const base = await itemArtUrl(item);
  expect(base).toBeTruthy();
  expect(base).not.toBe(await itemArtUrl({ ...item, rarity: "UNIQUE" }));
  expect(await itemArtUrl({ ...item, name: "Unknown unique", rarity: "UNIQUE" })).toBe(base);
  expect(await itemArtUrl({ ...item, baseName: "Leather Belt (legacy)" })).toBe(base);
  expect(await itemArtUrl({ ...item, baseName: "Unknown base" })).toBeNull();
  expect(await itemArtUrl({ ...item, baseName: "constructor" })).toBeNull();
});
