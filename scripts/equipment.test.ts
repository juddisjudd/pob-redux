import { expect, test } from "bun:test";
import { assignedGems, equipmentArea, socketedGems, visibleEquipment } from "../src/lib/equipment";
import type { GemInfo, SlotInfo, SocketGroup } from "../src/lib/engine.svelte";

test("only the visible weapon set and active equipment appear", () => {
  const slots = [
    { slot: "Weapon 1", shown: false, inactive: false, nodeId: null },
    { slot: "Weapon 1 Swap", shown: true, inactive: false, nodeId: null },
    { slot: "Ring 3", shown: false, inactive: false, nodeId: null },
    { slot: "Jewel 1", shown: true, inactive: false, nodeId: 123 },
    { slot: "Charm 3", shown: true, inactive: true, nodeId: null },
    { slot: "Body Armour", shown: true, inactive: false, nodeId: null },
  ] as SlotInfo[];
  expect(visibleEquipment(slots).map((slot) => slot.slot)).toEqual(["Weapon 1 Swap", "Body Armour"]);
  expect(equipmentArea("Weapon 1 Swap")).toBe(equipmentArea("Weapon 1"));
  expect(equipmentArea("Body Armour Jewel Socket 1")).toBeUndefined();
});

const skillGroup = (index: number, colours: string[]) => ({
  index, slot: "Body Armour", enabled: true, source: null, grantedBy: null,
  gems: colours.map((socketColour, i) => ({ index: i + 1, name: `Gem ${index}:${i}`, socketColour, enabled: true })),
}) as SocketGroup;

test("gems fit colours and white sockets without separating a skill group", () => {
  const sockets = ["W", "B", "R", "G", "B", "A"].map((colour, index) => ({ colour, group: index < 3 ? 0 : 1 }));
  const result = socketedGems("Body Armour", sockets, [skillGroup(1, ["B", "G", "R"]), skillGroup(2, ["B", "G"])]);
  expect(result.map((entry) => entry?.gem.socketColour ?? null)).toEqual(["G", "B", "R", "G", "B", null]);
  expect(result.slice(0, 3).every((entry) => entry?.groupIndex === 1)).toBe(true);
  expect(result.slice(3, 5).every((entry) => entry?.groupIndex === 2)).toBe(true);
});

test("a skill group cannot cross disconnected links or fill an abyssal socket", () => {
  const sockets = [{ colour: "B", group: 0 }, { colour: "G", group: 1 }, { colour: "A", group: 1 }];
  expect(socketedGems("Body Armour", sockets, [skillGroup(1, ["B", "G"])])).toEqual([null, null, null]);
  expect(socketedGems("Body Armour", [], [skillGroup(1, ["B"])])).toEqual([]);
});

test("allocation backtracks so a flexible gem does not consume a required colour", () => {
  const sockets = [{ colour: "B", group: 0 }, { colour: "R", group: 0 }];
  const result = socketedGems("Body Armour", sockets, [skillGroup(1, ["W"]), skillGroup(2, ["B"])]);
  expect(result.map((entry) => entry?.groupIndex)).toEqual([2, 1]);
});

test("assigned gems preserve exact weapon sets and exclude item-granted duplicates", () => {
  const gem = { index: 1, name: "Fireball", enabled: true, granted: null } as GemInfo;
  const group = { index: 1, slot: "Weapon 1", enabled: true, source: null, grantedBy: null, gems: [gem] } as SocketGroup;
  const groups = [group, { ...group, index: 2, source: "Item:1:Weapon" }, { ...group, index: 3, slot: "Weapon 1 Swap" }, { ...group, index: 4, gems: [{ ...gem, granted: "Weapon" }] }];
  expect(assignedGems("Weapon 1", groups).map((entry) => entry.groupIndex)).toEqual([1]);
  expect(assignedGems("Weapon 1 Swap", groups).map((entry) => entry.groupIndex)).toEqual([3]);
  expect(assignedGems("Weapon 1", [{ ...group, enabled: false }])[0].enabled).toBe(false);
});
