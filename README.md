# PoB Redux

[![Latest release](https://img.shields.io/github/v/release/juddisjudd/pob-redux?style=flat-square&label=release)](../../releases/latest)
[![Downloads](https://img.shields.io/github/downloads/juddisjudd/pob-redux/total?style=flat-square&label=downloads)](../../releases)
[![Latest release downloads](https://img.shields.io/github/downloads/juddisjudd/pob-redux/latest/total?style=flat-square&label=latest%20downloads)](../../releases/latest)
[![Check](https://img.shields.io/github/actions/workflow/status/juddisjudd/pob-redux/check.yml?branch=main&style=flat-square&label=check)](../../actions/workflows/check.yml)
[![Release build](https://img.shields.io/github/actions/workflow/status/juddisjudd/pob-redux/release.yml?style=flat-square&label=release%20build)](../../actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2a2a30?style=flat-square)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/juddisjudd/pob-redux?style=flat-square)](../../commits/main)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-2a2a30?style=flat-square)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202%20%2B%20Svelte%205-2a2a30?style=flat-square)

A modern Path of Building UI for Path of Exile 1 and 2, powered by the community projects. Pick a game
on first start and switch any time from the title bar; each game runs its own Path of Building.

[![PoB Redux: a modern Path of Building for Path of Exile 1 and 2](https://pobredux.com/assets/og.png)](https://pobredux.com)

## Download

Download from [pobredux.com](https://pobredux.com), which picks the installer for your system, or get
`PoB Redux_<version>_x64-setup.exe` from the [Releases](../../releases) page and run it. It installs
for the current user only, and fetches the WebView2 runtime if Windows does not have it.

Your builds stay where Path of Building keeps them, in `Documents/Path of Building (PoE2)/Builds` and
`Documents/Path of Building/Builds`, so both apps can open the same files.

Windows is the current target. CI also builds Linux packages, but nobody has tested them yet.

macOS builds run on Apple Silicon: take the `.dmg` and see [MACOS.md](MACOS.md). It is not
signed or notarized yet, so Gatekeeper needs a right-click → Open on first launch.

## Features

Every Path of Building tab is here, with PoB's own numbers, tooltips and breakdowns: tree, skills,
items, calcs, config, notes, party and builds. The calculations are Path of Building Community's own
Lua code, run headless, so the numbers match.

Builds import from share codes, PoB XML, GGG's `.build` planner files, and links from pobb.in,
Maxroll, Mobalytics, poe.ninja, poe2db.tw, poedb.tw, Pastebin and Rentry. A build from the other game
switches the app to it. The assistant, the MCP server and the Build Planner import are PoE2 features
for now.

Three things are new.

### Optimise

A tab that improves a build using PoB's calculation rather than a model. It reviews the build and
ranks what is wrong, with a fix for each. It designs a rare for any slot by searching the real mod
pool, and ranks passive nodes by what they gain per point. No account or key needed.

### Assistant

An optional chat panel that answers questions about the open build and can change it. Bring your own
key: Anthropic, OpenAI, OpenRouter, OpenCode Zen, or Ollama, local or cloud. Keys go in your operating
system's credential store, and requests are made from Rust, so a key never reaches the web view.

| Mode | Behaviour |
|---|---|
| Ask | Reads only. Explains and recommends without changing anything. |
| Build | Changes the build, asking you before each one. |
| Try | Checkpoints first, then changes freely. Keep or undo the lot at the end. |

Try is for comparing options. Because every change is reversible in one click, the assistant can try
each candidate and read its numbers instead of reasoning about which is better.

### MCP server

An optional local server, off by default, so an AI client such as Claude Code, Claude Desktop or
Cursor can read and edit the build that is open. Turn it on in Options, the gear in the status bar,
which shows the URL, the access token and ready-made client config.

It listens on `127.0.0.1` only, stops when the app closes, and every request needs a bearer token, so
no other program on your machine can drive your build without it. The tools cover loading builds,
reading stats, the passive tree, items, gems, config, and saving or exporting.

## Contributing

Issues and pull requests are welcome. You need Rust stable, Bun, and a checkout of
[PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2) next to this
repo.

```sh
bun install
bun run sync          # copy PoB's Lua and data into src-tauri/resources/pob. Run this first.
bun run tauri dev     # run the app with hot reload
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the rest: full prerequisites, project layout, updating the
bundled PoB data, the `pobctl` command line, and the environment variables.

Keep the numbers PoB's own. Do not reimplement calculations in Rust or TypeScript.

## Credits

PoB Redux is a shell. The hard part, the calculations, belongs to other people.

- **[Path of Building Community](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)**
  maintains the Path of Exile 2 fork and the
  [Path of Exile 1 project](https://github.com/PathOfBuildingCommunity/PathOfBuilding) whose Lua code
  and game data this app runs and bundles, one per game. Every
  number PoB Redux shows comes from their work.

Built with [LuaJIT](https://luajit.org) through [mlua](https://github.com/mlua-rs/mlua),
[Tauri](https://tauri.app), [Svelte](https://svelte.dev), [Rust](https://www.rust-lang.org),
[rmcp](https://github.com/modelcontextprotocol/rust-sdk) for the MCP server, and the
[AI SDK](https://ai-sdk.dev) for the assistant.

## Licence

MIT. See [LICENSE](LICENSE).

Path of Building Community is MIT as well, and its licence file is bundled with the app.
