import { expect, test } from "bun:test";
import { artPath, tooltipArtSize, type ArtMap } from "../src/lib/item-art";

const map = (game: ArtMap["game"], bases: Record<string, string>, uniques: Record<string, string> = {}): ArtMap =>
  ({ game, version: "test", bases, uniques, sockets: {}, files: {} });

const poe1 = map(
  "poe1",
  { "Leather Belt": "Art/Belt.webp", "Barrage": "Art/Barrage.webp", "Barrage Support": "Art/BarrageSupport.webp", "Spell Echo Support": "Art/SpellEcho.webp", "Summon Stone Golem of Safeguarding": "Art/StoneGolem.webp" },
  { Headhunter: "Art/Headhunter.webp" },
);
const item = (name: string | null, baseName: string | null, rarity: string | null = null) => ({ game: "poe1" as const, name, baseName, rarity });

test("uniques use their own art, relics and Foulborn included, then fall back to the base", () => {
  expect(artPath(poe1, item("Headhunter", "Leather Belt", "UNIQUE"))).toBe("Art/Headhunter.webp");
  expect(artPath(poe1, item("Headhunter", "Leather Belt", "RELIC"))).toBe("Art/Headhunter.webp");
  expect(artPath(poe1, item("Foulborn Headhunter", "Leather Belt", "UNIQUE"))).toBe("Art/Headhunter.webp");
  expect(artPath(poe1, item("Unknown", "Leather Belt", "UNIQUE"))).toBe("Art/Belt.webp");
  expect(artPath(poe1, item("Headhunter", "Leather Belt", "RARE"))).toBe("Art/Belt.webp");
});

test("PoB support gem names get the game's Support suffix", () => {
  expect(artPath(poe1, item("Spell Echo", "Spell Echo"), true)).toBe("Art/SpellEcho.webp");
  expect(artPath(poe1, item("Barrage", "Barrage"), true)).toBe("Art/BarrageSupport.webp");
  expect(artPath(poe1, item("Barrage", "Barrage"))).toBe("Art/Barrage.webp");
});

test("PoB variant suffixes are stripped and unknown names have no art", () => {
  expect(artPath(poe1, item(null, "Leather Belt (legacy)"))).toBe("Art/Belt.webp");
  expect(artPath(poe1, item(null, "Unknown base"))).toBeNull();
  expect(artPath(poe1, item(null, "constructor"))).toBeNull();
});

test("published PoE1 transfigured gem mappings resolve directly", () => {
  expect(artPath(poe1, item("Summon Stone Golem of Safeguarding", "Summon Stone Golem of Safeguarding"))).toBe("Art/StoneGolem.webp");
});

test("tooltip art uses the inventory-grid scale", () => {
  expect(tooltipArtSize(156, 236)).toEqual({ width: 94, height: 142 });
  expect(tooltipArtSize(80, 80)).toEqual({ width: 48, height: 48 });
});
