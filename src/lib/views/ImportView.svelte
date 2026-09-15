<script lang="ts">
  import { onMount } from "svelte";
  import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import {
    engine,
    listBuilds,
    listBuildFolders,
    renameBuild,
    moveBuild,
    deleteBuild,
    fetchBuildCode,
    isMobalyticsLink,
    resolveMobalytics,
    saveGameBuildFiles,
    listGameBuilds,
    setGameBuildMeta,
    shareBuildCode,
    readTextFile,
    writeTextFile,
    SHARE_SITES,
    type ShareSite,
    type AppPaths,
    type BuildEntry,
    type GameBuildList,
    type MobalyticsBuild,
    type MobalyticsVariant,
  } from "$lib/engine.svelte";
  import { build, autosaveKey } from "$lib/state/build.svelte";
  import { game } from "$lib/state/game.svelte";

  let { paths }: { paths: AppPaths | null } = $props();

  let code = $state("");
  let builds = $state<BuildEntry[]>([]);
  let folders = $state<string[]>([]);
  let filter = $state("");
  let sort = $state<"modified" | "name" | "level" | "class">("modified");
  let flash = $state<string | null>(null);
  let fetching = $state(false);

  // The name written as `author` into exported .build files; remembered across builds.
  const AUTHOR_KEY = "pob-redux:author";
  let author = $state("");
  try {
    author = localStorage.getItem(AUTHOR_KEY) ?? "";
  } catch {}
  function commitAuthor() {
    author = author.trim();
    try {
      localStorage.setItem(AUTHOR_KEY, author);
    } catch {}
  }

  // Share link (pobb.in and friends), as PoB's own Share button.
  const SITE_KEY = "pob-redux:share-site";
  let shareSite = $state<ShareSite>("pobb.in");
  try {
    const saved = localStorage.getItem(SITE_KEY);
    if (saved && (SHARE_SITES as readonly string[]).includes(saved)) shareSite = saved as ShareSite;
  } catch {}
  let sharing = $state(false);
  let shareUrl = $state<string | null>(null);

  // Editing the author of a group of game builds (one input per header),
  // and the name or author of one file (one input per row).
  let editAuthor = $state<string | null>(null);
  let authorDraft = $state("");
  let gbEdit = $state<{ path: string; field: "name" | "author" } | null>(null);
  let gbDraft = $state("");

  // The open build's name, edited in place; Enter or blur commits.
  let nameDraft = $state<string | null>(null);
  function commitBuildName() {
    const name = nameDraft?.trim() ?? "";
    nameDraft = null;
    if (name && name !== build.info?.name) build.rename(name).then(() => refresh());
  }

  let renaming = $state<string | null>(null);
  let renameDraft = $state("");
  let moving = $state<string | null>(null);
  let confirmDelete = $state<string | null>(null);
  let movingNew = $state<string | null>(null);
  let folderDraft = $state("");

  // recent builds (paths, most recent first)
  const RECENT_KEY = "pob-redux:recent";
  let recent = $state<string[]>([]);
  try {
    recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    recent = [];
  }
  function noteRecent(path: string) {
    recent = [path, ...recent.filter((p) => p !== path)].slice(0, 8);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {}
  }

  let autosave = $state<{ name: string; file: string | null; at: number; xml: string } | null>(null);
  try {
    autosave = JSON.parse(localStorage.getItem(autosaveKey()) ?? "null");
  } catch {
    autosave = null;
  }

  const shown = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    const list = builds.filter((b) => !q || `${b.folder}/${b.name} ${b.class_name ?? ""} ${b.ascend_class_name ?? ""}`.toLowerCase().includes(q));
    const cmp: Record<typeof sort, (a: BuildEntry, b: BuildEntry) => number> = {
      modified: (a, b) => b.modified - a.modified,
      name: (a, b) => a.name.localeCompare(b.name),
      level: (a, b) => (b.level ?? 0) - (a.level ?? 0),
      class: (a, b) => (a.class_name ?? "").localeCompare(b.class_name ?? "") || a.name.localeCompare(b.name),
    };
    return [...list].sort(cmp[sort]);
  });

  const grouped = $derived.by(() => {
    const groups = new Map<string, BuildEntry[]>();
    for (const f of folders) groups.set(f, []);
    for (const b of shown) {
      if (!groups.has(b.folder)) groups.set(b.folder, []);
      groups.get(b.folder)!.push(b);
    }
    return [...groups.entries()]
      .filter(([f, items]) => items.length > 0 || (!filter.trim() && f !== ""))
      .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  });

  const recentEntries = $derived(recent.map((p) => builds.find((b) => b.path === p)).filter((b): b is BuildEntry => !!b));

  // GGG Build Planner (*.build) files
  let gameBuilds = $state<GameBuildList | null>(null);
  let plannerDir = $state("");
  let editPlannerDir = $state(false);
  let gbCollapsed = $state<Set<string>>(new Set());
  try {
    plannerDir = localStorage.getItem("pob-redux:planner-dir") ?? "";
    gbCollapsed = new Set(JSON.parse(localStorage.getItem("pob-redux:gb-collapsed") ?? "[]"));
  } catch {}

  const gameBuildGroups = $derived.by(() => {
    const groups = new Map<string, GameBuildList["builds"]>();
    for (const b of gameBuilds?.builds ?? []) {
      const author = b.author ?? "Unknown author";
      if (!groups.has(author)) groups.set(author, []);
      groups.get(author)!.push(b);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  });

  function toggleAuthor(author: string) {
    const s = new Set(gbCollapsed);
    s.has(author) ? s.delete(author) : s.add(author);
    gbCollapsed = s;
    try {
      localStorage.setItem("pob-redux:gb-collapsed", JSON.stringify([...s]));
    } catch {}
  }

  async function refresh() {
    builds = await listBuilds().catch(() => []);
    folders = await listBuildFolders().catch(() => []);
    // The game's Build Planner is a PoE2 feature.
    gameBuilds = game.isPoe2 ? await listGameBuilds(plannerDir || undefined).catch(() => null) : null;
  }
  onMount(refresh);

  function commitPlannerDir() {
    editPlannerDir = false;
    try {
      localStorage.setItem("pob-redux:planner-dir", plannerDir.trim());
    } catch {}
    refresh();
  }

  async function importGameBuildFile(path: string, name: string) {
    try {
      const json = await readTextFile(path);
      await importGameBuildJson(json, name);
    } catch (e) {
      build.error = String(e);
      say(`Import failed: ${String(e)}`);
    }
  }

  async function importGameBuildJson(json: string, name: string) {
    try {
      const r = await build.run(() => engine.importGameBuild(json, name));
      if (r) {
        const issues = [...r.warnings, ...r.missingPassives.map((p) => `unknown passive: ${p}`), ...r.missingSkills.map((s) => `unknown gem: ${s}`)];
        const gear = r.gearItems > 0 ? `, ${r.gearItems} items` : "";
        const hints = r.gearHints > 0 ? `, ${r.gearHints} gear hints in Notes` : "";
        const passives = r.allocated < r.requested ? `${r.allocated} of ${r.requested} passives` : `${r.allocated} passives`;
        say(`${passives}, ${r.skillGroups} skill groups${gear}${hints}${issues.length ? ` — ${issues.length} issue${issues.length > 1 ? "s" : ""} (see console)` : ""}`);
        if (issues.length) console.warn(`.build import issues for ${name}:`, issues);
        build.view = "tree";
      } else if (build.error) {
        say(`Import failed: ${build.error}`);
      }
    } catch (e) {
      build.error = String(e);
      say(`Import failed: ${String(e)}`);
    }
  }

  async function commitGroupAuthor(items: GameBuildList["builds"]) {
    const name = authorDraft.trim();
    editAuthor = null;
    try {
      for (const gb of items) await setGameBuildMeta(gb.path, { author: name });
      const n = `${items.length} file${items.length > 1 ? "s" : ""}`;
      say(name ? `Author set to ${name} on ${n}` : `Author cleared on ${n}`);
    } catch (e) {
      build.error = String(e);
    }
    refresh();
  }

  async function commitGbEdit(gb: GameBuildList["builds"][number]) {
    const edit = gbEdit;
    const value = gbDraft.trim();
    gbEdit = null;
    if (!edit) return;
    if (edit.field === "name" && (!value || value === gb.name)) return;
    if (edit.field === "author" && value === (gb.author ?? "")) return;
    try {
      await setGameBuildMeta(gb.path, edit.field === "name" ? { name: value } : { author: value });
      say(edit.field === "name" ? `Renamed to ${value}` : value ? `Author set to ${value}` : "Author cleared");
    } catch (e) {
      build.error = String(e);
    }
    refresh();
  }

  async function saveGameBuild() {
    commitAuthor();
    const r = await build.run(() => engine.exportGameBuild({ author }), { sync: false });
    if (!r) return;
    const p = await save({
      defaultPath: `${gameBuilds?.dir ?? ""}\\${build.info?.name ?? r.name}.build`,
      filters: [{ name: "Game Build Planner", extensions: ["build"] }],
    });
    if (p) {
      await writeTextFile(p, r.json);
      say(`Saved .build — ${r.passives} passives, ${r.skills} skills, ${r.gear} gear hints`);
      refresh();
    }
  }

  function say(msg: string) {
    flash = msg;
    setTimeout(() => (flash = null), 2500);
  }

  function openBuild(b: BuildEntry) {
    noteRecent(b.path);
    return build.loadFile(b.path);
  }

  // A Mobalytics build page: the author's PoB build, if any, plus one Build
  // Planner file per variant, offered in a dialog rather than loaded blind.
  let moba = $state<MobalyticsBuild | null>(null);
  let mobaBusy = $state(false);

  async function loadCodeOrLink(codeOrLink: string) {
    if (/^https?:\/\//i.test(codeOrLink)) {
      const r = await fetchBuildCode(codeOrLink);
      say(`Fetched from ${r.site}`);
      return build.loadCode(r.code);
    }
    return build.loadCode(codeOrLink);
  }

  async function mobaImportPob() {
    if (!moba?.pobCode) return;
    mobaBusy = true;
    try {
      const ok = await loadCodeOrLink(moba.pobCode);
      if (ok) {
        moba = null;
        build.view = "tree";
      }
    } catch (e) {
      build.error = String(e);
    } finally {
      mobaBusy = false;
    }
  }

  async function mobaOpenVariant(v: MobalyticsVariant) {
    mobaBusy = true;
    try {
      await importGameBuildJson(v.json, v.name);
      if (!build.error) moba = null;
    } finally {
      mobaBusy = false;
    }
  }

  async function mobaSaveAll() {
    if (!moba) return;
    mobaBusy = true;
    try {
      const saved = await saveGameBuildFiles(moba.variants.map((v) => ({ name: v.name, json: v.json })), plannerDir || undefined);
      const replaced = saved.filter((s) => s.replaced).length;
      say(`Saved ${saved.length} Build Planner file${saved.length === 1 ? "" : "s"}${replaced ? ` (${replaced} replaced)` : ""} to ${gameBuilds?.dir ?? "the game folder"}`);
      moba = null;
      await refresh();
    } catch (e) {
      build.error = String(e);
      say(`Save failed: ${String(e)}`);
    } finally {
      mobaBusy = false;
    }
  }

  async function doImport() {
    const text = code.trim();
    if (!text) return;
    if (isMobalyticsLink(text)) {
      fetching = true;
      try {
        moba = await resolveMobalytics(text);
      } catch (e) {
        build.error = String(e);
      } finally {
        fetching = false;
      }
    } else if (/^https?:\/\//i.test(text)) {
      fetching = true;
      try {
        await loadCodeOrLink(text);
      } catch (e) {
        build.error = String(e);
      } finally {
        fetching = false;
      }
    } else if (text.startsWith("<")) {
      await build.loadXml(text);
    } else {
      await build.loadCode(text);
    }
  }

  async function pasteImport() {
    const t = (await readText().catch(() => "")) ?? "";
    if (t) {
      code = t;
      await doImport();
    }
  }

  async function copyToClipboard(text: string, what: string) {
    try {
      await writeText(text);
      say(`${what} copied`);
    } catch (e) {
      // The clipboard can be held by another app; the code box is the fallback.
      code = text;
      say(`Could not use the clipboard (${String(e)}). The ${what.toLowerCase()} is in the box above.`);
    }
  }

  async function copyCode() {
    const r = await build.run(() => engine.saveBuildCode(), { sync: false });
    if (r) await copyToClipboard(r.code, "Share code");
  }

  async function shareLink() {
    const r = await build.run(() => engine.saveBuildCode(), { sync: false });
    if (!r) return;
    sharing = true;
    shareUrl = null;
    try {
      localStorage.setItem(SITE_KEY, shareSite);
    } catch {}
    try {
      const link = await shareBuildCode(shareSite, r.code);
      shareUrl = link.url;
      await copyToClipboard(link.url, `${link.site} link`);
    } catch (e) {
      build.error = `Share link: ${String(e)}`;
    } finally {
      sharing = false;
    }
  }

  async function openXml() {
    const p = await open({
      multiple: false,
      filters: [{ name: "Builds", extensions: ["xml", "build"] }],
    });
    if (typeof p === "string") {
      if (p.toLowerCase().endsWith(".build")) {
        await importGameBuildFile(p, p.replace(/^.*[\\/]/, "").replace(/\.build$/i, ""));
      } else {
        noteRecent(p);
        await build.loadFile(p);
      }
    }
  }

  async function saveAs() {
    const p = await save({
      defaultPath: build.info?.file ?? `${paths?.builds_dir ?? ""}/${build.info?.name ?? "build"}.xml`,
      filters: [{ name: "Path of Building", extensions: ["xml"] }],
    });
    if (!p) return;
    // The dialog does not always append the filter's extension; the builds list only scans .xml.
    const path = /.xml$/i.test(p) ? p : `${p}.xml`;
    const r = await build.run(() => engine.saveBuildFile(path));
    if (r) {
      say(`Saved ${path}`);
      refresh();
    }
  }

  async function saveCurrent() {
    if (!build.info?.file) return saveAs();
    const r = await build.run(() => engine.saveBuildFile());
    if (r) {
      say("Saved");
      refresh();
    }
  }

  async function exportXml() {
    const r = await build.run(() => engine.saveBuildXml(), { sync: false });
    if (r) {
      const p = await save({ defaultPath: `${paths?.builds_dir ?? ""}/${build.info?.name ?? "build"}.xml`, filters: [{ name: "XML", extensions: ["xml"] }] });
      if (p) {
        await writeTextFile(p, r.xml);
        say(`Exported ${p}`);
      }
    }
  }

  async function commitRename(b: BuildEntry) {
    const name = renameDraft.trim();
    renaming = null;
    if (!name || name === b.name) return;
    try {
      const np = await renameBuild(b.path, name);
      say(`Renamed to ${name}`);
      if (build.info?.file === b.path) await build.loadFile(np);
      refresh();
    } catch (e) {
      build.error = String(e);
    }
  }

  async function commitMove(b: BuildEntry, folder: string) {
    moving = null;
    movingNew = null;
    if (folder === b.folder) return;
    try {
      const np = await moveBuild(b.path, folder);
      say(`Moved to ${folder || "top level"}`);
      if (build.info?.file === b.path) await build.loadFile(np);
      refresh();
    } catch (e) {
      build.error = String(e);
    }
  }

  async function commitDelete(b: BuildEntry) {
    confirmDelete = null;
    try {
      await deleteBuild(b.path);
      recent = recent.filter((p) => p !== b.path);
      say(`Deleted ${b.name}`);
      refresh();
    } catch (e) {
      build.error = String(e);
    }
  }

  async function restoreAutosave() {
    if (!autosave) return;
    await build.loadXml(autosave.xml, autosave.name);
    say("Autosave restored — use Save to write it to disk");
  }

  function fmtDate(t: number) {
    const d = new Date(t * 1000);
    return d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
  }
  function fmtTime(ms: number) {
    return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
</script>

{#snippet buildRow(b: BuildEntry, showFolder: boolean)}
  <div class="row">
    {#if renaming === b.path}
      <input
        class="input grow"
        bind:value={renameDraft}
        onblur={() => commitRename(b)}
        onkeydown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") (renaming = null);
        }}
      />
    {:else}
      <button class="name" onclick={() => openBuild(b)} disabled={build.busy > 0}>
        {#if showFolder && b.folder}<span class="dim">{b.folder}/</span>{/if}{b.name}
      </button>
      <span class="meta">
        <span>{b.class_name ?? "?"}{#if b.ascend_class_name}<span class="dim"> · {b.ascend_class_name}</span>{/if}</span>
        <span class="num dim">L{b.level ?? "?"}</span>
        <span class="num dim">{fmtDate(b.modified)}</span>
      </span>
      <span class="acts">
        {#if moving === b.path}
          <select
            class="select xs"
            value={b.folder}
            onchange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === "__new") {
                moving = null;
                movingNew = b.path;
                folderDraft = "";
              } else commitMove(b, v);
            }}
            onblur={() => (moving = null)}
          >
            <option value="">(top level)</option>
            {#each folders as f}
              <option value={f}>{f}</option>
            {/each}
            <option value="__new">New folder…</option>
          </select>
        {:else if movingNew === b.path}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="input xs fdraft"
            placeholder="Folder name"
            bind:value={folderDraft}
            autofocus
            onkeydown={(e) => {
              if (e.key === "Enter" && folderDraft.trim()) commitMove(b, folderDraft.trim());
              if (e.key === "Escape") (movingNew = null);
            }}
          />
          <button class="act" disabled={!folderDraft.trim()} onclick={() => commitMove(b, folderDraft.trim())}>move</button>
          <button class="act" onclick={() => (movingNew = null)}>cancel</button>
        {:else if confirmDelete === b.path}
          <button class="act danger" onclick={() => commitDelete(b)}>confirm</button>
          <button class="act" onclick={() => (confirmDelete = null)}>keep</button>
        {:else}
          <button class="act" title="Rename" onclick={() => { renaming = b.path; renameDraft = b.name; }}>ren</button>
          <button class="act" title="Move to folder" onclick={() => (moving = b.path)}>mv</button>
          <button class="act" title="Delete" onclick={() => (confirmDelete = b.path)}>del</button>
        {/if}
      </span>
    {/if}
  </div>
{/snippet}

<div class="page">
  <section class="col">
    <div class="toolbar">
      <input class="input" placeholder="Filter builds…" bind:value={filter} />
      <select class="select" bind:value={sort} title="Sort">
        <option value="modified">Recent first</option>
        <option value="name">Name</option>
        <option value="level">Level</option>
        <option value="class">Class</option>
      </select>
      <span class="vr"></span>
      <button class="btn sm" onclick={openXml}>Open file…</button>
      <button class="btn sm primary" onclick={() => build.newBuild()} disabled={build.busy > 0}>New build</button>
    </div>
    <div class="list">
      {#if autosave && autosave.name !== build.info?.name}
        <div class="recover">
          <span>Unsaved session <b>{autosave.name}</b> · {fmtTime(autosave.at)}</span>
          <span class="acts2">
            <button class="btn sm" onclick={restoreAutosave} disabled={build.busy > 0}>Restore</button>
            <button class="btn sm ghost" onclick={() => { localStorage.removeItem(autosaveKey()); autosave = null; }}>Dismiss</button>
          </span>
        </div>
      {/if}
      {#if recentEntries.length && !filter.trim()}
        <div class="ghead">Recent</div>
        {#each recentEntries as b (b.path)}
          {@render buildRow(b, true)}
        {/each}
      {/if}
      {#if shown.length === 0}
        <div class="dim small pad">No builds yet.</div>
      {/if}
      {#each grouped as [folder, items] (folder)}
        <div class="ghead" title={paths?.builds_dir ?? ""}>{folder === "" ? "Builds" : folder}</div>
        {#each items as b (b.path)}
          {@render buildRow(b, false)}
        {/each}
        {#if items.length === 0}
          <div class="dim small pad">empty folder</div>
        {/if}
      {/each}
      {#if game.isPoe2}
      <div class="ghead gb" title={gameBuilds?.dir ?? ""}>
        <span>Game Build Planner</span>
        <span class="dim num">{gameBuilds?.builds.length ?? 0}</span>
        <button class="act" title="Change folder" onclick={() => (editPlannerDir = true)}>folder</button>
      </div>
      {#if editPlannerDir}
        <div class="pdirrow">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="input grow"
            bind:value={plannerDir}
            placeholder={gameBuilds?.dir ?? "Documents\\My Games\\Path of Exile 2\\BuildPlanner"}
            autofocus
            onblur={commitPlannerDir}
            onkeydown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") (editPlannerDir = false);
            }}
          />
        </div>
      {:else if gameBuilds && !gameBuilds.exists}
        <div class="dim small pad">Folder not found.</div>
      {/if}
      {/if}
      {#each gameBuildGroups as [group, items] (group)}
        {#if editAuthor === group}
          <div class="ahead editing">
            <span class="caret open">▸</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="input grow"
              bind:value={authorDraft}
              placeholder="Author (empty clears it)"
              autofocus
              onblur={() => commitGroupAuthor(items)}
              onkeydown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") (editAuthor = null);
              }}
            />
          </div>
        {:else}
          <div class="ahead">
            <button class="ahead-toggle" onclick={() => toggleAuthor(group)}>
              <span class="caret" class:open={!gbCollapsed.has(group)}>▸</span>
              <span class="aname">{group}</span>
              <span class="dim num">{items.length}</span>
            </button>
            <button
              class="act"
              title="Set the author written in these files"
              onclick={() => {
                authorDraft = items[0]?.author ?? "";
                editAuthor = group;
              }}>author</button>
          </div>
        {/if}
        {#if !gbCollapsed.has(group)}
          {#each items as gb (gb.path)}
            <div class="row gbrow">
              {#if gbEdit?.path === gb.path}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="input grow gbedit"
                  bind:value={gbDraft}
                  placeholder={gbEdit.field === "name" ? "Build name" : "Author (empty clears it)"}
                  autofocus
                  onblur={() => commitGbEdit(gb)}
                  onkeydown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") (gbEdit = null);
                  }}
                />
              {:else}
                <button class="name" onclick={() => importGameBuildFile(gb.path, gb.name)} disabled={build.busy > 0}>{gb.name}</button>
                <span class="meta"><span class="num dim">{fmtDate(gb.modified)}</span></span>
                <span class="acts">
                  <button class="act" title="Rename (the name inside the file; the file keeps its own)" onclick={() => { gbDraft = gb.name; gbEdit = { path: gb.path, field: "name" }; }}>ren</button>
                  <button class="act" title="Set this file's author" onclick={() => { gbDraft = gb.author ?? ""; gbEdit = { path: gb.path, field: "author" }; }}>author</button>
                </span>
              {/if}
            </div>
          {/each}
        {/if}
      {/each}
    </div>
  </section>

  <section class="col side">
    <div class="panel-head"><span class="label">Import</span></div>
    <div class="block">
      <textarea
        class="textarea"
        rows="5"
        placeholder="Share code, build XML, or a link (pobb.in, Maxroll, Mobalytics, poe.ninja, poe2db, Pastebin, Rentry)"
        bind:value={code}
      ></textarea>
      <div class="actions">
        <button class="btn primary" onclick={doImport} disabled={!code.trim() || build.busy > 0 || fetching}>
          {fetching ? "Fetching…" : "Import"}
        </button>
        <button class="btn" onclick={pasteImport} disabled={build.busy > 0 || fetching}>Paste and import</button>
      </div>
    </div>

    {#if moba}
      <div class="overlay" role="presentation" onclick={() => !mobaBusy && (moba = null)} onkeydown={(e) => e.key === "Escape" && (moba = null)}>
        <div class="modal" role="dialog" aria-label="Mobalytics build" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === "Escape" && (moba = null)}>
          <div class="mhead">
            <span class="label">Mobalytics</span>
            <span class="dim small mono">{moba.slug}</span>
            <button class="btn sm ghost" onclick={() => (moba = null)} disabled={mobaBusy}>Close</button>
          </div>
          <div class="mbody">
            {#if moba.pobCode}
              <div class="mrow">
                <div class="mtext">
                  <div class="mtitle">Path of Building build</div>
                  <div class="dim small">The author's own PoB build: tree, items and gems. The best way to load it here.</div>
                </div>
                <button class="btn primary sm" onclick={mobaImportPob} disabled={mobaBusy || build.busy > 0}>Import</button>
              </div>
            {/if}
            {#if moba.variants.length}
              <div class="mrow">
                <div class="mtext">
                  <div class="mtitle">Build Planner files <span class="dim num">{moba.variants.length}</span></div>
                  <div class="dim small">
                    For the game's own planner. Saved flat into {gameBuilds?.dir ?? "the BuildPlanner folder"}.
                    {#if !moba.pobCode}Opening one here loses any tree nodes the author did not path from the class start.{/if}
                  </div>
                </div>
                <button class="btn sm" class:primary={!moba.pobCode} onclick={mobaSaveAll} disabled={mobaBusy}>Save all</button>
              </div>
              <div class="mvariants">
                {#each moba.variants as v (v.id)}
                  <div class="mvar">
                    <span class="mvname" title={v.name}>{v.name}</span>
                    <span class="dim small num">{v.passives} passives · {v.skills} skills</span>
                    <button class="act" onclick={() => mobaOpenVariant(v)} disabled={mobaBusy || build.busy > 0}>open here</button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if build.loaded}
      <div class="panel-head">
        <span class="label">Current build</span>
        {#if build.info?.unsaved}<span class="dim small">unsaved changes</span>{/if}
      </div>
      <div class="block current">
        <div class="fld">
          <span class="label">Name</span>
          {#if nameDraft !== null}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="input grow"
              bind:value={nameDraft}
              autofocus
              onblur={commitBuildName}
              onkeydown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") (nameDraft = null);
              }}
            />
          {:else}
            <button
              class="bname grow"
              onclick={() => (nameDraft = build.info?.name ?? "")}
              title={(build.info?.file ? `${build.info.file}\n` : "Not saved yet. ") + "Click to rename."}
            >{build.info?.name ?? "—"}</button>
          {/if}
        </div>
        <div class="fld">
          <span class="label">Author</span>
          <input class="input grow" bind:value={author} placeholder="—" title="Written into exported .build files" onblur={commitAuthor} />
        </div>
        <div class="arow">
          <span class="label">Save</span>
          <button class="btn sm" onclick={saveCurrent} title={build.info?.file ?? "Choose a file"}>Save</button>
          <button class="btn sm" onclick={saveAs}>Save as…</button>
        </div>
        <div class="arow">
          <span class="label">Share</span>
          <button class="btn sm" onclick={copyCode}>Copy code</button>
          <span class="joined">
            <button class="btn sm" onclick={shareLink} disabled={sharing} title="Upload the code and copy the link">{sharing ? "Creating link…" : "Link"}</button>
            <select class="select xs" bind:value={shareSite} disabled={sharing}>
              {#each SHARE_SITES as site}<option value={site}>{site}</option>{/each}
            </select>
          </span>
        </div>
        <div class="arow">
          <span class="label">Export</span>
          <button class="btn sm" onclick={exportXml}>XML…</button>
          {#if game.isPoe2}
            <button class="btn sm" onclick={saveGameBuild} title="A file the game's Build Planner can import">Game Build Planner…</button>
          {/if}
        </div>
        {#if shareUrl}
          <div class="arow">
            <input class="input grow mono" readonly value={shareUrl} onfocus={(e) => (e.target as HTMLInputElement).select()} />
            <button class="btn sm" onclick={() => copyToClipboard(shareUrl!, "Link")}>Copy</button>
          </div>
        {/if}
      </div>
    {/if}
    {#if flash}<div class="flash">{flash}</div>{/if}
  </section>
</div>

<style>
  .page {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(360px, 1fr) minmax(360px, 460px);
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
    background: var(--bg-1);
  }
  .toolbar {
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line-0);
  }
  .toolbar .input {
    flex: 1;
    min-width: 100px;
  }
  .vr {
    width: 1px;
    align-self: stretch;
    margin: 2px 2px;
    background: var(--line-1);
  }
  .fdraft {
    width: 150px;
    flex: 0 0 auto;
  }
  .list {
    flex: 1;
    overflow-y: auto;
  }
  .ghead {
    padding: 7px 12px 3px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--fg-3);
    position: sticky;
    top: 0;
    background: var(--bg-0);
    z-index: 1;
  }
  .ghead.gb {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 8px;
    border-top: 1px solid var(--line-0);
    padding-top: 8px;
  }
  .ghead.gb .act {
    margin-left: auto;
  }
  .pdirrow {
    display: flex;
    padding: 2px 10px 6px;
  }
  .ahead {
    appearance: none;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px 4px;
    border: 0;
    background: transparent;
    color: var(--fg-1);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    text-align: left;
  }
  .ahead .ahead-toggle {
    appearance: none;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    cursor: pointer;
    text-align: left;
    padding: 0;
  }
  .ahead .act {
    opacity: 0;
  }
  .ahead:hover .act,
  .ahead .act:focus {
    opacity: 1;
  }
  .ahead.editing {
    padding-right: 10px;
  }
  .ahead:hover {
    color: var(--fg-0);
  }
  .joined {
    display: inline-flex;
    align-items: stretch;
  }
  .joined .btn {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .joined .select {
    height: auto;
    border-left: 0;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .caret {
    display: inline-block;
    color: var(--fg-3);
    transition: transform 100ms;
  }
  .caret.open {
    transform: rotate(90deg);
  }
  .gbrow .name {
    padding-left: 26px;
  }
  .gbrow .gbedit {
    margin: 2px 10px 2px 26px;
  }
  .bname {
    appearance: none;
    border: 1px solid transparent;
    background: none;
    padding: 3px 6px;
    border-radius: var(--r-1);
    color: var(--fg-0);
    font-size: var(--fs-md, 14px);
    text-align: left;
    cursor: text;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bname:hover:not(:disabled) {
    border-color: var(--line-1);
  }
  .bname:disabled {
    color: var(--fg-3);
    cursor: default;
  }
  .recover {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin: 8px 10px;
    padding: 7px 10px;
    border: 1px solid var(--line-1);
    border-left: 2px solid var(--focus);
    border-radius: var(--r-1);
    font-size: var(--fs-xs);
    color: var(--fg-1);
  }
  .acts2 {
    display: flex;
    gap: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px 0 0;
    border-bottom: 1px solid var(--line-0);
    font-size: var(--fs-sm);
  }
  .row:hover {
    background: var(--bg-2);
  }
  .row .name {
    appearance: none;
    border: 0;
    background: none;
    flex: 1;
    min-width: 0;
    padding: 7px 12px;
    color: var(--fg-1);
    text-align: left;
    cursor: pointer;
    font-size: var(--fs-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row:hover .name {
    color: var(--fg-0);
  }
  .row .meta {
    display: flex;
    gap: 14px;
    white-space: nowrap;
    font-size: var(--fs-xs);
    color: var(--fg-2);
  }
  .acts {
    display: flex;
    gap: 2px;
    opacity: 0;
  }
  .row:hover .acts,
  .acts:focus-within {
    opacity: 1;
  }
  .act {
    appearance: none;
    border: 0;
    background: none;
    color: var(--fg-3);
    font-size: var(--fs-xs);
    font-family: var(--mono);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .act:hover {
    background: var(--bg-active);
    color: var(--fg-0);
  }
  .act.danger {
    color: var(--red, #e06c75);
  }
  .select.xs,
  .input.xs {
    height: 20px;
    font-size: var(--fs-xs);
  }
  .block {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .current {
    gap: 6px;
  }
  .fld {
    display: grid;
    grid-template-columns: 52px 1fr;
    align-items: center;
    gap: 8px;
  }
  .fld .grow {
    min-width: 0;
  }
  .arow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .arow .label {
    width: 52px;
    flex: none;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .flash {
    margin: 0 10px;
    padding: 6px 8px;
    border: 1px solid var(--line-1);
    border-radius: var(--r-1);
    font-size: var(--fs-xs);
    color: var(--ok);
  }
  .small {
    font-size: var(--fs-xs);
  }
  .pad {
    padding: 10px 12px;
  }
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    width: 560px;
    max-width: 90vw;
    max-height: 78vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    border: 1px solid var(--line-1);
    border-radius: var(--r-2);
    box-shadow: var(--shadow-modal);
  }
  .mhead {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line-0);
  }
  .mhead .btn {
    margin-left: auto;
  }
  .mbody {
    overflow-y: auto;
    padding: 4px 0 8px;
  }
  .mrow {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
  }
  .mrow + .mrow {
    border-top: 1px solid var(--line-0);
  }
  .mtext {
    flex: 1;
    min-width: 0;
  }
  .mtitle {
    font-size: var(--fs-sm);
    color: var(--fg-0);
    margin-bottom: 2px;
  }
  .mvariants {
    display: flex;
    flex-direction: column;
    padding: 0 6px;
  }
  .mvar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 3px 6px;
    border-radius: 3px;
  }
  .mvar:hover {
    background: var(--bg-2);
  }
  .mvar .act {
    opacity: 0;
  }
  .mvar:hover .act,
  .mvar .act:focus-visible {
    opacity: 1;
  }
  .mvname {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-sm);
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
