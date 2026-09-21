<script lang="ts">
  import { untrack } from "svelte";
  import {
    engine,
    type AnointInfo,
    type CorruptionInfo,
    type CraftBase,
    type ItemAffixes,
    type ItemDbRow,
    type ItemInfo,
    type ItemRunes,
    type ItemSetInfo,
    type ItemCrucible,
    type ItemShape,
    type ItemSocket,
    type ItemVariants,
    type SharedItem,
    type SlotsResponse,
    type Tooltip,
    type TooltipLine,
  } from "$lib/engine.svelte";
  import { build } from "$lib/state/build.svelte";
  import { game } from "$lib/state/game.svelte";
  import EquipmentGrid from "$lib/components/EquipmentGrid.svelte";
  import PobText from "$lib/components/PobText.svelte";
  import { stripPobText } from "$lib/pobtext";
  import EnchantDialog from "$lib/components/EnchantDialog.svelte";
  import ItemFrame from "$lib/components/ItemFrame.svelte";
  import PobTooltip from "$lib/components/PobTooltip.svelte";
  import TraderWindow from "$lib/components/TraderWindow.svelte";
  import BuySimilarDialog from "$lib/components/BuySimilarDialog.svelte";
  import { m } from "$lib/paraglide/messages";

  let slotsResp = $state<SlotsResponse | null>(null);
  let items = $state<ItemInfo[]>([]);
  let itemSets = $state<ItemSetInfo[]>([]);
  let selectedItem = $state<number | null>(null);
  let buySimilarFor = $state<number | null>(null);

  let dbTab = $state<"unique" | "rare">("unique");
  let dbQuery = $state("");
  let dbType = $state("");
  let dbRows = $state<ItemDbRow[]>([]);
  let dbTypes = $state<{ type: string; count: number }[]>([]);
  let dbTotal = $state(0);
  let dbLoading = $state(false);
  let dbLoaded = $state(false);
  let dbBusy = false;
  let dbStamp = 0;

  let editOpen = $state(false);
  let editText = $state("");
  let editItemId = $state<number | null>(null);
  let editError = $state<string | null>(null);

  let craftOpen = $state(false);
  let craftData = $state<{ types: string[]; bases: Record<string, CraftBase[]> } | null>(null);
  let craftType = $state("");
  let craftBase = $state("");
  let craftRarity = $state("RARE");
  let craftTitle = $state("New Item");
  let craftEquip = $state(true);

  // selected item detail (tooltip, affixes, runes, modify flags)
  let detail = $state<{ tt: Tooltip; affixes: ItemAffixes | null; runes: ItemRunes | null } | null>(null);
  let anointFlags = $state<AnointInfo | null>(null);
  let corruptInfo = $state<CorruptionInfo | null>(null);
  let catInfo = $state<{ usable: boolean; names: string[]; catalyst: number; quality: number } | null>(null);
  let shape = $state<ItemShape | null>(null);
  let variants = $state<ItemVariants | null>(null);
  let enchantOpen = $state(false);

  function setVariant(pick: number, index: number) {
    if (selectedItem == null || !variants) return;
    const next = variants.picks.map((p, i) => (i === pick ? index : p));
    build.run(() => engine.setItemVariant(selectedItem!, next).then((r) => (variants = r)));
  }
  let crucible = $state<ItemCrucible | null>(null);

  function setCrucible(node: number, id: string) {
    if (selectedItem == null || !crucible) return;
    const next = crucible.selected.map((s, i) => (i === node ? id : s));
    build.run(() => engine.setItemCrucible(selectedItem!, next).then((r) => (crucible = r)));
  }
  let enchantable = $state(false);

  const SOCKET_NAMES = $derived<Record<string, string>>({ R: m.items_socket_red(), G: m.items_socket_green(), B: m.items_socket_blue(), W: m.items_socket_white(), A: m.items_socket_abyssal() });

  /** PoB allows two influences, so picking a third drops the oldest. */
  function toggleInfluence(key: string) {
    if (selectedItem == null || !shape) return;
    const on = shape.influences.filter((i) => i.on).map((i) => i.key);
    const next = on.includes(key) ? on.filter((k) => k !== key) : [...on, key].slice(-2);
    build.run(() => engine.setItemShape(selectedItem!, { influences: next }).then((r) => (shape = r)));
  }

  function setSocket(index: number, patch: Partial<ItemSocket>) {
    if (selectedItem == null || !shape) return;
    const next = shape.sockets.map((s, i) => (i === index ? { ...s, ...patch } : s));
    build.run(() => engine.setItemShape(selectedItem!, { sockets: next }).then((r) => (shape = r)));
  }

  function addSocket() {
    if (selectedItem == null || !shape) return;
    const next = [...shape.sockets, { colour: "W", group: shape.sockets.length ? shape.sockets[shape.sockets.length - 1].group : 0 }];
    build.run(() => engine.setItemShape(selectedItem!, { sockets: next }).then((r) => (shape = r)));
  }

  function removeSocket(index: number) {
    if (selectedItem == null || !shape) return;
    const next = shape.sockets.filter((_, i) => i !== index);
    build.run(() => engine.setItemShape(selectedItem!, { sockets: next }).then((r) => (shape = r)));
  }

  /** A link joins a socket to the one before it, which PoB stores as a shared group. */
  function toggleLink(index: number) {
    if (!shape || index === 0) return;
    const prev = shape.sockets[index - 1];
    const cur = shape.sockets[index];
    const linked = prev.group === cur.group;
    const next = shape.sockets.map((s, i) => (i >= index ? { ...s, group: linked ? s.group + 1 : prev.group } : s));
    if (selectedItem != null) build.run(() => engine.setItemShape(selectedItem!, { sockets: next }).then((r) => (shape = r)));
  }

  $effect(() => {
    const id = selectedItem;
    build.rev;
    untrack(() => {
      if (id == null) {
        detail = null;
        anointFlags = corruptInfo = catInfo = null;
        return;
      }
      Promise.all([engine.itemTooltip({ itemId: id }), engine.itemAffixes(id), engine.itemRunes(id)])
        .then(([t, a, r]) => {
          if (selectedItem === id) detail = { tt: t, affixes: a.crafted ? a : null, runes: r.socketCount > 0 ? r : null };
        })
        .catch(() => {
          detail = null;
          selectedItem = null;
        });
      engine
        .itemShape(id)
        .then((r) => (shape = r))
        .catch(() => (shape = null));
      engine
        .itemVariants(id)
        .then((r) => (variants = r.names.length > 1 ? r : null))
        .catch(() => (variants = null));
      engine
        .itemEnchants(id)
        .then((r) => (enchantable = r.available))
        .catch(() => (enchantable = false));
      engine
        .itemCrucible(id)
        .then((r) => (crucible = r.available ? r : null))
        .catch(() => (crucible = null));
      Promise.all([engine.itemAnoints(id), engine.itemCorruptions(id), engine.catalystInfo(id)])
        .then(([an, co, ca]) => {
          if (selectedItem === id) {
            anointFlags = an;
            corruptInfo = co;
            catInfo = ca;
          }
        })
        .catch(() => (anointFlags = corruptInfo = catInfo = null));
    });
  });

  // shared items (main.sharedItemList; app-added ones persisted locally)
  const SHARED_KEY = "pob-redux:shared-items";
  let shared = $state<SharedItem[]>([]);
  $effect(() => {
    build.rev;
    engine.getSharedItems().then((r) => (shared = r.items)).catch(() => (shared = []));
  });
  function persistShared(raw: string, add: boolean) {
    try {
      let raws: string[] = JSON.parse(localStorage.getItem(SHARED_KEY) ?? "[]");
      if (add) raws.push(raw);
      else {
        const i = raws.indexOf(raw);
        if (i >= 0) raws.splice(i, 1);
      }
      localStorage.setItem(SHARED_KEY, JSON.stringify(raws));
    } catch {}
  }
  async function addShared(itemId: number) {
    const r = await engine.addSharedItem({ itemId }).catch(() => null);
    if (r) {
      shared = r.items;
      persistShared(r.items[r.items.length - 1].raw, true);
    }
  }
  async function removeShared(it: SharedItem) {
    const r = await engine.removeSharedItem(it.index).catch(() => null);
    if (r) {
      shared = r.items;
      persistShared(it.raw, false);
    }
  }

  let anointOpen = $state(false);
  let anointInfo = $state<AnointInfo | null>(null);
  let anointQuery = $state("");
  let anointSlot = $state(1);
  async function openAnoint() {
    if (selectedItem == null) return;
    anointInfo = await engine.itemAnoints(selectedItem, true).catch(() => null);
    anointQuery = "";
    anointSlot = 1;
    anointOpen = anointInfo != null;
  }
  const anointList = $derived.by(() => {
    if (!anointInfo) return [];
    const words = anointQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = words.length
      ? anointInfo.nodes.filter((n) => {
          const hay = `${n.name} ${n.stats.join(" ")} ${n.recipe.join(" ")}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
      : anointInfo.nodes;
    return list.slice(0, 120);
  });
  async function applyAnoint(nodeId: number | null) {
    if (selectedItem == null) return;
    anointOpen = false;
    await build.run(() => engine.setItemAnoint(selectedItem!, nodeId, anointSlot));
  }

  let corruptOpen = $state(false);
  let corruptSel = $state<string[]>([]);
  let corruptRanges = $state<Record<number, number>>({});
  function openCorrupt() {
    if (!corruptInfo) return;
    corruptSel = Array(corruptInfo.enchantNum).fill("");
    const r: Record<number, number> = {};
    for (const rng of corruptInfo.ranges) r[rng.index] = rng.current;
    corruptRanges = r;
    corruptOpen = true;
  }
  const corruptModList = $derived(corruptInfo ? [...corruptInfo.mods, ...corruptInfo.specialMods] : []);
  function corruptOptions(i: number) {
    const takenGroups = corruptSel.filter((id, j) => j !== i && id).map((id) => corruptModList.find((o) => o.id === id)?.group);
    return corruptModList.filter((o) => !o.group || !takenGroups.includes(o.group));
  }
  async function applyCorrupt(mode: "implicits" | "ranges") {
    if (selectedItem == null) return;
    corruptOpen = false;
    const p: { itemId: number; modIds?: string[]; ranges?: { index: number; value: number }[] } = { itemId: selectedItem };
    if (mode === "implicits") p.modIds = corruptSel.filter(Boolean);
    else p.ranges = Object.entries(corruptRanges).map(([index, value]) => ({ index: Number(index), value }));
    await build.run(() => engine.corruptItem(p));
  }

  // The Trader window: a weighted trade search per slot, opened in the browser.
  let traderOpen = $state(false);
  let traderFocus = $state<string | null>(null);
  function openTrader(slotName: string | null) {
    traderFocus = slotName;
    traderOpen = true;
  }

  async function openCraft() {
    craftOpen = true;
    if (!craftData) {
      craftData = await engine.craftBases().catch(() => null);
      if (craftData) {
        craftType = craftData.types[0] ?? "";
        craftBase = craftData.bases[craftType]?.[0]?.name ?? "";
      }
    }
  }
  async function doCraft() {
    const r = await build.run(() => engine.craftItem({ type: craftType, baseName: craftBase, rarity: craftRarity, title: craftTitle, equip: craftEquip }));
    if (r) {
      craftOpen = false;
      selectedItem = r.itemId;
    }
  }

  function lineStyle(l: TooltipLine): string {
    if (l.size >= 20) return "font-size:13px;font-weight:600";
    if (l.size >= 16) return "font-size:12px";
    return "font-size:11px";
  }

  let tip = $state<{ tt: Tooltip; x: number; y: number } | null>(null);
  let tipTimer = 0;
  const tipCache = new Map<string, Tooltip>();

  const activeSet = $derived(itemSets.find((s) => s.active));
  const shownSlots = $derived((slotsResp?.slots ?? []).filter((s) => s.shown && !s.inactive));
  const gearSlots = $derived(shownSlots.filter((s) => s.nodeId == null));
  const socketSlots = $derived(shownSlots.filter((s) => s.nodeId != null));
  const selectedEquippedSlot = $derived(selectedItem == null ? null : (items.find((i) => i.id === selectedItem)?.equippedSlot ?? null));

  $effect(() => {
    build.rev;
    tipCache.clear();
    hideTip();
    let live = true;
    Promise.all([engine.listSlots(), engine.getItems(), engine.listItemSets()]).then(([s, i, sets]) => {
      if (!live) return;
      slotsResp = s;
      items = i.items;
      itemSets = sets.itemSets;
    });
    return () => { live = false; };
  });

  $effect(() => {
    const q = dbQuery;
    const t = dbType;
    const tab = dbTab;
    untrack(() => {
      if (dbBusy) return;
      dbBusy = true;
      const stamp = ++dbStamp;
      dbLoading = !dbLoaded;
      engine
        .itemDbList({ db: tab, query: q, type: t || undefined, limit: 80 })
        .then((r) => {
          if (stamp === dbStamp) {
            dbRows = r.items;
            dbTypes = r.types;
            dbTotal = r.total;
            dbLoaded = true;
          }
        })
        .catch(() => {})
        .finally(() => {
          dbBusy = false;
          dbLoading = false;
        });
    });
  });

  function equipSlot(slot: string, e: Event) {
    const id = Number((e.target as HTMLSelectElement).value);
    build.run(() => engine.equipItem(slot, id));
  }

  // PoB's own Ctrl+D: the "removing this item will give you" lines in item tooltips.
  let statDiff = $state<boolean | null>(null);
  engine.statDifferences().then((r) => (statDiff = r.show)).catch(() => {});
  async function setStatDiff(show: boolean) {
    try {
      statDiff = (await engine.statDifferences(show)).show;
      tipCache.clear();
      tip = null;
    } catch {}
  }
  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d" && statDiff !== null) {
      e.preventDefault();
      void setStatDiff(!statDiff);
    }
  }

  // Beside the hovered row rather than under the pointer, so the row's own
  // buttons and the rows below stay visible.
  let tipRequest = 0;
  function showTip(e: MouseEvent | FocusEvent, key: string, fetch: () => Promise<Tooltip>) {
    clearTimeout(tipTimer);
    const request = ++tipRequest;
    tip = null;
    const row = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    let x = Math.min(("clientX" in e ? e.clientX : 8) + 16, window.innerWidth - 560);
    let y = Math.min(("clientY" in e ? e.clientY : 8) + 12, Math.max(window.innerHeight - 520, 40));
    if (row) {
      x = row.right + 8 + 540 <= window.innerWidth ? row.right + 8 : Math.max(8, row.left - 540 - 8);
      y = row.top;
    }
    tipTimer = window.setTimeout(async () => {
      const cached = tipCache.get(key);
      if (cached) {
        tip = { tt: cached, x, y };
        return;
      }
      try {
        const r = await fetch();
        if (request !== tipRequest) return;
        tipCache.set(key, r);
        tip = { tt: r, x, y };
      } catch {
        if (request === tipRequest) tip = null;
      }
    }, 120);
  }
  function hideTip() {
    tipRequest++;
    clearTimeout(tipTimer);
    tip = null;
  }

  async function openEdit(itemId: number | null) {
    editError = null;
    editItemId = itemId;
    if (itemId != null) {
      const r = await engine.itemRaw(itemId).catch(() => null);
      editText = r?.raw ?? "";
    } else {
      editText = "";
    }
    editOpen = true;
  }
  async function saveEdit(asNew: boolean) {
    editError = null;
    try {
      await engine.itemEdit(editText, asNew ? undefined : (editItemId ?? undefined));
      await build.sync();
      editOpen = false;
    } catch (e) {
      editError = String(e);
    }
  }

  const rarityColor: Record<string, string> = {
    UNIQUE: "var(--c-unique)",
    RARE: "var(--c-rare)",
    MAGIC: "var(--c-magic)",
    NORMAL: "var(--c-normal)",
    RELIC: "var(--c-gem)",
  };
</script>

<svelte:window onkeydown={onKey} />

{#snippet slotRow(s: SlotsResponse["slots"][number])}
  <div
    class="slot"
    class:jewel={s.nodeId != null}
    role="note"
    onmouseenter={(e) => s.itemId !== 0 && showTip(e, `i${s.itemId}`, () => engine.itemTooltip({ itemId: s.itemId }))}
    onmouseleave={hideTip}
  >
    <span class="sname">{s.label ?? s.slot}</span>
    <select class="select" value={s.itemId} onchange={(e) => equipSlot(s.slot, e)} disabled={build.busy > 0} style:color={rarityColor[s.itemRarity ?? ""] ?? undefined}>
      <option value={0}>—</option>
      {#each items as it}
        <option value={it.id}>{it.name}</option>
      {/each}
    </select>
  </div>
{/snippet}

<div class="page">
  <div class="toolbar">
    <select class="select setsel" value={activeSet?.id ?? 1} onchange={(e) => build.run(() => engine.selectItemSet(Number((e.target as HTMLSelectElement).value)))} disabled={build.busy > 0} title={m.items_set_title()}>
      {#each itemSets as s}
        <option value={s.id}>{stripPobText(s.title)}</option>
      {/each}
    </select>
    <button class="btn sm ghost" onclick={() => build.run(() => engine.createItemSet())}>{m.common_new()}</button>
    <button class="btn sm ghost" onclick={() => build.run(() => engine.copyItemSet())}>{m.common_copy_button()}</button>
    <button
      class="btn sm ghost"
      onclick={() => {
        const t = prompt(m.items_set_name_prompt(), activeSet?.title ?? "");
        if (t && activeSet) build.run(() => engine.renameItemSet(activeSet.id, t));
      }}>{m.common_rename()}</button
    >
    <button class="btn sm ghost" disabled={itemSets.length <= 1} onclick={() => activeSet && build.run(() => engine.deleteItemSet(activeSet.id))}>{m.common_delete()}</button>
    <span class="vr"></span>
    <span class="label">{m.items_weapon_set()}</span>
    <div class="wset">
      <button class="btn sm" class:on={!slotsResp?.useSecondWeaponSet} onclick={() => build.run(() => engine.setWeaponSet(1))}>I</button>
      <button class="btn sm" class:on={slotsResp?.useSecondWeaponSet} onclick={() => build.run(() => engine.setWeaponSet(2))}>II</button>
    </div>
    <span class="vr"></span>
    <button class="btn sm" onclick={openCraft}>{m.items_craft()}</button>
    <button class="btn sm" onclick={() => openEdit(null)}>{m.items_new_from_text()}</button>
    <button class="btn sm ghost" title={m.items_trader_title()} onclick={() => openTrader(null)}>{m.items_trader()}</button>
    {#if statDiff !== null}
      <span class="vr"></span>
      <label class="chk small" title={m.items_stat_diff_title()}>
        <input type="checkbox" checked={statDiff} onchange={(e) => setStatDiff((e.target as HTMLInputElement).checked)} />
        {m.items_stat_diff()}
      </label>
    {/if}
  </div>

  <div class="cols">
    <section class="col slots">
      <div class="panel-head"><span class="label">{m.items_equipment()}</span></div>
      <div class="scroll">
        <EquipmentGrid slots={slotsResp?.slots ?? []} {items} game={game.current} groups={build.skills?.socketGroups ?? []} {selectedItem}
          onselect={(id) => { hideTip(); selectedItem = id; }}
          onitemhover={(event, id) => showTip(event, `i${id}`, () => engine.itemTooltip({ itemId: id }))}
          ongemhover={(event, group, gem) => showTip(event, `g${group}:${gem}`, () => engine.gemTooltip(group, gem))}
          onleave={hideTip} />
        {#each gearSlots as s (s.slot)}
          {@render slotRow(s)}
        {/each}
        {#if socketSlots.length}
          <div class="subhead" title={m.items_jewel_sockets_title()}>
            <span>{m.items_jewel_sockets()}</span>
            <span class="dim num">{socketSlots.length}</span>
          </div>
          {#each socketSlots as s (s.slot)}
            {@render slotRow(s)}
          {/each}
        {/if}
      </div>
    </section>

    <section class="col">
      <div class="panel-head"><span class="label">{m.items_in_build()}</span><span class="dim num">{items.length}</span></div>
      <div class="scroll">
        {#each items as it (it.id)}
          <div
            class="item"
            class:sel={selectedItem === it.id}
            role="note"
            onmouseenter={(e) => showTip(e, `i${it.id}`, () => engine.itemTooltip({ itemId: it.id }))}
            onmouseleave={hideTip}
          >
            <button class="iname" style:color={rarityColor[it.rarity ?? ""] ?? "var(--fg-1)"} onclick={() => (selectedItem = it.id)}>
              {it.name}
            </button>
            <span class="itag dim">{it.equippedSlot ?? ""}</span>
            <span class="iops">
              {#if !it.equippedSlot && it.primarySlot}
                <button class="mini w" title={m.items_equip_in({ slot: it.primarySlot })} onclick={() => it.primarySlot && build.run(() => engine.equipItem(it.primarySlot!, it.id))}>{m.items_equip()}</button>
              {/if}
              <button class="mini w" onclick={() => openEdit(it.id)}>{m.common_edit()}</button>
              <button class="mini x" title={m.items_delete()} onclick={() => build.run(() => engine.deleteItem(it.id))}>✕</button>
            </span>
          </div>
        {/each}
        {#if items.length === 0}
          <div class="dim small pad">{m.items_none()}</div>
        {/if}
      </div>
      <div class="panel-head">
        <span class="label">{m.items_shared()}</span>
        <span class="dim num">{shared.length}</span>
      </div>
      <div class="scroll sharedlist" title={m.items_shared_title()}>
        {#each shared as it (it.index)}
          <div class="item">
            <span class="iname" style:color={rarityColor[it.rarity ?? ""] ?? "var(--fg-1)"}>{it.name}</span>
            <span class="itag dim">{it.baseName ?? ""}</span>
            <span class="iops">
              <button class="mini w" title={m.items_shared_equip_title()} onclick={() => build.run(() => engine.equipSharedItem(it.index))}>{m.items_equip()}</button>
              <button class="mini x" title={m.items_shared_remove_title()} onclick={() => removeShared(it)}>✕</button>
            </span>
          </div>
        {/each}
        {#if shared.length === 0}
          <div class="dim small pad">{m.items_shared_none()}</div>
        {/if}
      </div>
    </section>

    <section class="col db">
      {#if selectedItem != null && detail}
        <div class="panel-head">
          <span class="label">{m.items_item()}</span>
          <button class="btn sm ghost" onclick={() => (buySimilarFor = selectedItem)} title={m.items_buy_similar_title()}>{m.items_buy_similar()}</button>
          <button class="btn sm ghost" onclick={() => (selectedItem = null)}>{m.items_back_to_database()}</button>
        </div>
        <div class="scroll detailpane">
          {#if detail.tt.header}
            <div class="ttbox">
              <ItemFrame lines={detail.tt.lines} header={detail.tt.header} runic={detail.tt.runic} uniqueGem={detail.tt.uniqueGem} itemArt={detail.tt.itemArt} />
            </div>
          {:else}
            <div class="ttbox plain">
              {#each detail.tt.lines as l}
                {#if l.sep}
                  <div class="tsep"></div>
                {:else}
                  <div class="tline" class:tcenter={l.center} style={lineStyle(l)}><PobText text={l.text} /></div>
                {/if}
              {/each}
            </div>
          {/if}

          {#if detail.affixes}
            <div class="craftsec">
              <div class="label">{m.items_prefixes()}</div>
              {#each detail.affixes.prefixes as slot (slot.index)}
                <div class="affix">
                  <select class="select" value={slot.modId} onchange={(e) => selectedItem != null && build.run(() => engine.setItemAffix(selectedItem!, "prefixes", slot.index, (e.target as HTMLSelectElement).value, slot.range))}>
                    <option value="None">{m.items_empty_prefix()}</option>
                    {#each slot.options as o (o.modId)}
                      <option value={o.modId}>{(o.affix ? o.affix + "  ·  " : "") + o.label}</option>
                    {/each}
                  </select>
                  {#if slot.modId !== "None"}
                    <input
                      class="range"
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(slot.range * 100)}
                      title={`Roll: ${Math.round(slot.range * 100)}%`}
                      onchange={(e) => selectedItem != null && build.run(() => engine.setItemAffix(selectedItem!, "prefixes", slot.index, slot.modId, Number((e.target as HTMLInputElement).value) / 100))}
                    />
                  {/if}
                </div>
              {/each}
              <div class="label">{m.items_suffixes()}</div>
              {#each detail.affixes.suffixes as slot (slot.index)}
                <div class="affix">
                  <select class="select" value={slot.modId} onchange={(e) => selectedItem != null && build.run(() => engine.setItemAffix(selectedItem!, "suffixes", slot.index, (e.target as HTMLSelectElement).value, slot.range))}>
                    <option value="None">{m.items_empty_suffix()}</option>
                    {#each slot.options as o (o.modId)}
                      <option value={o.modId}>{(o.affix ? o.affix + "  ·  " : "") + o.label}</option>
                    {/each}
                  </select>
                  {#if slot.modId !== "None"}
                    <input
                      class="range"
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(slot.range * 100)}
                      title={`Roll: ${Math.round(slot.range * 100)}%`}
                      onchange={(e) => selectedItem != null && build.run(() => engine.setItemAffix(selectedItem!, "suffixes", slot.index, slot.modId, Number((e.target as HTMLInputElement).value) / 100))}
                    />
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          {#if detail.runes}
            <div class="craftsec">
              <div class="label">{m.items_runes()}</div>
              {#each detail.runes.runes as rune, i}
                <div class="affix">
                  <select class="select" value={rune} onchange={(e) => selectedItem != null && build.run(() => engine.setItemRune(selectedItem!, i + 1, (e.target as HTMLSelectElement).value))}>
                    {#each detail.runes.options as o (o.name)}
                      <option value={o.name} title={o.lines.join("\n")}>{o.name === "None" ? "— empty socket —" : `${o.name}  ·  ${o.label ?? o.lines[0] ?? ""}`}</option>
                    {/each}
                  </select>
                </div>
              {/each}
            </div>
          {/if}

          {#if variants}
            <div class="craftsec">
              <div class="label">{variants.picks.length > 1 ? "Variants" : "Variant"}</div>
              {#each variants.picks as pick, i (i)}
                <div class="affix">
                  <select class="select" value={pick} title={variants.picks.length > 1 ? `Pick ${i + 1}` : "Variant"} onchange={(e) => setVariant(i, Number((e.target as HTMLSelectElement).value))}>
                    {#each variants.names as name, n (n)}
                      <option value={n + 1}>{name}</option>
                    {/each}
                  </select>
                </div>
              {/each}
            </div>
          {/if}

          <div class="craftsec">
            <div class="label">{m.items_modify()}</div>
            <div class="modrow">
              {#if anointFlags?.anointable}
                <button class="btn sm" onclick={openAnoint}>
                  {anointFlags.current.length ? `Anoint: ${anointFlags.current.join(", ")}` : "Anoint…"}
                </button>
              {/if}
              {#if enchantable}
                <button class="btn sm" onclick={() => (enchantOpen = true)}>{m.items_enchant()}</button>
              {/if}
              {#if corruptInfo?.corruptible || corruptInfo?.corrupted}
                <button class="btn sm" onclick={openCorrupt}>{corruptInfo.corrupted ? m.items_corrupted_modify() : m.items_corrupt()}</button>
              {/if}
              <button class="btn sm ghost" onclick={() => selectedItem != null && addShared(selectedItem)}>{m.items_add_to_shared()}</button>
              {#if selectedEquippedSlot}
                <button class="btn sm ghost" title={m.items_find_upgrades_title()} onclick={() => openTrader(selectedEquippedSlot!)}>{m.items_find_upgrades()}</button>
              {/if}
            </div>
            {#if shape && (shape.canBeInfluenced || shape.socketLimit > 0 || shape.cluster)}
              <div class="shape">
                {#if shape.canBeInfluenced}
                  <div class="srow">
                    <span class="label">{m.items_influence()}</span>
                    <span class="chips">
                      {#each shape.influences as inf (inf.key)}
                        <button class="chip" class:on={inf.on} title={m.items_influence_title()} onclick={() => toggleInfluence(inf.key)}>{inf.name}</button>
                      {/each}
                    </span>
                  </div>
                {/if}
                {#if shape.socketLimit > 0}
                  <div class="srow">
                    <span class="label">{m.items_sockets()}</span>
                    <span class="socks">
                      {#each shape.sockets as sock, i (i)}
                        {#if i > 0}
                          <button
                            class="link"
                            class:on={shape.sockets[i - 1].group === sock.group}
                            title={shape.sockets[i - 1].group === sock.group ? m.items_linked_title() : m.items_not_linked_title()}
                            onclick={() => toggleLink(i)}>—</button
                          >
                        {/if}
                        <span class="sock">
                          <select class="select xs sockc" value={sock.colour} onchange={(e) => setSocket(i, { colour: (e.target as HTMLSelectElement).value })}>
                            {#each shape.colours as c}
                              <option value={c}>{SOCKET_NAMES[c] ?? c}</option>
                            {/each}
                          </select>
                          <button class="mini x" title={m.items_remove_socket()} onclick={() => removeSocket(i)}>✕</button>
                        </span>
                      {/each}
                      {#if shape.sockets.length < shape.socketLimit}
                        <button class="btn sm ghost" onclick={addSocket}>{m.items_add_socket()}</button>
                      {/if}
                    </span>
                  </div>
                {/if}
                {#if crucible}
                  <div class="srow cruc">
                    <span class="label">{m.items_crucible()}</span>
                    <div class="crucnodes">
                      {#each crucible.nodes as options, i (i)}
                        <select class="select xs crucsel" title={m.items_crucible_node({ index: i + 1 })} value={crucible.selected[i] ?? ""} onchange={(e) => setCrucible(i, (e.target as HTMLSelectElement).value)}>
                          <option value="">{m.items_crucible_node_empty({ index: i + 1 })}</option>
                          {#each options as o (o.id)}
                            <option value={o.id}>T{o.tier} · {o.label}</option>
                          {/each}
                        </select>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if shape.cluster}
                  <div class="srow">
                    <span class="label">{m.items_cluster()}</span>
                    <select
                      class="select xs"
                      value={shape.cluster.skill ?? ""}
                      onchange={(e) => selectedItem != null && build.run(() => engine.setItemShape(selectedItem!, { clusterSkill: (e.target as HTMLSelectElement).value }).then((r) => (shape = r)))}
                    >
                      <option value="">{m.items_cluster_default()}</option>
                      {#each shape.cluster.skills as sk (sk.id)}
                        <option value={sk.id}>{sk.name}</option>
                      {/each}
                    </select>
                    <label class="fld-inline" title={m.items_cluster_passives_title()}>
                      <span class="label">{m.items_cluster_passives()}</span>
                      <input
                        class="input xs num"
                        type="number"
                        min={shape.cluster.minNodes}
                        max={shape.cluster.maxNodes}
                        value={shape.cluster.nodeCount}
                        onchange={(e) => selectedItem != null && build.run(() => engine.setItemShape(selectedItem!, { clusterNodeCount: Number((e.target as HTMLInputElement).value) }).then((r) => (shape = r)))}
                      />
                    </label>
                  </div>
                {/if}
              </div>
            {/if}
            {#if catInfo?.usable}
              <div class="affix">
                <select
                  class="select"
                  value={catInfo.catalyst}
                  title={m.items_catalyst()}
                  onchange={(e) => selectedItem != null && build.run(() => engine.setItemProps(selectedItem!, { catalyst: Number((e.target as HTMLSelectElement).value) }))}
                >
                  <option value={0}>{m.items_catalyst_none()}</option>
                  {#each catInfo.names as n, i}
                    <option value={i + 1}>{m.items_catalyst_named({ name: n })}</option>
                  {/each}
                </select>
                {#if catInfo.catalyst > 0}
                  <input
                    class="input catq num"
                    type="number"
                    min="0"
                    max="100"
                    value={catInfo.quality}
                    title={m.items_catalyst_quality_title()}
                    onchange={(e) => selectedItem != null && build.run(() => engine.setItemProps(selectedItem!, { catalystQuality: Number((e.target as HTMLInputElement).value) }))}
                  />
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {:else}
      <div class="panel-head">
        <span class="tabs2">
          <button class="t2" class:on={dbTab === "unique"} onclick={() => { dbTab = "unique"; dbType = ""; }}>{m.items_db_uniques()}</button>
          <button class="t2" class:on={dbTab === "rare"} onclick={() => { dbTab = "rare"; dbType = ""; }}>{m.items_db_rares()}</button>
        </span>
        <span class="dim num">{dbTotal}</span>
      </div>
      <div class="dbbar">
        <input class="input" placeholder={m.common_search()} bind:value={dbQuery} />
        <select class="select typesel" bind:value={dbType}>
          <option value="">{m.common_all_types()}</option>
          {#each dbTypes as t}
            <option value={t.type}>{t.type} ({t.count})</option>
          {/each}
        </select>
      </div>
      <div class="scroll">
        {#if dbLoading}
          <div class="dim small pad">{m.items_db_parsing()}</div>
        {/if}
        {#each dbRows as row (dbTab + row.name)}
          <div
            class="item"
            role="note"
            onmouseenter={(e) => showTip(e, `d${dbTab}:${row.name}:${build.rev}`, () => engine.itemTooltip({ db: dbTab, name: row.name }))}
            onmouseleave={hideTip}
          >
            <span class="iname" style:color={rarityColor[row.rarity ?? ""] ?? "var(--fg-1)"}>{row.name}</span>
            <span class="itag dim">{row.baseName ?? row.type}</span>
            <span class="iops">
              <button class="mini w" title={m.items_db_equip_title()} onclick={() => build.run(() => engine.itemDbEquip(dbTab, row.name))}>{m.items_equip()}</button>
            </span>
          </div>
        {/each}
        {#if !dbLoading && dbRows.length === 0}
          <div class="dim small pad">{m.items_db_none()}</div>
        {/if}
      </div>
      {/if}
    </section>
  </div>

  {#if enchantOpen && selectedItem != null}
    <EnchantDialog itemId={selectedItem} onclose={() => (enchantOpen = false)} />
  {/if}

  {#if craftOpen}
    <div class="modal">
      <div class="panel dialog craftdlg">
        <div class="label">{m.items_craft_title()}</div>
        <div class="crow">
          <span class="clabel">{m.items_rarity()}</span>
          <select class="select" bind:value={craftRarity}>
            <option value="NORMAL">{m.items_rarity_normal()}</option>
            <option value="MAGIC">{m.items_rarity_magic()}</option>
            <option value="RARE">{m.items_rarity_rare()}</option>
            <option value="UNIQUE">{m.items_rarity_unique()}</option>
          </select>
        </div>
        {#if craftRarity === "RARE" || craftRarity === "UNIQUE"}
          <div class="crow"><span class="clabel">{m.items_name()}</span><input class="input" bind:value={craftTitle} /></div>
        {/if}
        <div class="crow">
          <span class="clabel">{m.items_type()}</span>
          <select class="select" bind:value={craftType} onchange={() => (craftBase = craftData?.bases[craftType]?.[0]?.name ?? "")}>
            {#each craftData?.types ?? [] as t}
              <option value={t}>{t}</option>
            {/each}
          </select>
        </div>
        <div class="crow">
          <span class="clabel">{m.items_base()}</span>
          <select class="select" bind:value={craftBase}>
            {#each craftData?.bases[craftType] ?? [] as b (b.name)}
              <option value={b.name}>{b.name}{b.subType ? ` (${b.subType})` : ""}</option>
            {/each}
          </select>
        </div>
        <div class="crow">
          <span class="clabel"></span>
          <label class="chk small"><input type="checkbox" bind:checked={craftEquip} /> {m.items_equip_after()}</label>
        </div>
        <div class="actions">
          <button class="btn primary" onclick={doCraft} disabled={!craftBase || build.busy > 0}>{m.common_create()}</button>
          <button class="btn ghost" onclick={() => (craftOpen = false)}>{m.common_cancel()}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if editOpen}
    <div class="modal">
      <div class="panel dialog">
        <div class="label">{editItemId != null ? m.items_edit_title() : m.items_new_title()}</div>
        <textarea class="textarea" rows="18" bind:value={editText} placeholder={m.items_edit_placeholder()}></textarea>
        {#if editError}<div class="err small">{editError}</div>{/if}
        <div class="actions">
          {#if editItemId != null}
            <button class="btn" onclick={() => saveEdit(true)}>{m.items_save_as_copy()}</button>
          {/if}
          <button class="btn primary" onclick={() => saveEdit(editItemId == null)} disabled={!editText.trim()}>
            {editItemId != null ? m.common_save() : m.common_create()}
          </button>
          <button class="btn ghost" onclick={() => (editOpen = false)}>{m.common_cancel()}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if anointOpen && anointInfo}
    <div class="modal">
      <div class="panel dialog anointdlg">
        <div class="label">{m.items_anoint_title()}</div>
        <div class="crow">
          <input class="input grow2" placeholder={m.items_anoint_search()} bind:value={anointQuery} />
          {#if anointInfo.slots > 1}
            <select class="select" bind:value={anointSlot} title={m.items_anoint_slot()}>
              {#each Array(anointInfo.slots) as _, i}
                <option value={i + 1}>{m.items_anoint_slot_n({ index: i + 1 })}</option>
              {/each}
            </select>
          {/if}
        </div>
        <div class="anointlist">
          {#each anointList as n (n.id)}
            <button class="arow" class:alloc={n.allocated} title={n.stats.join("\n")} onclick={() => applyAnoint(n.id)}>
              <span class="aname">{n.name}</span>
              <span class="dim small">{n.recipe.join(" + ")}</span>
            </button>
          {/each}
          {#if !anointList.length}
            <div class="dim small pad">{m.items_anoint_none()}</div>
          {/if}
        </div>
        <div class="actions">
          {#if anointInfo.current.length}
            <button class="btn" onclick={() => applyAnoint(null)}>{m.items_anoint_remove({ name: anointInfo.current[anointSlot - 1] ?? m.items_anoint_fallback() })}</button>
          {/if}
          <button class="btn ghost" onclick={() => (anointOpen = false)}>{m.common_cancel()}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if corruptOpen && corruptInfo}
    <div class="modal">
      <div class="panel dialog">
        <div class="label">{m.items_corrupt_title()}</div>
        {#each corruptSel as sel, i}
          <div class="crow">
            <span class="clabel">{m.items_implicit_n({ index: i + 1 })}</span>
            <select class="select grow2" value={sel} onchange={(e) => (corruptSel[i] = (e.target as HTMLSelectElement).value)}>
              <option value="">{m.items_implicit_none()}</option>
              {#each corruptOptions(i) as opt (opt.id)}
                <option value={opt.id}>{opt.label}</option>
              {/each}
            </select>
          </div>
        {/each}
        {#if corruptInfo.ranges.length}
          <div class="label">{m.items_roll_ranges()}</div>
          {#each corruptInfo.ranges as r (r.index)}
            <div class="crow">
              <input
                class="range grow2"
                type="range"
                min="0.78"
                max="1.22"
                step="0.01"
                value={corruptRanges[r.index] ?? 1}
                onchange={(e) => (corruptRanges[r.index] = Number((e.target as HTMLInputElement).value))}
              />
              <span class="num small">{(corruptRanges[r.index] ?? 1).toFixed(2)}</span>
              <span class="dim small rline">{r.line}</span>
            </div>
          {/each}
        {/if}
        <div class="actions">
          <button class="btn primary" onclick={() => applyCorrupt("implicits")} disabled={build.busy > 0}>{m.items_corrupt_implicits()}</button>
          {#if corruptInfo.ranges.length}
            <button class="btn" onclick={() => applyCorrupt("ranges")} disabled={build.busy > 0}>{m.items_corrupt_ranges()}</button>
          {/if}
          <button class="btn ghost" onclick={() => (corruptOpen = false)}>{m.common_cancel()}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if traderOpen}
    <TraderWindow focusSlot={traderFocus} onclose={() => (traderOpen = false)} />
  {/if}

  {#if buySimilarFor != null}
    <BuySimilarDialog target={{ itemId: buySimilarFor }} onclose={() => (buySimilarFor = null)} />
  {/if}

  {#if tip}
    <PobTooltip lines={tip.tt.lines} header={tip.tt.header} runic={tip.tt.runic} uniqueGem={tip.tt.uniqueGem} itemArt={tip.tt.itemArt} x={tip.x} y={tip.y} />
  {/if}
</div>

<style>
  .page {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line-0);
    background: var(--bg-1);
  }
  .setsel {
    flex: none;
    width: 190px;
    height: 24px;
    font-size: var(--fs-xs);
  }
  .vr {
    width: 1px;
    height: 16px;
    background: var(--line-1);
    margin: 0 4px;
  }
  .wset {
    display: inline-flex;
  }
  .subhead {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 10px 12px 4px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .sharedlist {
    flex: 0 0 auto;
    max-height: 200px;
  }
  .modrow {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .catq {
    width: 64px;
    text-align: right;
  }
  .grow2 {
    flex: 1;
    min-width: 0;
  }
  .anointdlg {
    width: 520px;
  }
  .anointlist {
    max-height: 46vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-0);
    border-radius: var(--r-1);
  }
  .arow {
    appearance: none;
    border: 0;
    border-bottom: 1px solid var(--line-0);
    background: none;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 4px 8px;
    color: var(--fg-1);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .arow:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .arow.alloc .aname {
    color: var(--ok);
  }
  .rline {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wset .btn {
    border-radius: 0;
  }
  .wset .btn:first-child {
    border-radius: var(--r-1) 0 0 var(--r-1);
  }
  .wset .btn:last-child {
    border-radius: 0 var(--r-1) var(--r-1) 0;
    border-left: 0;
  }
  .btn.on {
    color: var(--fg-0);
    border-color: var(--fg-2);
    background: var(--bg-active);
  }
  .cols {
    flex: 1;
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr) minmax(0, 1fr);
    min-height: 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--line-0);
  }
  .col:last-child {
    border-right: 0;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
  }
  .slot {
    display: grid;
    grid-template-columns: 104px 1fr;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
    border-bottom: 1px solid var(--line-0);
  }
  .slot .select {
    height: 24px;
    font-size: var(--fs-xs);
  }
  .slot.jewel .sname {
    color: var(--fg-3);
  }
  .sname {
    font-size: var(--fs-xs);
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--line-0);
    font-size: var(--fs-sm);
  }
  .item:hover {
    background: var(--bg-2);
  }
  .item.sel {
    background: var(--bg-2);
    box-shadow: inset 2px 0 0 var(--fg-0);
  }
  .iname {
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: default;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .itag {
    font-size: var(--fs-2xs);
    white-space: nowrap;
  }
  .iops {
    display: inline-flex;
    gap: 4px;
    visibility: hidden;
  }
  .item:hover .iops {
    visibility: visible;
  }
  .mini {
    appearance: none;
    border: 1px solid var(--line-1);
    background: var(--bg-2);
    color: var(--fg-2);
    font-size: var(--fs-2xs);
    height: 18px;
    padding: 0 6px;
    cursor: pointer;
    border-radius: 3px;
  }
  .mini:hover {
    color: var(--fg-0);
  }
  .mini.x:hover {
    color: var(--bad);
  }
  .tabs2 {
    display: inline-flex;
    gap: 2px;
  }
  .t2 {
    appearance: none;
    border: 0;
    background: none;
    color: var(--fg-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .t2.on {
    color: var(--fg-0);
    background: var(--bg-active);
  }
  .dbbar {
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line-0);
  }
  .dbbar .input {
    flex: 1 1 120px;
    min-width: 90px;
  }
  .typesel {
    flex: 0 1 170px;
    min-width: 0;
    font-size: var(--fs-xs);
  }
  .modal {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--backdrop);
    z-index: 5;
  }
  .dialog {
    width: 560px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dialog .textarea {
    width: 100%;
  }
  .actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .err {
    color: var(--bad);
  }
  .small {
    font-size: var(--fs-xs);
  }
  .pad {
    padding: 10px 12px;
  }
  .detailpane {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .ttbox.plain {
    padding: 10px 12px;
    border: 1px solid var(--line-0);
    border-radius: var(--r-2);
    background: var(--bg-1);
    line-height: 1.45;
  }
  .tline {
    color: var(--fg-1);
    white-space: pre-wrap;
  }
  .tcenter {
    text-align: center;
  }
  .tsep {
    height: 1px;
    background: var(--line-1);
    margin: 6px 0;
  }
  .shape {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
  }
  .srow {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    padding: 2px 8px;
    font-size: var(--fs-xs);
    color: var(--fg-2);
    background: none;
    border: 1px solid var(--line-1);
    border-radius: var(--r-2);
    cursor: pointer;
  }
  .chip.on {
    color: var(--fg-0);
    border-color: var(--fg-2);
    background: var(--bg-active);
  }
  .cruc {
    align-items: flex-start;
  }
  .crucnodes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .crucsel {
    width: 100%;
    max-width: 440px;
  }
  .socks {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
  }
  .sock {
    display: inline-flex;
    align-items: center;
  }
  .sockc {
    width: 78px;
  }
  .link {
    padding: 0 2px;
    background: none;
    border: 0;
    color: var(--fg-4);
    cursor: pointer;
  }
  .link.on {
    color: var(--fg-0);
  }
  .craftsec {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .affix {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .affix .select {
    height: 24px;
    font-size: var(--fs-xs);
    width: 100%;
  }
  .range {
    width: 100%;
    accent-color: var(--fg-1);
    height: 14px;
  }
  .craftdlg {
    width: 460px;
  }
  .crow {
    display: grid;
    grid-template-columns: 64px 1fr;
    align-items: center;
    gap: 10px;
  }
  .clabel {
    font-size: var(--fs-xs);
    color: var(--fg-2);
    text-align: right;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--fg-2);
  }
</style>
