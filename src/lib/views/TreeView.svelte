<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { engine, poolStatus, powerScanParallel, readTreeJson, type JewelRadius, type MasteryEffect, type NodeCompare, type NodeTattoos, type PowerStat, type SocketedJewel, type Tooltip, type TreePower, type WeaponSetMode } from "$lib/engine.svelte";
  import { build } from "$lib/state/build.svelte";
  import { ui } from "$lib/state/ui.svelte";
  import { game } from "$lib/state/game.svelte";
  import { parseTree, withDynamicNodes, NodeIndex, type TEdge, type TreeModel, type TNode } from "$lib/tree/model";
  import { AssetStore } from "$lib/tree/assets";
  import PobText from "$lib/components/PobText.svelte";
  import PobTooltip from "$lib/components/PobTooltip.svelte";
  import { stripPobText } from "$lib/pobtext";
  import TimelessSearch from "$lib/components/TimelessSearch.svelte";
  import { m } from "$lib/paraglide/messages";

  let timelessOpen = $state(false);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let wrap = $state<HTMLDivElement | null>(null);
  let searchEl = $state<HTMLInputElement | null>(null);
  let model = $state.raw<TreeModel | null>(null);
  /** The static tree; `model` adds PoE1 cluster jewel subgraphs on top. */
  let baseModel: TreeModel | null = null;
  let dynKey = "";
  let assets: AssetStore | null = null;
  let assetsMissing = $state(false);
  let index: NodeIndex | null = null;
  let loadError = $state<string | null>(null);
  let jewelRadii: JewelRadius[] = [];

  // camera: world -> screen
  let cx = 0;
  let cy = 0;
  let scale = 0.12;
  let w = $state(0);
  let h = $state(0);
  let dpr = 1;

  let hover = $state<TNode | null>(null);
  // The socketed jewel's item tooltip, shown under the node tip while its socket is hovered.
  let jewelTip = $state<Tooltip | null>(null);
  let tipEl = $state<HTMLDivElement | null>(null);
  let tipW = $state(320);
  let tipH = $state(0);
  const jewelTipW = 540;
  const tipGap = 12;
  const jewelTipCache = new Map<string, Tooltip>();
  $effect(() => {
    const h = hover;
    const j = h?.kind === "socket" ? sockets.get(h.id) : undefined;
    if (!j) {
      jewelTip = null;
      return;
    }
    const key = `${build.rev}:${j.itemId}`;
    const cached = jewelTipCache.get(key);
    if (cached) {
      jewelTip = cached;
      return;
    }
    let live = true;
    engine
      .itemTooltip({ itemId: j.itemId })
      .then((r) => {
        jewelTipCache.set(key, r);
        if (live) jewelTip = r;
      })
      .catch(() => {
        if (live) jewelTip = null;
      });
    return () => {
      live = false;
    };
  });

  // PoB's node tooltip stat comparison: what allocating or removing the
  // hovered node does to the sidebar stats. Each one costs a recalculation,
  // so it waits for the pointer to settle and keeps what it has computed.
  let statDiff = $state<NodeCompare | null>(null);
  const statDiffCache = new Map<string, NodeCompare>();
  let statDiffRev = -1;
  $effect(() => {
    const h = hover;
    const rev = build.rev;
    const ws = wsMode;
    const path = shiftDown && trace.length ? trace.slice() : null;
    if (!ui.treeStatDiff || !h) {
      statDiff = null;
      return;
    }
    if (statDiffRev !== rev) {
      statDiffCache.clear();
      statDiffRev = rev;
    }
    const key = `${ws}:${h.id}:${path?.join(",") ?? ""}`;
    const cached = statDiffCache.get(key);
    if (cached) {
      statDiff = cached;
      return;
    }
    statDiff = null;
    let live = true;
    const timer = window.setTimeout(() => {
      engine
        .nodeCompare(h.id, { weaponSet: ws, path: path ?? undefined })
        .then((r) => {
          statDiffCache.set(key, r);
          if (live) statDiff = r;
        })
        .catch(() => {
          if (live) statDiff = null;
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });
  // Measured after every content change, so the intrinsic-sized tip stays inside the view.
  $effect(() => {
    hover;
    statDiff;
    w;
    tipW = tipEl?.offsetWidth ?? 320;
    tipH = tipEl?.offsetHeight ?? 0;
  });
  let hoverPath = $state<Set<number>>(new Set());
  let hoverDep = $state<Set<number>>(new Set());
  let hoverCost = $state<number | null>(null);
  let hoverBlocked = $state<string | null>(null);
  let mouse = $state({ x: 0, y: 0 });
  const tipPlacement = $derived.by(() => {
    const natural = Math.max(8, Math.min(mouse.x + 18, w - tipW - 8));
    if (!jewelTip || tipW + tipGap + jewelTipW > w - 16) return { node: natural, jewel: 8, showJewel: false };

    const pairW = tipW + tipGap + jewelTipW;
    const jewelRightNode = Math.max(8, Math.min(natural, w - pairW - 8));
    const jewelLeftNode = Math.max(8 + jewelTipW + tipGap, Math.min(natural, w - tipW - 8));
    return Math.abs(jewelRightNode - natural) <= Math.abs(jewelLeftNode - natural)
      ? { node: jewelRightNode, jewel: jewelRightNode + tipW + tipGap, showJewel: true }
      : { node: jewelLeftNode, jewel: jewelLeftNode - tipGap - jewelTipW, showJewel: true };
  });
  let search = $state("");
  let matches = $state<Set<number>>(new Set());

  // follow-ups requested by the engine's click handler
  let attrMenu = $state<{ id: number; x: number; y: number } | null>(null);
  let masteryMenu = $state<{ id: number; name: string; x: number; y: number; effects: MasteryEffect[]; selected: number | null } | null>(null);
  // PoE1 tattoos replace a node's modifier; reached by right-clicking the node.
  let tattooMenu = $state<{ id: number; x: number; y: number; info: NodeTattoos } | null>(null);
  let tattooLegacy = $state(false);

  async function openTattoos(id: number, x: number, y: number) {
    try {
      const info = await engine.nodeTattoos(id, tattooLegacy);
      if (info.available) tattooMenu = { id, x, y, info };
    } catch {
      /* the node takes none */
    }
  }

  async function pickTattoo(tattoo: string | null) {
    if (!tattooMenu) return;
    const id = tattooMenu.id;
    tattooMenu = null;
    await build.run(() => engine.setNodeTattoo(id, tattoo === null ? { remove: true } : { tattoo, legacy: tattooLegacy }));
  }
  let classConfirm = $state<{ id: number; className: string; ascendClassName: string | null } | null>(null);
  let urlPanel = $state<"import" | "export" | null>(null);
  let urlDraft = $state("");
  let renaming = $state(false);
  let renameDraft = $state("");

  // node power heat map (PoB "Show Node Power")
  let powerOn = $state(false);
  let power = $state.raw<TreePower | null>(null);
  let powerStat = $state<string | null>(null);
  let powerDepth = $state<number | null>(10);
  let powerStats = $state<PowerStat[]>([]);
  let powerBusy = $state(false);
  let powerProgress = $state(0);
  let powerNote = $state("");
  let showReport = $state(false);
  let powerKey = "";
  let powerRerun = false;

  const allocated = $derived(new Set(build.tree?.allocatedNodes ?? []));
  const weaponSets = $derived(
    new Map<number, number>([...(build.tree?.weaponSet1Nodes ?? []).map((id) => [id, 1] as const), ...(build.tree?.weaponSet2Nodes ?? []).map((id) => [id, 2] as const)]),
  );
  const wsMode = $derived<WeaponSetMode>(game.isPoe2 ? ui.treeWeaponSet : 0);
  const wsMax = $derived(build.info?.points.weaponSetMax ?? 0);
  const overrides = $derived(build.tree?.overrides ?? {});
  const sockets = $derived(new Map((build.tree?.sockets ?? []).map((s) => [s.nodeId, s])));

  // spec compare overlay (green = allocate to match, red = remove to match)
  let compareIdx = $state(0);
  let compareAlloc = $state<Set<number> | null>(null);

  // shift-hover path tracing (PoB's trace mode)
  let shiftDown = $state(false);
  let trace = $state<number[]>([]);

  // nodes inside a socketed jewel's radius, fetched lazily per socket
  const socketRadius = new Map<number, Set<number>>();
  const currentAsc = $derived(build.info?.ascendClassName && build.info.ascendClassName !== "None" ? build.info.ascendClassName : null);
  const currentClass = $derived(build.info?.className ?? null);
  const activeSpec = $derived(build.specs.find((s) => s.active) ?? null);

  let dirty = true;
  let raf = 0;
  const invalidate = () => {
    dirty = true;
    if (!raf) raf = requestAnimationFrame(frame);
  };
  // Jewel rings turn slowly while one is on screen; a timer, not every frame.
  const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let spinning = false;
  let spinTimer = 0;

  const palette = {
    bg: "#0b0b0c",
    edge: "#2a2a30",
    edgeAlloc: "#e6e6ea",
    edgePath: "#7f9dff",
    nodeFill: "#151518",
    nodeStroke: "#3b3b44",
    nodeAlloc: "#f2f2f4",
    search: "#e7b04e",
    bad: "#f06a6a",
  };
  function readPalette() {
    const cs = getComputedStyle(wrap ?? document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    palette.bg = v("--bg-0", palette.bg);
    palette.edge = v("--line-2", palette.edge);
    palette.edgeAlloc = v("--fg-0", palette.edgeAlloc);
    palette.edgePath = v("--focus", palette.edgePath);
    palette.nodeFill = v("--bg-2", palette.nodeFill);
    palette.nodeStroke = v("--line-2", palette.nodeStroke);
    palette.nodeAlloc = v("--fg-0", palette.nodeAlloc);
    palette.search = v("--warn", palette.search);
    palette.bad = v("--bad", palette.bad);
  }

  // Connector art approximated as two-tone strokes (widths in tree units),
  // sampled from PoB's Character_orbit_*.png line art.
  const LINE = {
    Normal: { outer: "#141210", inner: "#3a3122", ow: 12, iw: 3.5 },
    Intermediate: { outer: "#2e2a24", inner: "#9b917c", ow: 13, iw: 5 },
    Active: { outer: "#5d4717", inner: "#d9b256", ow: 14, iw: 7 },
    Set1Path: { outer: "#270004", inner: "#860010", ow: 13, iw: 5 },
    Set2Path: { outer: "#092a11", inner: "#1f913a", ow: 13, iw: 5 },
    Set1: { outer: "#500003", inner: "#bc000b", ow: 14, iw: 7 },
    Set2: { outer: "#12470a", inner: "#2bb228", ow: 14, iw: 7 },
    CompareGain: { outer: "#173d24", inner: "#67d38a", ow: 13, iw: 6 },
    CompareLoss: { outer: "#4a1616", inner: "#f06a6a", ow: 13, iw: 6 },
    Depend: { outer: "#4a1616", inner: "#f06a6a", ow: 14, iw: 7 },
  } as const;
  type LineState = keyof typeof LINE;
  // PoB's NEGATIVE and POSITIVE colour codes, which it multiplies into weapon set art.
  const SET_TINT = ["", "#dd0022", "#33ff77"];

  function toScreen(x: number, y: number): [number, number] {
    return [(x - cx) * scale + w / 2, (y - cy) * scale + h / 2];
  }
  function toWorld(sx: number, sy: number): [number, number] {
    return [(sx - w / 2) / scale + cx, (sy - h / 2) / scale + cy];
  }

  function nodeState(n: TNode, S: Scene): "alloc" | "path" | "unalloc" {
    if (S.alloc.has(n.id) || S.hover?.id === n.id) return "alloc";
    if (S.path.has(n.id)) return "path";
    return "unalloc";
  }

  /** PoB's heat-map colour: offence → red, defence → blue, both → green mix. */
  function powerColor(id: number, S: Scene): string | null {
    const pwr = S.heat;
    if (!pwr) return null;
    const pw = pwr.nodes[String(id)];
    if (!pw) return null;
    const curve = (v: number, max: number) => Math.min(1, Math.sqrt((Math.max(v, 0) / (max || 1)) * 1.5));
    let r = 0;
    let g = 0;
    let b = 0;
    if (pwr.stat) {
      r = curve(pw.s ?? 0, pwr.max.singleStat);
    } else {
      const dps = curve(pw.o ?? 0, pwr.max.offence);
      const def = curve(pw.d ?? 0, pwr.max.defence);
      const mix = (Math.max(dps - 0.5, 0) + Math.max(def - 0.5, 0)) / 2;
      r = dps;
      g = mix;
      b = def;
    }
    if (r + g + b < 0.05) return null;
    return `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},0.9)`;
  }

  async function computePower() {
    if (powerBusy) {
      powerRerun = true;
      return;
    }
    powerBusy = true;
    powerProgress = 0;
    powerNote = "";
    try {
      let scored = false;
      try {
        // worker pool: one call, all cores; the sequential builder remains the fallback
        const st = await poolStatus();
        if (st.size > 0) {
          const r = await powerScanParallel(powerStat, powerDepth);
          power = r.result;
          powerNote = m.tree_power_elapsed({ ms: Math.round(r.elapsed_ms), engines: Math.max(1, st.ready) });
          scored = true;
        }
      } catch (e) {
        console.warn("parallel power scan unavailable, using PowerBuilder", e);
      }
      if (!scored) {
        const t0 = performance.now();
        let r = await engine.treePowerStart(powerStat, powerDepth);
        while (!r.done) {
          r = await engine.treePowerStep(150);
          powerProgress = r.progress;
        }
        power = await engine.treePowerResult();
        powerNote = m.tree_power_elapsed_one({ ms: Math.round(performance.now() - t0) });
      }
      powerKey = `${powerStat}|${powerDepth}|${power!.rev}`;
    } catch (e) {
      build.error = String(e);
    } finally {
      powerBusy = false;
      invalidate();
      if (powerRerun) {
        powerRerun = false;
        computePower();
      }
    }
  }

  const reportRows = $derived.by(() => {
    if (!power || !model) return [];
    if (power.stat) {
      return power.report
        .filter((r) => !r.allocated && r.pathPower !== 0)
        .sort((a, b) => b.pathPower - a.pathPower)
        .slice(0, 60)
        .map((r) => ({ id: r.id, name: r.name, a: r.pathPowerStr, b: r.powerStr, dist: r.pathDist ?? 0 }));
    }
    const rows: { id: number; name: string; a: string; b: string; dist: number; score: number }[] = [];
    for (const [id, pw] of Object.entries(power.nodes)) {
      const n = model.nodes.get(Number(id));
      if (!n || allocated.has(n.id) || n.asc) continue;
      const dist = Math.max(pw.dist ?? 1, 1);
      const o = (pw.o ?? 0) * 100;
      const d = (pw.d ?? 0) * 100;
      if (o <= 0 && d <= 0) continue;
      rows.push({ id: n.id, name: n.name, a: `${(o / dist).toFixed(2)}%`, b: `${(d / dist).toFixed(2)}%`, dist, score: (o + d) / dist });
    }
    return rows.sort((x, y) => y.score - x.score).slice(0, 60);
  });

  function jumpTo(id: number) {
    const n = model?.nodes.get(id);
    if (!n) return;
    cx = n.x;
    cy = n.y;
    if (scale < 0.2) scale = 0.25;
    invalidate();
  }

  /** Enter in the search box: centre on the next match, nearest first. */
  let matchCursor = -1;
  function jumpToMatch() {
    if (!model || !matches.size) return;
    const ids = [...matches].sort((a, b) => {
      const na = model!.nodes.get(a)!;
      const nb = model!.nodes.get(b)!;
      return Math.hypot(na.x - cx, na.y - cy) - Math.hypot(nb.x - cx, nb.y - cy);
    });
    matchCursor = (matchCursor + 1) % ids.length;
    jumpTo(ids[matchCursor]);
  }

  function edgeState(a: TNode, b: TNode, S: Scene): LineState {
    const aa = S.alloc.has(a.id);
    const ab = S.alloc.has(b.id);
    if (S.dep.size && S.dep.has(a.id) && S.dep.has(b.id)) return "Depend";
    if (S.cmp) {
      const ca = S.cmp.has(a.id);
      const cb = S.cmp.has(b.id);
      if (ca && cb && !(aa && ab)) return "CompareGain";
      if (aa && ab && !(ca && cb)) return "CompareLoss";
    }
    const sa = S.ws.get(a.id) ?? 0;
    const sb = S.ws.get(b.id) ?? 0;
    if (promoted(a, S) && promoted(b, S)) return "Intermediate";
    if (aa && ab && (sa === 0 || sb === 0 || sa === sb)) {
      const set = a.asc ? 0 : sa || sb;
      return set === 1 ? "Set1" : set === 2 ? "Set2" : "Active";
    }
    if (S.path.size) {
      const q = (n: TNode, s: number) => n.id === S.hover?.id || S.path.has(n.id) || (S.alloc.has(n.id) && (s === 0 || s === S.mode));
      if (q(a, sa) && q(b, sb)) return a.asc || S.mode === 0 ? "Intermediate" : S.mode === 1 ? "Set1Path" : "Set2Path";
    }
    return "Normal";
  }

  /** A weapon set node that the hovered main tree allocation would move into the main tree. */
  function promoted(n: TNode, S: Scene): boolean {
    return S.mode === 0 && S.hover !== null && !S.alloc.has(S.hover.id) && S.path.has(n.id) && S.alloc.has(n.id) && S.ws.has(n.id);
  }

  /** The weapon set whose colour a node's frame takes (PassiveTreeView's allocModeColor), or 0. */
  function tintFor(n: TNode, S: Scene): number {
    if (S.heat || S.cmp || n.kind === "socket") return 0;
    if (S.path.has(n.id) && !S.alloc.has(n.id)) return n.asc || n.kind === "keystone" ? 0 : S.mode;
    return promoted(n, S) ? 0 : (S.ws.get(n.id) ?? 0);
  }

  function iconFor(n: TNode, S: Scene, isAlloc = false): string {
    return (S.ovAny ? S.ov[String(n.id)]?.icon : undefined) ?? ((isAlloc && n.activeIcon) || n.icon);
  }

  function frameFor(n: TNode, S: Scene, st: "alloc" | "path" | "unalloc"): string | null {
    const ov = S.ovAny ? S.ov[String(n.id)]?.overlay : undefined;
    return ov?.[st] ?? n.overlay?.[st] ?? null;
  }

  // Everything a frame reads from reactive state, read once: a signal read
  // per node per frame was a fifth of the frame time.
  interface Scene {
    alloc: Set<number>;
    ws: Map<number, number>;
    mode: WeaponSetMode;
    ov: typeof overrides;
    ovAny: boolean;
    sockets: typeof sockets;
    asc: string | null;
    cls: string | null;
    hover: TNode | null;
    path: Set<number>;
    dep: Set<number>;
    match: Set<number>;
    cmp: Set<number> | null;
    heat: TreePower | null;
    radii: JewelRadius[];
  }
  interface View {
    cx: number;
    cy: number;
    w: number;
    h: number;
  }
  const NO_IDS: Set<number> = new Set();
  function scene(): Scene {
    const ov = overrides;
    const ovAny = Object.keys(ov).length > 0;
    return {
      alloc: allocated,
      ws: weaponSets,
      mode: wsMode,
      ov: ovAny ? { ...ov } : ov,
      ovAny,
      sockets,
      asc: currentAsc,
      cls: currentClass,
      hover,
      path: hoverPath,
      dep: hoverDep,
      match: matches,
      cmp: compareAlloc,
      heat: powerOn && power !== null ? power : null,
      radii: jewelRadii,
    };
  }
  /** The scene as it looks with nothing hovered, which is what the layer holds. */
  function baseScene(S: Scene): Scene {
    if (S.hover === null && S.path.size === 0 && S.dep.size === 0) return S;
    return { ...S, hover: null, path: NO_IDS, dep: NO_IDS };
  }
  function viewMath(V: View) {
    const margin = 4000 * scale;
    const minX = V.cx - (V.w / 2 + margin) / scale;
    const maxX = V.cx + (V.w / 2 + margin) / scale;
    const minY = V.cy - (V.h / 2 + margin) / scale;
    const maxY = V.cy + (V.h / 2 + margin) / scale;
    const ox = V.w / 2 - V.cx * scale;
    const oy = V.h / 2 - V.cy * scale;
    return {
      tx: (x: number) => x * scale + ox,
      ty: (y: number) => y * scale + oy,
      toScreen: (x: number, y: number): [number, number] => [x * scale + ox, y * scale + oy],
      inView: (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY,
      near: (x: number, y: number, r: number) => x >= minX - r && x <= maxX + r && y >= minY - r && y <= maxY + r,
    };
  }

  // The tree without hover decoration is drawn into its own canvas and each
  // frame blits it, so panning, zooming and hovering cost one image copy
  // instead of thousands. Anything in the key changes the picture.
  let layer: {
    below: HTMLCanvasElement;
    belowCtx: CanvasRenderingContext2D;
    nodes: HTMLCanvasElement;
    nodesCtx: CanvasRenderingContext2D;
    cx: number;
    cy: number;
    w: number;
    h: number;
    scale: number;
    key: unknown[];
  } | null = null;
  let assetsGen = 0;
  let zooming = false;
  let zoomTimer = 0;
  // Blitting the layer magnified past this looks soft, so it re-renders.
  const ZOOM_BAND = 1.7;
  function layerKey(S: Scene): unknown[] {
    return [dpr, w, h, model, assetsGen, S.alloc, S.ws, overrides, S.sockets, S.asc, S.cls, S.match, S.cmp, S.heat];
  }
  function layerUsable(S: Scene): boolean {
    const L = layer;
    if (!L) return false;
    const k = layerKey(S);
    if (k.length !== L.key.length || k.some((v, i) => v !== L.key[i])) return false;
    const z = scale / L.scale;
    if (z !== 1 && (!zooming || z < 1 / ZOOM_BAND || z > ZOOM_BAND)) return false;
    return Math.abs(cx - L.cx) + w / 2 / scale <= L.w / 2 / L.scale && Math.abs(cy - L.cy) + h / 2 / scale <= L.h / 2 / L.scale;
  }
  function renderLayer(S: Scene) {
    // Only a pan or a zoom needs room around the view; a settled view renders
    // what it shows, so allocating a node repaints one screen and not four.
    // The margin is in device pixels across two canvases, so a dense display
    // trades a little of it back rather than holding a hundred megabytes.
    const pad = drag?.moved || zooming;
    const lw = w + (pad ? 2 * Math.round(Math.min(w / 2, 900) / dpr) : 0);
    const lh = h + (pad ? 2 * Math.round(Math.min(h / 2, 700) / dpr) : 0);
    if (!layer) {
      const below = document.createElement("canvas");
      const nodes = document.createElement("canvas");
      layer = { below, belowCtx: below.getContext("2d")!, nodes, nodesCtx: nodes.getContext("2d")!, cx: 0, cy: 0, w: 0, h: 0, scale: 1, key: [] };
    }
    const pw = Math.floor(lw * dpr);
    const ph = Math.floor(lh * dpr);
    for (const c of [layer.below, layer.nodes]) {
      if (c.width !== pw || c.height !== ph) {
        c.width = pw;
        c.height = ph;
      }
    }
    const B = baseScene(S);
    const LV: View = { cx, cy, w: lw, h: lh };
    layer.belowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBelow(layer.belowCtx, B, LV);
    layer.nodesCtx.setTransform(1, 0, 0, 1, 0, 0);
    layer.nodesCtx.clearRect(0, 0, pw, ph);
    layer.nodesCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawNodes(layer.nodesCtx, B, LV);
    layer.cx = cx;
    layer.cy = cy;
    layer.w = lw;
    layer.h = lh;
    layer.scale = scale;
    layer.key = layerKey(S);
  }

  function frame() {
    raf = 0;
    if (!dirty || !canvas || !model) return;
    dirty = false;
    spinning = false;
    queueMicrotask(() => {
      if (!spinning || !animate || spinTimer) return;
      spinTimer = window.setTimeout(() => {
        spinTimer = 0;
        invalidate();
      }, 50);
    });
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = scene();
    const V: View = { cx, cy, w, h };
    if (!layerUsable(S)) renderLayer(S);
    const L = layer!;
    const z = scale / L.scale;
    const dw = L.w * z;
    const dh = L.h * z;
    const dx = (L.cx - cx) * scale + (w - dw) / 2;
    const dy = (L.cy - cy) * scale + (h - dh) / 2;
    const H = hoverParts(S, V);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(L.below, 0, 0, L.below.width, L.below.height, dx, dy, dw, dh);
    if (H) drawHoverEdges(ctx, V, H);
    ctx.drawImage(L.nodes, 0, 0, L.nodes.width, L.nodes.height, dx, dy, dw, dh);
    if (H) drawHoverNodes(ctx, S, V, H);
    drawRings(ctx, S, V);
  }

  const EDGE_ORDER = ["Normal", "Intermediate", "Set1Path", "Set2Path", "Active", "Set1", "Set2", "CompareGain", "CompareLoss", "Depend"] as const;
  const EDGE_INDEX = Object.fromEntries(EDGE_ORDER.map((s, i) => [s, i])) as Record<LineState, number>;
  const edgeBuckets: TEdge[][] = Array.from({ length: EDGE_ORDER.length * 2 }, () => [] as TEdge[]);
  // Below this many pixels the frame art is a smudge, so the nodes are drawn
  // as rings in one batched stroke per state instead of an image apiece.
  const DOT_PX = 3;
  // The average colour of PoB's frame art at a couple of pixels across, by
  // state and by node size, so a dot reads the same as the art it replaces.
  const DOT_FILL = ["#caa371", "#806650", "#454139", "#bc9b64", "#a0754d", "#716248", "#af000f", "#28a335"];
  const dots: number[][] = DOT_FILL.map(() => []);
  function dotBucket(n: TNode, st: "alloc" | "path" | "unalloc", tint = 0): number {
    if (tint) return 5 + tint;
    const big = n.kind === "notable" || n.kind === "keystone" || n.kind === "socket";
    return (big ? 3 : 0) + (st === "alloc" ? 0 : st === "path" ? 1 : 2);
  }

  function strokeEdges(ctx: CanvasRenderingContext2D, M: TreeModel, list: TEdge[], st: LineState, dim: boolean, tx: (x: number) => number, ty: (y: number) => number) {
    const style = LINE[st];
    ctx.beginPath();
    for (const e of list) {
      const a = M.nodes.get(e.a)!;
      const b = M.nodes.get(e.b)!;
      ctx.moveTo(tx(a.x), ty(a.y));
      if (e.arc) ctx.arc(tx(e.arc.cx), ty(e.arc.cy), e.arc.r * scale, e.arc.a1, e.arc.a2, e.arc.ccw);
      else ctx.lineTo(tx(b.x), ty(b.y));
    }
    ctx.globalAlpha = dim ? 0.45 : 1;
    ctx.strokeStyle = style.outer;
    ctx.lineWidth = Math.max(1.2, style.ow * scale);
    ctx.stroke();
    ctx.strokeStyle = style.inner;
    ctx.lineWidth = Math.max(0.6, style.iw * scale);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  let edgeBy: { model: TreeModel; map: Map<number, TEdge[]> } | null = null;
  function edgeLookup(M: TreeModel): Map<number, TEdge[]> {
    if (edgeBy?.model === M) return edgeBy.map;
    const map = new Map<number, TEdge[]>();
    for (const e of M.edges) {
      let la = map.get(e.a);
      if (!la) map.set(e.a, (la = []));
      la.push(e);
      let lb = map.get(e.b);
      if (!lb) map.set(e.b, (lb = []));
      lb.push(e);
    }
    edgeBy = { model: M, map };
    return map;
  }

  // The backdrop is fixed to the canvas, so it is tiled once and stamped.
  let backdrop: { canvas: HTMLCanvasElement; gen: number; dpr: number } | null = null;
  const BACKDROP = 1000;
  function drawBackdrop(ctx: CanvasRenderingContext2D, bw: number, bh: number) {
    const A = assets;
    if (!A) return;
    if (!backdrop || backdrop.gen !== assetsGen || backdrop.dpr !== dpr) {
      const c = backdrop?.canvas ?? document.createElement("canvas");
      c.width = Math.floor(BACKDROP * dpr);
      c.height = Math.floor(BACKDROP * dpr);
      const bctx = c.getContext("2d")!;
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!A.tile(bctx, "Background2", BACKDROP, BACKDROP, 100)) return;
      backdrop = { canvas: c, gen: assetsGen, dpr };
    }
    for (let y = 0; y < bh; y += BACKDROP) {
      for (let x = 0; x < bw; x += BACKDROP) {
        ctx.drawImage(backdrop.canvas, 0, 0, backdrop.canvas.width, backdrop.canvas.height, x, y, BACKDROP, BACKDROP);
      }
    }
  }

  function drawBelow(ctx: CanvasRenderingContext2D, S: Scene, V: View) {
    const M = model;
    if (!M) return;
    const { tx, ty, toScreen, inView, near } = viewMath(V);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, V.w, V.h);

    const A = assets;

    // --- background tile ---
    drawBackdrop(ctx, V.w, V.h);

    // --- PoE1: class illustration, group rings, inactive class starts ---
    if (A && M.poe1) {
      const store = A;
      // PoB's DrawAsset: half extents are the sheet size × 1.33 tree units.
      const drawArt = (name: string, x: number, y: number, mirrored = false) => {
        const r = store.rect(name);
        if (!r) return;
        const [sx, sy] = toScreen(x, y);
        const hw = r.w * 1.33 * scale;
        const hh = r.h * 1.33 * scale;
        if (!mirrored) {
          store.draw(ctx, name, sx, sy, hw, hh);
          return;
        }
        store.draw(ctx, name, sx, sy - hh, hw, hh);
        ctx.save();
        ctx.translate(sx, sy + hh);
        ctx.scale(1, -1);
        store.draw(ctx, name, 0, 0, hw, hh);
        ctx.restore();
      };
      const cls = M.classes.find((c) => c.name === S.cls);
      if (cls?.area && near(cls.area.x, cls.area.y, 2000)) drawArt(cls.area.bg, cls.area.x, cls.area.y);
      for (const g of M.groups) {
        if (near(g.x, g.y, 400)) drawArt(g.bg, g.x, g.y, g.mirrored);
      }
      for (const c of M.classes) {
        if (c.name === S.cls || c.startNode == null || !near(c.bgX, c.bgY, 400)) continue;
        drawArt("PSStartNodeBackgroundInactive", c.bgX, c.bgY);
      }
    }

    // --- class hub and ascendancy backgrounds ---
    if (A) {
      const cls = M.classes.find((c) => c.name === S.cls);
      if (cls && cls.bg) {
        const [bx, by] = toScreen(cls.bgX, cls.bgY);
        const ascBg = S.asc && cls.hubAsc ? cls.ascendancies.find((a) => a.name === S.asc)?.bg : null;
        A.draw(ctx, ascBg ?? cls.bg, bx, by, cls.bgHalf * scale, cls.bgHalf * scale);
        const start = cls.startNode != null ? M.nodes.get(cls.startNode) : null;
        if (start) {
          const ang = Math.PI / 2 + Math.atan2(start.y - cls.bgY, start.x - cls.bgX);
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(ang);
          A.draw(ctx, "BGTreeActive", 0, 0, cls.activeHalf * scale, cls.activeHalf * scale);
          ctx.restore();
        }
        A.draw(ctx, "BGTree", bx, by, cls.ringHalf * scale, cls.ringHalf * scale);
      }
      // A variant plate (Abyssal Lich) covers its base (Lich) only while chosen.
      const curAscId = M.classes.flatMap((c) => c.ascendancies).find((a) => a.name === S.asc)?.id ?? S.asc;
      for (const c of M.classes) {
        for (const a of c.ascendancies) {
          if (!inView(a.x, a.y)) continue;
          if (a.replaceBy && (a.replaceBy === curAscId || a.replaceBy === S.asc)) continue;
          if (a.replace && a.name !== S.asc && a.id !== curAscId) continue;
          const [ax, ay] = toScreen(a.x, a.y);
          ctx.globalAlpha = a.name === S.asc ? 1 : 0.45;
          A.draw(ctx, a.bg, ax, ay, a.half * scale, a.half * scale);
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- node glows: mastery and tattoo effects sit under the connectors (PoB layer 15) ---
    if (A && scale > 0.045 && S.heat === null) {
      for (const n of M.nodes.values()) {
        if (n.hidden || n.kind === "classStart" || n.kind === "onlyImage" || !inView(n.x, n.y)) continue;
        const ov = S.ov[String(n.id)];
        const effect = ov?.effect ?? n.effect;
        if (!effect) continue;
        let half = n.size.effect * scale;
        if (ov?.effect) {
          const r = A.rect(ov.effect);
          if (!r) continue;
          half = r.w * 1.33 * scale;
        } else if (n.size.effect <= 0) continue;
        const lit = !!ov?.effect || S.alloc.has(n.id) || S.path.has(n.id);
        const dimAsc = n.asc !== null && n.asc !== S.asc;
        const sx = tx(n.x);
        const sy = ty(n.y);
        ctx.globalAlpha = (lit ? 1 : 0.15) * (dimAsc ? 0.6 : 1);
        A.draw(ctx, effect, sx, sy, half, half);
      }
      ctx.globalAlpha = 1;
    }

    // --- connectors, batched per state ---
    ctx.lineCap = "round";
    for (const b of edgeBuckets) b.length = 0;
    for (const e of M.edges) {
      const a = M.nodes.get(e.a)!;
      const b = M.nodes.get(e.b)!;
      if (!inView(a.x, a.y) && !inView(b.x, b.y)) continue;
      const dim = e.asc !== null && e.asc !== S.asc;
      edgeBuckets[EDGE_INDEX[edgeState(a, b, S)] * 2 + (dim ? 1 : 0)].push(e);
    }
    for (let i = 0; i < EDGE_ORDER.length; i++) {
      for (let d = 1; d >= 0; d--) {
        const list = edgeBuckets[i * 2 + d];
        if (list.length) strokeEdges(ctx, M, list, EDGE_ORDER[i], d === 1, tx, ty);
      }
    }
  }

  // The nodes are their own layer so a highlighted connector can be painted
  // between the two and still pass behind the node art, as PoB draws it.
  function drawNodes(ctx: CanvasRenderingContext2D, S: Scene, V: View) {
    const M = model;
    if (!M) return;
    const A = assets;
    const { tx, ty, inView } = viewMath(V);
    const drawEffects = scale > 0.045;
    const drawIcons = scale > 0.03;
    const heat = S.heat !== null;
    const hoverJewel = S.hover?.kind === "socket" ? S.sockets.get(S.hover.id) : undefined;
    const hoverSocketSet = hoverJewel?.radiusIndex ? (socketRadius.get(S.hover!.id) ?? null) : null;
    const hoverSocketColor = hoverJewel?.radiusIndex ? pobColor(S.radii[hoverJewel.radiusIndex - 1]?.color ?? "") : palette.search;
    for (const d of dots) d.length = 0;
    for (const n of M.nodes.values()) {
      if (n.hidden || n.kind === "classStart") continue;
      if (!inView(n.x, n.y)) continue;
      const sx = tx(n.x);
      const sy = ty(n.y);
      const isAlloc = S.alloc.has(n.id);
      const st = heat ? "alloc" : nodeState(n, S);
      const onPath = S.path.has(n.id);
      const dimAsc = n.asc !== null && n.asc !== S.asc;

      if (!A) {
        drawFallback(ctx, n, sx, sy, isAlloc, onPath, S.hover?.id === n.id);
        continue;
      }
      // With art available, a not-yet-loaded sheet just leaves a gap for a
      // frame or two (the store repaints on load) instead of flashing wireframe.

      if (n.kind === "onlyImage") {
        if (drawEffects && n.effect) {
          ctx.globalAlpha = 0.15;
          A.draw(ctx, n.effect, sx, sy, n.size.base * scale, n.size.base * scale);
          ctx.globalAlpha = 1;
        }
        continue;
      }

      if (n.kind === "ascStart") {
        ctx.globalAlpha = n.asc === S.asc ? 1 : 0.5;
        A.draw(ctx, n.overlay?.unalloc ?? "AscendancyMiddle", sx, sy, n.size.overlay * scale, n.size.overlay * scale);
        ctx.globalAlpha = 1;
        continue;
      }

      ctx.globalAlpha = dimAsc ? 0.6 : 1;

      if (heat && !isAlloc) {
        const col = powerColor(n.id, S);
        if (col) {
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max((n.size.overlay || n.size.base) * scale * 0.95, 2.5), 0, Math.PI * 2);
          ctx.fillStyle = col;
          ctx.fill();
        }
      }

      if (n.kind === "socket") {
        const half = n.size.base * scale;
        if (half < DOT_PX) {
          if (!heat || isAlloc) dots[dotBucket(n, st)].push(sx, sy, half);
        } else {
          const frameName = frameFor(n, S, st);
          if (frameName) A.draw(ctx, frameName, sx, sy, half, half);
          const jewel = S.sockets.get(n.id);
          if (jewel && isAlloc) {
            const art = socketArt(jewel.baseName, n.overlay?.alloc === "JewelSocketAltActive") ?? (jewel.title && A.has(jewel.title) ? jewel.title : jewel.baseName);
            if (art) A.draw(ctx, art, sx, sy, n.size.overlay * scale, n.size.overlay * scale);
          }
        }
      } else {
        if (drawIcons && n.size.base > 0) {
          const icon = iconFor(n, S, isAlloc);
          if (!isAlloc && !heat) ctx.globalAlpha *= 0.7;
          A.draw(ctx, icon, sx, sy, n.size.base * scale, n.size.base * scale, !isAlloc && !heat);
          ctx.globalAlpha = dimAsc ? 0.6 : 1;
        }
        const half = n.size.overlay * scale;
        const tint = tintFor(n, S);
        if (half < DOT_PX) {
          if (n.size.overlay > 0 && (!heat || isAlloc)) dots[dotBucket(n, st, tint)].push(sx, sy, half);
        } else {
          const frameName = frameFor(n, S, st);
          if (frameName && n.size.overlay > 0) {
            if (tint) A.drawTinted(ctx, frameName, sx, sy, half, half, SET_TINT[tint]);
            else A.draw(ctx, frameName, sx, sy, half, half);
          }
        }
      }
      ctx.globalAlpha = 1;

      if (S.dep.has(n.id) && S.hover?.id !== n.id) {
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(n.r * scale, 3), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(240,106,106,0.35)";
        ctx.fill();
      }
      if (S.match.has(n.id)) {
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(n.r, 30) * scale + 6, 0, Math.PI * 2);
        ctx.strokeStyle = palette.search;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (S.cmp) {
        const ca = S.cmp.has(n.id);
        if (ca !== isAlloc) {
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(n.r, 30) * scale + 4, 0, Math.PI * 2);
          ctx.strokeStyle = ca ? "#67d38a" : "#f06a6a";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      if (hoverSocketSet?.has(n.id)) {
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(n.r, 30) * scale + 5, 0, Math.PI * 2);
        ctx.strokeStyle = hoverSocketColor;
        ctx.lineWidth = 1.75;
        ctx.stroke();
      }
    }

    for (let i = 0; i < dots.length; i++) {
      const list = dots[i];
      if (!list.length) continue;
      ctx.beginPath();
      for (let j = 0; j < list.length; j += 3) {
        const r = Math.max(list[j + 2] * 0.75, 0.5);
        ctx.moveTo(list[j] + r, list[j + 1]);
        ctx.arc(list[j], list[j + 1], r, 0, Math.PI * 2);
      }
      ctx.strokeStyle = DOT_FILL[i];
      ctx.lineWidth = Math.max(list[2] * 0.5, 0.7);
      ctx.stroke();
    }
  }

  // Only the hover highlight changes as the pointer moves, so it is painted
  // over the layers rather than redrawing the tree: the connectors it restates,
  // then the nodes it restyles, the dependency marks and the radius rings.
  interface Hover {
    hot: Set<number>;
    edges: TEdge[][];
    socketSet: Set<number> | null;
    socketColor: string;
    base: Scene;
  }
  function hoverParts(S: Scene, V: View): Hover | null {
    const M = model;
    if (!M) return null;
    const hoverJewel = S.hover?.kind === "socket" ? S.sockets.get(S.hover.id) : undefined;
    const socketSet = hoverJewel?.radiusIndex ? (socketRadius.get(S.hover!.id) ?? null) : null;
    if (!S.hover && S.path.size === 0 && S.dep.size === 0 && !socketSet) return null;
    const base = baseScene(S);
    const { inView } = viewMath(V);

    const hot = new Set<number>(S.path);
    for (const id of S.dep) hot.add(id);
    if (S.hover) hot.add(S.hover.id);

    const edges: TEdge[][] = Array.from({ length: EDGE_ORDER.length * 2 }, () => [] as TEdge[]);
    const seen = new Set<TEdge>();
    const byNode = edgeLookup(M);
    for (const id of hot) {
      const list = byNode.get(id);
      if (!list) continue;
      for (const e of list) {
        if (seen.has(e)) continue;
        seen.add(e);
        const a = M.nodes.get(e.a);
        const b = M.nodes.get(e.b);
        if (!a || !b || (!inView(a.x, a.y) && !inView(b.x, b.y))) continue;
        const st = edgeState(a, b, S);
        if (st === edgeState(a, b, base)) continue;
        edges[EDGE_INDEX[st] * 2 + (e.asc !== null && e.asc !== S.asc ? 1 : 0)].push(e);
      }
    }
    const socketColor = hoverJewel?.radiusIndex ? pobColor(S.radii[hoverJewel.radiusIndex - 1]?.color ?? "") : palette.search;
    return { hot, edges, socketSet, socketColor, base };
  }

  function drawHoverEdges(ctx: CanvasRenderingContext2D, V: View, H: Hover) {
    const M = model;
    if (!M) return;
    const { tx, ty } = viewMath(V);
    ctx.lineCap = "round";
    for (let i = 0; i < EDGE_ORDER.length; i++) {
      for (let d = 1; d >= 0; d--) {
        const list = H.edges[i * 2 + d];
        if (list.length) strokeEdges(ctx, M, list, EDGE_ORDER[i], d === 1, tx, ty);
      }
    }
  }

  function drawHoverNodes(ctx: CanvasRenderingContext2D, S: Scene, V: View, H: Hover) {
    const M = model;
    if (!M) return;
    const { tx, ty, inView } = viewMath(V);
    const A = assets;
    const heat = S.heat !== null;
    const B = H.base;
    for (const id of H.hot) {
      const n = M.nodes.get(id);
      if (!n || n.hidden || n.kind === "classStart" || n.kind === "onlyImage" || n.kind === "ascStart") continue;
      if (!inView(n.x, n.y)) continue;
      const sx = tx(n.x);
      const sy = ty(n.y);
      const isAlloc = S.alloc.has(n.id);
      if (!A) {
        drawFallback(ctx, n, sx, sy, isAlloc, S.path.has(n.id), S.hover?.id === n.id);
      } else if (!heat) {
        const st = nodeState(n, S);
        const half = (n.kind === "socket" ? n.size.base : n.size.overlay) * scale;
        const tint = tintFor(n, S);
        if ((st !== nodeState(n, B) || tint !== tintFor(n, B)) && half > 0) {
          ctx.globalAlpha = n.asc !== null && n.asc !== S.asc ? 0.6 : 1;
          if (half < DOT_PX) {
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(half * 0.75, 0.5), 0, Math.PI * 2);
            ctx.strokeStyle = DOT_FILL[dotBucket(n, st, tint)];
            ctx.lineWidth = Math.max(half * 0.5, 0.7);
            ctx.stroke();
          } else {
            const frameName = frameFor(n, S, st);
            if (frameName && tint) A.drawTinted(ctx, frameName, sx, sy, half, half, SET_TINT[tint]);
            else if (frameName) A.draw(ctx, frameName, sx, sy, half, half);
          }
          ctx.globalAlpha = 1;
        }
      }
      if (S.dep.has(n.id) && S.hover?.id !== n.id) {
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(n.r * scale, 3), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(240,106,106,0.35)";
        ctx.fill();
      }
    }

    if (H.socketSet) {
      ctx.strokeStyle = H.socketColor;
      ctx.lineWidth = 1.75;
      for (const id of H.socketSet) {
        const n = M.nodes.get(id);
        if (!n || !inView(n.x, n.y)) continue;
        ctx.beginPath();
        ctx.arc(tx(n.x), ty(n.y), Math.max(n.r, 30) * scale + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawRings(ctx: CanvasRenderingContext2D, S: Scene, V: View) {
    const { tx, ty, toScreen, inView } = viewMath(V);
    const A = assets;
    if (!model) return;
    const M = model;
    // --- jewel radius rings ---
    const ring = (x: number, y: number, rad: JewelRadius, color: string, alpha: number, width: number) => {
      ctx.beginPath();
      ctx.arc(x, y, rad.outer * scale, 0, Math.PI * 2);
      if (rad.inner) {
        ctx.moveTo(x + rad.inner * scale, y);
        ctx.arc(x, y, rad.inner * scale, 0, Math.PI * 2);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    if (S.radii.length) {
      // Allocated S.sockets with a jewel show their radius persistently: PoB's
      // shaded rings, or a timeless jewel's own pair, turning slowly against
      // each other (DrawImageRotated: angle × ms × 0.00003).
      const t = animate ? performance.now() * 0.00003 : 0;
      const spin = (name: string, sx: number, sy: number, half: number, speed: number) => {
        if (!A || half <= 0) return false;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(speed * t);
        const ok = A.draw(ctx, name, 0, 0, half, half);
        ctx.restore();
        return ok;
      };
      // From Nothing and Impossible Escape put their ring on the keystones they
      // name, not on their socket (PassiveTreeView.drawJewelRadius). Null means
      // an ordinary jewel, or one whose keystones this tree does not carry, and
      // either way the ring falls back to the socket.
      const keystoneCenters = (j: SocketedJewel): { x: number; y: number }[] | null => {
        if (!j.radiusKeystones?.length) return null;
        const out: { x: number; y: number }[] = [];
        for (const kid of j.radiusKeystones) {
          const k = M.nodes.get(kid);
          if (k) out.push({ x: k.x, y: k.y });
        }
        return out.length ? out : null;
      };
      // Their inner edge is a fixed 150 tree units, without the 1.06 stretch
      // every other jewel's inner ring gets.
      const KEYSTONE_INNER = 150;
      for (const [nodeId, j] of S.sockets) {
        if (!j.radiusIndex || !S.alloc.has(nodeId) || S.hover?.id === nodeId) continue;
        const rad = S.radii[j.radiusIndex - 1];
        if (!rad) continue;
        let centers = keystoneCenters(j);
        const onKeystone = centers !== null;
        if (!centers) {
          const n = model.nodes.get(nodeId);
          if (!n) continue;
          centers = [n];
        }
        const inner = (onKeystone ? KEYSTONE_INNER : rad.inner * 1.06) * scale;
        const radius = onKeystone ? { ...rad, inner: KEYSTONE_INNER } : rad;
        const rings = timelessRings(j);
        for (const c of centers) {
          if (!inView(c.x, c.y)) continue;
          const sx = tx(c.x);
          const sy = ty(c.y);
          const outer = rad.outer * scale;
          let drew: boolean;
          if (rings) {
            drew = spin(rings[0], sx, sy, outer, -0.7);
            spin(rings[1], sx, sy, outer, 0.7);
          } else if (A?.has("ShadedOuterRing")) {
            drew = spin("ShadedOuterRing", sx, sy, outer, -0.7);
            spin("ShadedOuterRingFlipped", sx, sy, outer, 0.7);
            spin("ShadedInnerRing", sx, sy, inner, -0.7);
            spin("ShadedInnerRingFlipped", sx, sy, inner, 0.7);
          } else {
            drew = false;
          }
          if (drew) spinning = true;
          else ring(sx, sy, radius, "#e6e6ea", 0.25, 1);
        }
      }
      // Hovered socket: the socketed jewel's radius, or every radius when empty.
      if (S.hover?.kind === "socket") {
        const socketed = S.sockets.get(S.hover.id);
        const own = socketed?.radiusIndex ? S.radii[socketed.radiusIndex - 1] : null;
        if (own) {
          const keystones = keystoneCenters(socketed!);
          const centers = keystones ?? [{ x: S.hover.x, y: S.hover.y }];
          const rad = keystones ? { ...own, inner: KEYSTONE_INNER } : own;
          for (const c of centers) {
            const [cx, cy] = toScreen(c.x, c.y);
            ring(cx, cy, rad, pobColor(own.color), 0.9, 1.5);
          }
        } else {
          const [sx, sy] = toScreen(S.hover.x, S.hover.y);
          const variable = socketed?.radiusLabel === "Variable";
          for (const r of S.radii) {
            if (variable ? r.inner === 0 : r.inner !== 0) continue;
            ring(sx, sy, r, pobColor(r.color), 0.8, 1.25);
          }
        }
      }
    }
  }

  /** PoB's GetJewelSocketOverlay: the art a socketed jewel puts in its socket, by base. */
  function socketArt(base: string | null, expansion: boolean): string | null {
    if (!base) return null;
    const alt = expansion ? "Alt" : "";
    switch (base) {
      case "Crimson Jewel":
        return `JewelSocketActiveRed${alt}`;
      case "Viridian Jewel":
        return `JewelSocketActiveGreen${alt}`;
      case "Cobalt Jewel":
        return `JewelSocketActiveBlue${alt}`;
      case "Prismatic Jewel":
        return `JewelSocketActivePrismatic${alt}`;
      case "Timeless Jewel":
        return `JewelSocketActiveLegion${alt}`;
      case "Large Cluster Jewel":
        return "JewelSocketActiveAltPurple";
      case "Medium Cluster Jewel":
        return "JewelSocketActiveAltBlue";
      case "Small Cluster Jewel":
        return "JewelSocketActiveAltRed";
      case "Ursine Charm":
        return "CharmSocketActiveStr";
      case "Corvine Charm":
        return "CharmSocketActiveInt";
      case "Lupine Charm":
        return "CharmSocketActiveDex";
    }
    if (base.endsWith("Eye Jewel")) return `JewelSocketActiveAbyss${alt}`;
    return null;
  }

  /** A timeless jewel's legion when PoB did not say: PoE1's titles are fixed per legion. */
  function conquerorOf(title: string | null): string | null {
    if (!title) return null;
    if (title.startsWith("Glorious Vanity")) return "vaal";
    if (title.startsWith("Lethal Pride")) return "karui";
    if (title.startsWith("Brutal Restraint")) return "maraketh";
    if (title.startsWith("Militant Faith")) return "templar";
    if (title.startsWith("Elegant Hubris")) return "eternal";
    if (title.startsWith("Heroic Tragedy")) return "kalguur";
    return null;
  }

  /** The ring pair a timeless-style jewel draws instead of the shaded rings, in either game's asset naming. */
  function timelessRings(j: SocketedJewel): [string, string] | null {
    const c = j.conqueror ?? conquerorOf(j.title);
    if (!c || !assets) return null;
    const A = assets;
    const poe1: Record<string, string> = { vaal: "Vaal", karui: "Karui", maraketh: "Maraketh", templar: "Templar", eternal: "EternalEmpire", kalguur: "Kalguuran" };
    const p1 = poe1[c];
    if (p1 && A.has(`${p1}JewelCircle1`)) return [`${p1}JewelCircle1`, `${p1}JewelCircle2`];
    const dir = "art/textures/interface/2d/2dart/uiimages/ingame/";
    if (c.startsWith("abyss")) {
      const one = `${dir}abyss/abysspassiveskillscreenjewelcircle1.dds`;
      return A.has(one) ? [one, one] : null;
    }
    for (const p2 of [c, c === "kalguur" ? "kalguuran" : c === "eternal" ? "eternalempire" : c]) {
      const one = `${dir}passiveskillscreen${p2}jewelcircle1.dds`;
      if (A.has(one)) return [one, `${dir}passiveskillscreen${p2}jewelcircle2.dds`];
    }
    return null;
  }

  function pobColor(code: string): string {
    const hit = /\^x([0-9a-fA-F]{6})/.exec(code);
    return hit ? `#${hit[1]}` : palette.search;
  }

  function drawFallback(ctx: CanvasRenderingContext2D, n: TNode, sx: number, sy: number, isAlloc: boolean, onPath: boolean, isHover: boolean) {
    const r = Math.max((n.size.overlay || n.size.base || 30) * 0.5 * scale, 1.2);
    ctx.beginPath();
    if (n.kind === "keystone") {
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r, sy);
      ctx.closePath();
    } else if (n.kind === "socket") {
      ctx.rect(sx - r * 0.8, sy - r * 0.8, r * 1.6, r * 1.6);
    } else {
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = isAlloc ? palette.nodeAlloc : onPath ? "#1d2436" : palette.nodeFill;
    ctx.fill();
    ctx.lineWidth = isHover ? 2 : 1;
    ctx.strokeStyle = isHover || onPath ? palette.edgePath : isAlloc ? "#ffffff" : palette.nodeStroke;
    ctx.stroke();
  }

  function resize() {
    if (!canvas || !wrap) return;
    dpr = window.devicePixelRatio || 1;
    w = wrap.clientWidth;
    h = wrap.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    invalidate();
  }

  function focusClass() {
    if (!model) return;
    const id = currentClass ? model.classStart.get(currentClass) : undefined;
    const n = id != null ? model.nodes.get(id) : undefined;
    if (n) {
      cx = n.x;
      cy = n.y;
      scale = 0.13;
    } else {
      fitAll();
    }
    invalidate();
  }

  /** Centre on the current ascendancy ring, where its nodes live, far from the class start. */
  function focusAscendancy() {
    if (!model || !currentAsc) return;
    const asc = model.classes.flatMap((c) => c.ascendancies).find((a) => a.name === currentAsc);
    if (!asc) return;
    cx = asc.x;
    cy = asc.y;
    scale = Math.min(1.2, (Math.min(w, h) / (asc.half * 2)) * 0.85);
    invalidate();
  }

  $effect(() => {
    if (!build.ascendancyFocus || !model || !w) return;
    build.ascendancyFocus = false;
    focusAscendancy();
  });

  function fitAll() {
    if (!model) return;
    const b = model.bounds;
    cx = (b.minX + b.maxX) / 2;
    cy = (b.minY + b.maxY) / 2;
    scale = Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY)) * 0.95;
    invalidate();
  }

  // --- input ---
  let drag: { sx: number; sy: number; cx0: number; cy0: number; moved: boolean; button: number } | null = null;
  let hoverTimer = 0;

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.altKey && game.isPoe2) {
      if (e.deltaY) setWeaponSet(Math.max(0, Math.min(2, wsMode + (e.deltaY < 0 ? 1 : -1))) as WeaponSetMode);
      return;
    }
    const rect = canvas!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [wx, wy] = toWorld(sx, sy);
    const factor = Math.exp(-e.deltaY * 0.0015);
    scale = Math.min(1.2, Math.max(0.012, scale * factor));
    cx = wx - (sx - w / 2) / scale;
    cy = wy - (sy - h / 2) / scale;
    zooming = true;
    if (zoomTimer) clearTimeout(zoomTimer);
    zoomTimer = window.setTimeout(() => {
      zoomTimer = 0;
      zooming = false;
      invalidate();
    }, 120);
    invalidate();
  }

  function onPointerDown(e: PointerEvent) {
    attrMenu = null;
    masteryMenu = null;
    tattooMenu = null;
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    canvas!.setPointerCapture(e.pointerId);
    drag = { sx: e.clientX, sy: e.clientY, cx0: cx, cy0: cy, moved: false, button: e.button };
  }

  function setWeaponSet(mode: WeaponSetMode) {
    if (mode === ui.treeWeaponSet) return;
    ui.treeWeaponSet = mode;
    const n = hover;
    if (n && !shiftDown) {
      hover = null;
      setHover(n);
    }
    invalidate();
  }

  function setHover(n: TNode | null) {
    if (n?.id === hover?.id) return;
    hover = n;
    hoverBlocked = null;
    if (shiftDown) {
      // Trace mode: extend the custom path instead of previewing the shortest one.
      clearTimeout(hoverTimer);
      hoverDep = new Set();
      if (n) extendTrace(n);
      hoverPath = new Set(trace);
      hoverCost = trace.length || null;
      invalidate();
      return;
    }
    hoverPath = new Set();
    hoverDep = new Set();
    hoverCost = null;
    clearTimeout(hoverTimer);
    if (n?.kind === "socket") {
      const j = sockets.get(n.id);
      if (j?.radiusIndex && !socketRadius.has(n.id)) {
        engine
          .socketNodes(n.id, j.radiusIndex)
          .then((r) => {
            socketRadius.set(n.id, new Set(r.nodes));
            invalidate();
          })
          .catch(() => {});
      }
    }
    if (n) {
      hoverTimer = window.setTimeout(async () => {
        try {
          const r = await engine.nodeHover(n.id, wsMode);
          if (hover?.id === n.id) {
            hoverPath = new Set(r.blocked ? [] : r.path);
            hoverDep = new Set(r.blocked ? [] : r.depends);
            hoverCost = r.cost ?? null;
            hoverBlocked = r.blocked;
            invalidate();
          }
        } catch {
          /* unreachable node */
        }
      }, 30);
    }
    invalidate();
  }

  function onPointerMove(e: PointerEvent) {
    const rect = canvas!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    mouse = { x: sx, y: sy };
    if (drag) {
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        cx = drag.cx0 - dx / scale;
        cy = drag.cy0 - dy / scale;
        invalidate();
      }
      return;
    }
    if (!index) return;
    const [wx, wy] = toWorld(sx, sy);
    setHover(index.nearest(wx, wy));
  }

  async function extendTrace(n: TNode) {
    if (!model || allocated.has(n.id)) return;
    if (trace.length === 0) {
      try {
        const r = await engine.nodeHover(n.id, wsMode);
        if (shiftDown && hover?.id === n.id && r.path.length) {
          // node.path runs target → tree; the trace runs tree → target
          trace = r.path.slice().reverse();
          hoverPath = new Set(trace);
          hoverCost = trace.length;
          invalidate();
        }
      } catch {
        /* unreachable node */
      }
      return;
    }
    const last = trace[trace.length - 1];
    if (n.id === last) return;
    const idx = trace.indexOf(n.id);
    if (idx >= 0) {
      trace = trace.slice(0, idx + 1);
    } else if (model.nodes.get(last)?.links.includes(n.id)) {
      trace = [...trace, n.id];
    } else {
      return;
    }
    hoverPath = new Set(trace);
    hoverCost = trace.length;
    invalidate();
  }

  async function onPointerUp(e: PointerEvent) {
    if (!drag) return;
    const wasClick = !drag.moved;
    const button = drag.button;
    drag = null;
    if (!wasClick || !hover || build.busy > 0) return;
    const n = hover;
    if (button === 0 && shiftDown && trace.length) {
      const ids = trace;
      trace = [];
      hoverPath = new Set();
      await build.run(() => engine.allocTrace(ids, wsMode));
      return;
    }
    if (button === 2) {
      if (n.isAttribute) attrMenu = { id: n.id, x: mouse.x, y: mouse.y };
      else if (n.kind === "mastery" && allocated.has(n.id)) {
        // PoB: right-click an allocated mastery to change its effect
        const info = await engine.nodeInfo(n.id).catch(() => null);
        if (info) masteryMenu = { id: n.id, name: n.name, x: mouse.x, y: mouse.y, effects: info.masteryEffects, selected: info.masterySelected };
      } else {
        await openTattoos(n.id, mouse.x, mouse.y);
      }
      return;
    }
    if (button !== 0) return;
    hoverPath = new Set();
    hoverDep = new Set();
    const r = await build.clickNode(n.id, { weaponSet: wsMode });
    if (r?.blocked) build.say(r.blocked);
    else if (r?.needsAttribute) attrMenu = { id: n.id, x: mouse.x, y: mouse.y };
    else if (r?.needsMastery) masteryMenu = { id: n.id, name: r.name ?? n.name, x: mouse.x, y: mouse.y, effects: r.effects ?? [], selected: r.selected ?? null };
    else if (r?.needsConfirm === "class_change") classConfirm = { id: n.id, className: r.className ?? "?", ascendClassName: r.ascendClassName ?? null };
  }

  async function pickMastery(effect: number) {
    if (!masteryMenu) return;
    const id = masteryMenu.id;
    masteryMenu = null;
    await build.selectMastery(id, effect);
  }

  async function pickAttribute(attr: number) {
    if (!attrMenu) return;
    const id = attrMenu.id;
    attrMenu = null;
    if (allocated.has(id)) await build.switchAttribute(id, attr);
    else await build.clickNode(id, { attribute: attr, weaponSet: wsMode });
  }

  async function confirmClass(mode: "reset" | "connect") {
    if (!classConfirm) return;
    const id = classConfirm.id;
    classConfirm = null;
    await build.clickNode(id, { confirm: mode, weaponSet: wsMode });
  }

  function onLeave() {
    setHover(null);
  }

  function zoomBy(factor: number) {
    scale = Math.min(1.2, Math.max(0.012, scale * factor));
    invalidate();
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (e.key === "+" || e.key === "=" || e.key === "PageUp") zoomBy(e.shiftKey ? 2.2 : 1.3);
    else if (e.key === "-" || e.key === "PageDown") zoomBy(e.shiftKey ? 1 / 2.2 : 1 / 1.3);
    else if (e.key === "Home" || e.key === "h") focusClass();
    else if (e.key === "a") focusAscendancy();
    else if (e.key === "p") powerOn = !powerOn;
    else if (e.key === "r" && powerOn) showReport = !showReport;
    else if (e.key === "d" && e.ctrlKey) ui.setTreeStatDiff(!ui.treeStatDiff);
    else if (e.key === "f" && !e.ctrlKey) fitAll();
    else if (e.key === "/" || (e.key === "f" && e.ctrlKey)) {
      e.preventDefault();
      searchEl?.focus();
    } else return;
    e.preventDefault();
  }

  async function exportUrl() {
    const r = await build.run(() => engine.exportTreeUrl(), { sync: false });
    if (r) {
      urlDraft = r.url;
      urlPanel = "export";
      await writeText(r.url).catch(() => {});
    }
  }
  async function importUrl() {
    if (!urlDraft.trim()) return;
    const r = await build.importTreeUrl(urlDraft.trim());
    if (r) urlPanel = null;
  }

  async function onSpecChange(e: Event) {
    await build.selectSpec(Number((e.target as HTMLSelectElement).value));
    focusClass();
  }
  async function commitRename() {
    renaming = false;
    if (activeSpec && renameDraft.trim() && renameDraft !== activeSpec.title) await build.renameSpec(activeSpec.index, renameDraft.trim());
  }

  $effect(() => {
    allocated;
    weaponSets;
    wsMode;
    overrides;
    sockets;
    currentAsc;
    currentClass;
    compareAlloc;
    invalidate();
  });

  $effect(() => {
    // Fetch the compare spec's allocation; refetch after any build change.
    const idx = compareIdx;
    build.rev;
    const valid = idx > 0 && build.specs.some((s) => s.index === idx && !s.active);
    untrack(() => {
      if (!valid) {
        if (compareAlloc) {
          compareAlloc = null;
          invalidate();
        }
        return;
      }
      engine
        .specAlloc(idx)
        .then((r) => {
          if (compareIdx === idx) {
            compareAlloc = new Set(r.allocatedNodes);
            invalidate();
          }
        })
        .catch(() => {});
    });
  });

  $effect(() => {
    // Recompute node power when enabled and the build, stat or depth changed.
    // Only the inputs are tracked; computePower's own state writes must not
    // re-trigger this effect.
    const key = `${powerStat}|${powerDepth}|${build.rev}`;
    const on = powerOn;
    untrack(() => {
      if (!on) {
        invalidate();
        return;
      }
      if (key !== powerKey) queueMicrotask(computePower);
      else invalidate();
    });
  });

  $effect(() => {
    const q = search.trim().toLowerCase();
    if (!model || q.length < 2) {
      matches = new Set();
      invalidate();
      return;
    }
    const s = new Set<number>();
    for (const n of model.nodes.values()) {
      if (n.hidden || n.r <= 0) continue;
      if (n.name.toLowerCase().includes(q) || n.stats.some((t) => t.toLowerCase().includes(q))) s.add(n.id);
    }
    matches = s;
    invalidate();
  });

  /** Overlay PoE1 cluster jewel subgraphs on the static tree whenever PoB regenerates them. */
  function applyDynamic() {
    if (!baseModel) return;
    const dyn = build.tree?.dynamicNodes ?? [];
    const dynGroups = build.tree?.dynamicGroups ?? [];
    const key = dyn.map((d) => `${d.id}:${d.x.toFixed(1)}:${d.y.toFixed(1)}:${d.links.join(",")}`).join("|");
    if (key === dynKey && model) return;
    dynKey = key;
    model = withDynamicNodes(baseModel, dyn, dynGroups);
    index = new NodeIndex(model.nodes.values());
    invalidate();
  }
  $effect(() => {
    void build.tree?.dynamicNodes;
    applyDynamic();
  });

  let loadedVersion = "";
  $effect(() => {
    const v = build.tree?.treeVersion;
    if (!v || v === loadedVersion) return;
    loadedVersion = v;
    (async () => {
      try {
        const [json, store, radii, pstats] = await Promise.all([
          readTreeJson(v),
          AssetStore.load(v, () => {
            assetsGen++;
            invalidate();
          }),
          engine.jewelRadii().catch(() => ({ radii: [] as JewelRadius[] })),
          engine.powerStats().catch(() => ({ stats: [] as PowerStat[] })),
        ]);
        baseModel = parseTree(v, json);
        dynKey = "";
        applyDynamic();
        assets = store;
        assetsMissing = !store;
        jewelRadii = radii.radii;
        powerStats = pstats.stats;
        if (store) {
          for (const n of ["Background2", "BGTree", "BGTreeActive", "AscendancyMiddle"]) store.prefetch(n);
        }
        loadError = null;
        resize();
        focusClass();
      } catch (e) {
        loadError = String(e);
      }
    })();
  });

  onMount(() => {
    readPalette();
    const ro = new ResizeObserver(resize);
    if (wrap) ro.observe(wrap);
    resize();
    window.addEventListener("keydown", onKey);
    const onShift = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      const down = e.type === "keydown";
      if (shiftDown !== down) {
        shiftDown = down;
        if (!down && trace.length) {
          trace = [];
          hoverPath = new Set();
          hoverCost = null;
          invalidate();
        }
      }
    };
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);
    return () => {
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
      if (raf) cancelAnimationFrame(raf);
      if (spinTimer) clearTimeout(spinTimer);
      if (zoomTimer) clearTimeout(zoomTimer);
    };
  });
</script>

<div class="page" class:dockbottom={ui.treeBarDock === "bottom"}>
  <div class="bar">
    <div class="group">
      {#if renaming}
        <input
          class="input spec"
          bind:value={renameDraft}
          onblur={commitRename}
          onkeydown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") renaming = false;
          }}
        />
      {:else}
        <select class="select spec" value={activeSpec?.index ?? 1} onchange={onSpecChange} disabled={build.busy > 0} title={m.tree_spec_title()}>
          {#each build.specs as s}
            <option value={s.index}>{stripPobText(s.title)} · {s.allocatedNodeCount}</option>
          {/each}
        </select>
      {/if}
      <button class="btn sm ghost" title={m.tree_new_title()} onclick={() => build.createSpec()}>{m.common_new()}</button>
      <button class="btn sm ghost" title={m.tree_copy_title()} onclick={() => build.copySpec()}>{m.common_copy_button()}</button>
      <button
        class="btn sm ghost"
        title={m.common_rename()}
        onclick={() => {
          renameDraft = activeSpec?.title ?? "";
          renaming = true;
        }}>{m.common_rename()}</button
      >
      <button class="btn sm ghost" title={m.tree_delete_title()} disabled={build.specs.length <= 1} onclick={() => activeSpec && build.deleteSpec(activeSpec.index)}>{m.common_delete()}</button>
      <span class="vr"></span>
      <select
        class="select sm cmp"
        value={compareIdx}
        onchange={(e) => (compareIdx = Number((e.target as HTMLSelectElement).value))}
        disabled={build.specs.length <= 1}
        title={m.tree_compare_title()}
      >
        <option value={0}>{m.tree_compare_off()}</option>
        {#each build.specs.filter((s) => !s.active) as s}
          <option value={s.index}>{m.tree_compare_vs({ title: stripPobText(s.title) })}</option>
        {/each}
      </select>
    </div>
    {#if game.isPoe2}
      <div class="group" role="group" aria-label={m.tree_allocate_into()} title={m.tree_allocate_into_title()}>
        <button class="btn sm ghost" class:on={wsMode === 0} onclick={() => setWeaponSet(0)}>{m.view_tree()}</button>
        <button class="btn sm ghost set1" class:on={wsMode === 1} onclick={() => setWeaponSet(1)}>
          {m.tree_set_1()} <span class="num">{build.tree?.weaponSet1PointsUsed ?? 0}/{wsMax}</span>
        </button>
        <button class="btn sm ghost set2" class:on={wsMode === 2} onclick={() => setWeaponSet(2)}>
          {m.tree_set_2()} <span class="num">{build.tree?.weaponSet2PointsUsed ?? 0}/{wsMax}</span>
        </button>
      </div>
    {/if}
    <div class="group">
      <input class="input search" placeholder={m.tree_search()} bind:value={search} bind:this={searchEl} onkeydown={(e) => e.key === "Enter" && jumpToMatch()} />
      {#if matches.size}<span class="dim num">{matches.size}</span>{/if}
      <button class="btn sm ghost" onclick={focusClass} title={m.tree_class_title()}>{m.tree_class()}</button>
      <button class="btn sm ghost" onclick={focusAscendancy} disabled={!currentAsc} title={currentAsc ? m.tree_ascendancy_title() : m.tree_ascendancy_none()}>{m.tree_ascendancy()}</button>
      <button class="btn sm ghost" onclick={fitAll} title={m.tree_fit_title()}>{m.tree_fit()}</button>
      <button class="btn sm ghost" onclick={() => build.undo()} title={m.tree_undo_title()}>{m.tree_undo()}</button>
      <button class="btn sm ghost" onclick={() => build.redo()} title={m.tree_redo_title()}>{m.tree_redo()}</button>
      <span class="vr"></span>
      <button class="btn sm ghost" onclick={() => { urlPanel = urlPanel === "import" ? null : "import"; urlDraft = ""; }} title={m.tree_import_link_title()}>{m.tree_import_link()}</button>
      <button class="btn sm ghost" onclick={exportUrl} title={m.tree_export_link_title()}>{m.tree_export_link()}</button>
      {#if game.isPoe1}
        <button class="btn sm ghost" onclick={() => (timelessOpen = true)} title={m.tree_timeless_title()}>{m.tree_timeless()}</button>
      {/if}
      <span class="vr"></span>
      <button class="btn sm ghost" class:on={ui.treeStatDiff} onclick={() => ui.setTreeStatDiff(!ui.treeStatDiff)} title={m.tree_stat_diff_title()}>
        {m.tree_stat_diff()}
      </button>
      <button class="btn sm" class:on={powerOn} onclick={() => (powerOn = !powerOn)} title={m.tree_power_title()}>
        {m.tree_power()}
      </button>
    </div>
    {#if powerOn}
      <div class="group">
        <select class="select sm" value={powerStat ?? ""} onchange={(e) => (powerStat = (e.target as HTMLSelectElement).value || null)} title={m.tree_power_stat_title()}>
          {#each powerStats as s}
            <option value={s.stat ?? ""}>{s.label}</option>
          {/each}
        </select>
        <select class="select sm depth" value={powerDepth ?? 0} onchange={(e) => { const v = Number((e.target as HTMLSelectElement).value); powerDepth = v || null; }} title={m.tree_power_depth_title()}>
          <option value={0}>{m.tree_depth_all()}</option>
          <option value={5}>≤ 5</option>
          <option value={10}>≤ 10</option>
          <option value={15}>≤ 15</option>
        </select>
        <button class="btn sm ghost" class:on={showReport} onclick={() => (showReport = !showReport)}>{m.tree_report()}</button>
        {#if powerBusy}
          <span class="dim num small">{m.tree_power_scoring()}{powerProgress ? ` ${powerProgress}%` : ""}</span>
        {:else if powerNote}
          <span class="dim num small" title={m.tree_power_note_title()}>{powerNote}</span>
        {:else if power}
          <span class="dim num small">{m.tree_power_counts({ count: Object.keys(power.nodes).length, seconds: (power.ms / 1000).toFixed(1) })}</span>
        {/if}
      </div>
    {/if}
    {#if urlPanel}
      <div class="group">
        <input class="input url" bind:value={urlDraft} placeholder={m.tree_url_placeholder()} readonly={urlPanel === "export"} onkeydown={(e) => e.key === "Enter" && urlPanel === "import" && importUrl()} />
        {#if urlPanel === "import"}
          <button class="btn sm primary" onclick={importUrl} disabled={!urlDraft.trim()}>{m.tree_import()}</button>
        {:else}
          <span class="dim small">{m.tree_copied()}</span>
        {/if}
        <button class="btn sm ghost" onclick={() => (urlPanel = null)}>{m.common_close()}</button>
      </div>
    {/if}
    <button class="dock" title={ui.treeBarDock === "top" ? m.tree_dock_bottom() : m.tree_dock_top()} onclick={() => ui.setTreeBarDock(ui.treeBarDock === "top" ? "bottom" : "top")}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="0.5" width="11" height="11" rx="1.5" /><path d={ui.treeBarDock === "top" ? "M0.5 8.5h11" : "M0.5 3.5h11"} /></svg>
    </button>
  </div>
  <div class="tree scope-dark" bind:this={wrap}>
    <canvas
      bind:this={canvas}
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointerleave={onLeave}
      oncontextmenu={(e) => e.preventDefault()}
    ></canvas>
  
  
    {#if wsMode > 0}
      <div class="wsbadge" class:set2={wsMode === 2}>{m.tree_weapon_set_badge({ set: wsMode === 1 ? "I" : "II" })}</div>
    {/if}

    {#if assetsMissing}
      <div class="notice">{m.tree_assets_missing_before()} <span class="mono">pnpm sync -- --tree-assets</span>{m.tree_assets_missing_after()}</div>
    {/if}
  
    {#if build.meta && build.tree && build.tree.treeVersion !== build.meta.latestTreeVersion}
      <div class="banner">
        <span>{m.tree_version_banner({ current: build.tree.treeVersion.replace("_", "."), latest: build.meta.latestTreeVersion.replace("_", ".") })}</span>
        <button class="btn sm primary" onclick={() => build.convertTree(false)}>{m.tree_convert_one()}</button>
        {#if build.specs.length > 1}
          <button class="btn sm" onclick={() => build.convertTree(true)}>{m.tree_convert_all()}</button>
        {/if}
      </div>
    {/if}
  
    {#if powerOn && showReport}
      <aside class="report">
        <div class="report-head">
          <span class="label">{m.tree_power_report()}</span>
          <span class="dim small">{power?.label ?? ""}</span>
        </div>
        <div class="report-cols label">
          <span>{m.tree_col_node()}</span><span class="r">{power?.stat ? m.tree_col_per_point() : m.tree_col_off_per_point()}</span><span class="r">{power?.stat ? m.tree_col_node_value() : m.tree_col_def_per_point()}</span><span class="r">{m.tree_col_points()}</span>
        </div>
        <div class="report-list">
          {#each reportRows as r (r.id)}
            <button class="report-row" onclick={() => jumpTo(r.id)} onmouseenter={() => { const n = model?.nodes.get(r.id); if (n) setHover(n); }}>
              <span class="rn">{r.name}</span>
              <span class="r num"><PobText text={r.a} /></span>
              <span class="r num"><PobText text={r.b} /></span>
              <span class="r num dim">{r.dist}</span>
            </button>
          {/each}
          {#if reportRows.length === 0}
            <div class="dim small pad">{powerBusy ? m.tree_scoring_nodes() : m.tree_no_node_improves()}</div>
          {/if}
        </div>
      </aside>
    {/if}
  
    {#if loadError}
      <div class="overlay err">{loadError}</div>
    {:else if !model}
      <div class="overlay dim">{m.tree_loading()}</div>
    {/if}
  
    {#if attrMenu}
      <div class="menu" style:left={`${Math.min(attrMenu.x, w - 160)}px`} style:top={`${Math.min(attrMenu.y, h - 120)}px`}>
        <div class="label">{m.tree_attribute()}</div>
        <button class="mi" onclick={() => pickAttribute(1)}><span style:color="var(--c-life)">{m.tree_strength()}</span> <kbd>S</kbd></button>
        <button class="mi" onclick={() => pickAttribute(2)}><span style:color="var(--ok)">{m.tree_dexterity()}</span> <kbd>D</kbd></button>
        <button class="mi" onclick={() => pickAttribute(3)}><span style:color="var(--c-mana)">{m.tree_intelligence()}</span> <kbd>I</kbd></button>
      </div>
    {/if}
  
    {#if masteryMenu}
      <div class="menu mastery" style:left={`${Math.min(masteryMenu.x, w - 360)}px`} style:top={`${Math.min(masteryMenu.y, h - 40 * (masteryMenu.effects.length + 2))}px`}>
        <div class="label">{masteryMenu.name}</div>
        {#each masteryMenu.effects as e (e.effect)}
          <button
            class="mi effect"
            class:on={e.effect === masteryMenu.selected}
            disabled={e.takenBy != null && e.takenBy !== masteryMenu.id}
            title={e.takenBy != null && e.takenBy !== masteryMenu.id ? m.tree_mastery_taken() : ""}
            onclick={() => pickMastery(e.effect)}
          >
            {#each e.stats as s}<span>{s}</span>{/each}
          </button>
        {/each}
        <button class="mi dim" onclick={() => (masteryMenu = null)}>{m.common_cancel()}</button>
      </div>
    {/if}

    {#if tattooMenu}
      <div class="menu mastery" style:left={`${Math.min(tattooMenu.x, w - 380)}px`} style:top={`${Math.min(tattooMenu.y, Math.max(h - 320, 10))}px`}>
        <div class="label">
          {tattooMenu.info.nodeName}
          <span class="dim num">{tattooMenu.info.count}/{tattooMenu.info.limit}</span>
        </div>
        <label class="mi chk">
          <input
            type="checkbox"
            checked={tattooLegacy}
            onchange={async (e) => {
              tattooLegacy = (e.target as HTMLInputElement).checked;
              const id = tattooMenu!.id;
              const info = await engine.nodeTattoos(id, tattooLegacy).catch(() => null);
              if (info && tattooMenu) tattooMenu = { ...tattooMenu, info };
            }}
          />
          {m.tree_legacy_tattoos()}
        </label>
        <div class="tatlist">
          {#each tattooMenu.info.options as t (t.id)}
            <button class="mi effect" class:on={t.name === tattooMenu.info.applied?.name} onclick={() => pickTattoo(t.id)}>
              <span class="tatname">{t.name}</span>
              {#each t.stats as s}<span class="dim small">{s}</span>{/each}
            </button>
          {/each}
        </div>
        {#if tattooMenu.info.applied}
          <button class="mi danger" onclick={() => pickTattoo(null)}>{m.tree_reset_node()}</button>
        {/if}
        <button class="mi dim" onclick={() => (tattooMenu = null)}>{m.common_cancel()}</button>
      </div>
    {/if}

    {#if timelessOpen}
      <TimelessSearch onclose={() => (timelessOpen = false)} />
    {/if}

    {#if classConfirm}
      <div class="modal">
        <div class="panel dialog">
          <div class="label">{m.tree_class_change()}</div>
          <p>{m.tree_class_change_body({ ascendancy: classConfirm.ascendClassName ?? classConfirm.className, className: classConfirm.className })}</p>
          <div class="actions">
            <button class="btn" onclick={() => confirmClass("connect")}>{m.tree_connect_path()}</button>
            <button class="btn primary" onclick={() => confirmClass("reset")}>{m.tree_reset_and_switch()}</button>
            <button class="btn ghost" onclick={() => (classConfirm = null)}>{m.common_cancel()}</button>
          </div>
        </div>
      </div>
    {/if}
  
    {#if hover && !attrMenu && !masteryMenu}
      {@const ov = overrides[String(hover.id)]}
      {@const socketed = hover.kind === "socket" ? sockets.get(hover.id) : undefined}
      <div class="tip" bind:this={tipEl} style:left={`${tipPlacement.node}px`} style:top={`${Math.max(8, Math.min(mouse.y + 18, h - tipH - 8))}px`}>
        <div class="tip-head">
          <span class="tip-name" class:key={hover.kind === "keystone"} class:notable={hover.kind === "notable"}>{ov?.name ?? hover.name}</span>
          <span class="label">{hover.asc ?? hover.kind}</span>
        </div>
        {#if socketed}
          <div class="tip-stat">
            <span class="dim">{m.tree_socketed()}</span>
            <span class="rarity" data-rarity={socketed.rarity ?? ""}>{socketed.title ?? socketed.name}</span>
          </div>
        {/if}
        {#each ov?.stats?.length ? ov.stats : hover.stats as s}
          <div class="tip-stat">{s}</div>
        {/each}
        {#if hover.masteryEffects && !allocated.has(hover.id)}
          {#each hover.masteryEffects as e (e.effect)}
            <div class="tip-stat dim">{e.stats.join(" / ")}</div>
          {/each}
        {/if}
        {#if hover.flavour}
          <div class="tip-flav">{hover.flavour}</div>
        {/if}
        {#if hoverBlocked}
          <div class="tip-warn">{hoverBlocked}</div>
        {/if}
        {#if ui.treeStatDiff && statDiff && statDiff.id === hover.id}
          <div class="tip-diff">
            {#if statDiff.changes === 0}
              <div class="dim">{m.tree_no_changes()}</div>
            {:else}
              {#each statDiff.lines as l}
                <div class:head={l.head}><PobText text={l.text} /></div>
              {/each}
            {/if}
          </div>
        {/if}
        <div class="tip-foot num">
          {#if allocated.has(hover.id)}
            {@const set = weaponSets.get(hover.id)}
            <span style:color={set === 1 ? "var(--bad)" : "var(--ok)"}>{set ? m.tree_in_weapon_set({ set: set === 1 ? "I" : "II" }) : m.tree_allocated()}</span>
            {#if !hoverBlocked}
              <span class="dim">{hoverDep.size > 1 ? m.tree_click_removes({ count: hoverDep.size }) : m.tree_click_to_remove()}{hover.isAttribute ? m.tree_right_click_switch() : hover.kind === "mastery" ? m.tree_right_click_effect() : ""}</span>
            {/if}
          {:else if hoverCost != null}
            <span>{m.tree_point_cost({ count: hoverCost })}</span>
            {#if !hoverBlocked}
              <span class="dim">{shiftDown && trace.length ? m.tree_tracing() : hover.kind === "mastery" ? m.tree_choose_effect() : m.tree_click_allocate()}</span>
            {/if}
          {:else if !hoverBlocked}
            <span class="dim">…</span>
          {/if}
          <span class="dim">#{hover.id}</span>
        </div>
      </div>
      {#if socketed && jewelTip && tipPlacement.showJewel}
        {@const r = wrap?.getBoundingClientRect()}
        <PobTooltip lines={jewelTip.lines} header={jewelTip.header} itemArt={jewelTip.itemArt} x={(r?.left ?? 0) + tipPlacement.jewel} y={(r?.top ?? 0) + Math.min(mouse.y + 18, h - 60)} width={jewelTipW} />
      {/if}
    {/if}
  </div>
</div>

<style>
  .page {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .tree {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-0);
  }
  canvas {
    display: block;
    cursor: crosshair;
    touch-action: none;
  }
  .bar {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 14px;
    padding: 6px 34px 6px 10px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--line-0);
  }
  .page.dockbottom .bar {
    order: 2;
    border-bottom: 0;
    border-top: 1px solid var(--line-0);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dock {
    position: absolute;
    top: 7px;
    right: 8px;
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    padding: 4px;
    border-radius: var(--r-1);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .dock:hover {
    color: var(--fg-0);
    background: var(--bg-hover);
  }
  .search {
    width: 220px;
    height: 24px;
  }
  .spec {
    width: 220px;
    height: 24px;
    font-size: var(--fs-xs);
  }
  .url {
    width: 420px;
    height: 24px;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .vr {
    width: 1px;
    height: 16px;
    background: var(--line-1);
    margin: 0 2px;
  }
  .btn.on {
    color: var(--fg-0);
    border-color: var(--fg-2);
    background: var(--bg-active);
  }
  .btn.set1.on {
    border-color: var(--bad);
  }
  .btn.set2.on {
    border-color: var(--ok);
  }
  .btn .num {
    margin-left: 4px;
    color: var(--fg-3);
  }
  .wsbadge {
    position: absolute;
    top: 10px;
    left: 10px;
    padding: 5px 10px;
    font-size: var(--fs-xs);
    color: var(--fg-1);
    background: color-mix(in srgb, var(--bg-1) 90%, transparent);
    border: 1px solid var(--line-1);
    border-left: 2px solid var(--bad);
    border-radius: var(--r-1);
    pointer-events: none;
  }
  .wsbadge.set2 {
    border-left-color: var(--ok);
  }
  .select.sm {
    height: 22px;
    font-size: var(--fs-xs);
    width: 180px;
  }
  .select.sm.depth {
    width: 72px;
  }
  .select.sm.cmp {
    width: 150px;
  }
  .report {
    position: absolute;
    top: 10px;
    right: 10px;
    bottom: 10px;
    width: 360px;
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--bg-1) 92%, transparent);
    border: 1px solid var(--line-0);
    border-radius: var(--r-2);
    backdrop-filter: blur(6px);
    overflow: hidden;
  }
  .report-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 8px 10px 6px;
    border-bottom: 1px solid var(--line-0);
  }
  .report-cols,
  .report-row {
    display: grid;
    grid-template-columns: 1fr 72px 72px 34px;
    gap: 8px;
    padding: 4px 10px;
    align-items: baseline;
  }
  .report-cols {
    border-bottom: 1px solid var(--line-0);
  }
  .report-list {
    flex: 1;
    overflow-y: auto;
  }
  .report-row {
    appearance: none;
    width: 100%;
    border: 0;
    border-bottom: 1px solid var(--line-0);
    background: transparent;
    color: var(--fg-1);
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  .report-row:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .rn {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .r {
    text-align: right;
  }
  .pad {
    padding: 10px;
  }
  .small {
    font-size: var(--fs-xs);
  }
  .banner {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    font-size: var(--fs-xs);
    color: var(--fg-1);
    background: color-mix(in srgb, var(--bg-1) 92%, transparent);
    border: 1px solid var(--line-1);
    border-left: 2px solid var(--warn);
    border-radius: var(--r-1);
    backdrop-filter: blur(6px);
  }
  .banner span {
    flex: 1;
  }
  .notice {
    position: absolute;
    left: 10px;
    bottom: 10px;
    padding: 6px 10px;
    font-size: var(--fs-xs);
    color: var(--warn);
    background: color-mix(in srgb, var(--bg-1) 90%, transparent);
    border: 1px solid var(--line-1);
    border-radius: var(--r-1);
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: var(--fs-sm);
    pointer-events: none;
  }
  .overlay.err {
    color: var(--bad);
  }
  .menu {
    position: absolute;
    /* Above the hover tooltip, which would otherwise cover the menu. */
    z-index: 3;
    min-width: 150px;
    padding: 6px;
    background: var(--bg-1);
    border: 1px solid var(--line-1);
    border-radius: var(--r-2);
    box-shadow: var(--shadow-pop);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .menu .label {
    padding: 2px 6px 6px;
  }
  .mi {
    appearance: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--r-1);
    background: transparent;
    color: var(--fg-0);
    font-size: var(--fs-sm);
    cursor: pointer;
    text-align: left;
  }
  .mi:hover {
    background: var(--bg-hover);
  }
  .menu.mastery {
    min-width: 280px;
    max-width: 380px;
  }
  .mi.effect {
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    font-size: var(--fs-xs);
    white-space: normal;
  }
  .tatlist {
    max-height: 260px;
    overflow: auto;
  }
  .tatname {
    color: var(--fg-0);
  }
  .mi.chk {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mi.danger {
    color: var(--bad);
  }
  .mi.effect.on {
    color: var(--ok);
  }
  .mi:disabled {
    color: var(--fg-4);
    cursor: default;
  }
  .mi.dim {
    color: var(--fg-3);
    font-size: var(--fs-xs);
  }
  .modal {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--backdrop);
  }
  .dialog {
    width: 440px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dialog p {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--fg-1);
    line-height: 1.45;
  }
  .actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .tip {
    position: absolute;
    width: max-content;
    min-width: min(320px, calc(100% - 16px));
    max-width: calc(100% - 16px);
    max-height: calc(100% - 16px);
    overflow: hidden;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--bg-1) 94%, transparent);
    border: 1px solid var(--line-1);
    border-radius: var(--r-2);
    box-shadow: var(--shadow-pop);
    pointer-events: none;
    backdrop-filter: blur(8px);
    font-size: var(--fs-sm);
  }
  .tip-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
  }
  .tip-name {
    font-weight: 600;
    color: var(--fg-0);
  }
  .tip-name.key {
    color: var(--c-rare);
  }
  .tip-name.notable {
    color: var(--c-currency);
  }
  .tip-stat {
    color: var(--c-magic);
    line-height: 1.35;
  }
  .tip-stat .rarity {
    color: var(--fg-0);
  }
  .tip-stat .rarity[data-rarity="UNIQUE"] {
    color: var(--c-unique);
  }
  .tip-stat .rarity[data-rarity="RARE"] {
    color: var(--c-rare);
  }
  .tip-stat .rarity[data-rarity="MAGIC"] {
    color: var(--c-magic);
  }
  .tip-flav {
    margin-top: 6px;
    color: var(--c-unique);
    font-style: italic;
    font-size: var(--fs-xs);
  }
  .tip-warn {
    margin-top: 6px;
    color: var(--warn);
    font-size: var(--fs-xs);
  }
  .tip-diff {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--line-0);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.45;
  }
  .tip-diff .head {
    margin-top: 4px;
    color: var(--fg-1);
    font-family: var(--font-ui);
  }
  .tip-diff .head:first-child {
    margin-top: 0;
  }
  .tip-foot {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--line-0);
    font-size: var(--fs-xs);
    color: var(--fg-1);
  }
</style>
