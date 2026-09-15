# Contributing

Issues and pull requests are welcome.

Before a pull request, run `bun run check` and the headless checks below, then open one of your builds
in the app and compare the sidebar against Path of Building itself.

Keep the numbers PoB's own. Do not reimplement calculations in Rust or TypeScript.

## Build

You need:

- Rust stable. On Windows, the MSVC toolchain. The first build compiles LuaJIT.
- Bun 1.4 or newer. This is what CI uses.
- Tauri's platform prerequisites. Windows: WebView2. Linux: `libwebkit2gtk-4.1-dev`,
  `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libssl-dev`. macOS: the Command Line Tools,
  with the licence accepted (`sudo xcodebuild -license accept`); the system WKWebView needs nothing
  installed. See [MACOS.md](MACOS.md).
- A checkout of [PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)
  next to this repo, or `POB_SOURCE` set to its path.

```sh
bun install
bun run sync          # copy PoB's Lua and data into src-tauri/resources/pob. Run this first.
bun run sync:fast     # same, but keep the decoded tree art from the last sync
bun run tauri dev     # run the app with hot reload
bun run tauri build   # installers land in target/release/bundle/
bun run check         # type-check the frontend
```

CI runs the same steps on every push and uploads the installer and the Linux packages as artifacts.

If `NoDefaultCurrentDirectoryInExePath` is set in your shell, unset it before the first build. LuaJIT's
`msvcbuild.bat` needs cmd.exe to find `minilua` in the current directory.

## Layout

```
pob-redux/
  crates/pob-engine/   headless PoB: LuaJIT host shim, JSON bridge, worker engine pool, `pobctl` CLI
  crates/pob-sync/     copies a PathOfBuilding-PoE2 checkout into src-tauri/resources/pob
  src-tauri/           Tauri app: engine thread, commands, `pob://` asset protocol, MCP server
  src/                 Svelte frontend
  pob-sync.toml        upstream checkout path and pinned commit
```

## Update the bundled PoB data

The installer bundles PoB's Lua and game data. The app never downloads data while it runs, and PoB's
built-in updater is stubbed out. To move to a newer PoB:

1. Pull the PathOfBuilding-PoE2 checkout.
2. Put the new commit hash in `pob-sync.toml`. `bun run sync` refuses to run if the checkout's HEAD
   differs from that pin. Pass `--allow-commit-mismatch` to override.
3. Run `bun run sync`. Use the full sync when the tree changed, because tree art is decoded only with
   `--tree-assets`.
4. Run the checks below, then open one of your builds and compare the sidebar against Path of
   Building. `lua/bridge.lua` drives PoB's internals, so an upstream refactor can break it.
5. Build and release. CI reads the pin from `pob-sync.toml` and checks out that exact commit, so the
   repo alone describes a release.

Users get new data with a new app release. The status bar shows the bundled PoB version and commit.
Do not edit files under `src-tauri/resources/pob/`, because the next sync overwrites them.

## Run checks without the UI

`pobctl` drives the engine from the command line.

```sh
bun run ctl -- --pob-root src-tauri/resources/pob methods            # list bridge methods
bun run ctl -- --pob-root src-tauri/resources/pob call get_build     # call one method
bun run ctl -- --pob-root src-tauri/resources/pob stats build.xml    # load a build, print its sidebar
bun run ctl -- --pob-root src-tauri/resources/pob bench              # time full recalculations

# parallel scoring against the sequential path; mismatches must be 0
bun run ctl -- --pob-root src-tauri/resources/pob power build.xml --stat Life --pool 8
bun run ctl -- --pob-root src-tauri/resources/pob gems build.xml --group 1 --pool 8
```

With the app running and its MCP server on, `bun run mcp` calls the same tools an AI client would, and
`bun run check:tools` guards the assistant's tool lists against the live registry.

## Where builds are stored

PoB Redux reads and writes the same folder as Path of Building:
`Documents/Path of Building (PoE2)/Builds`. It reads PoB's `Settings.xml` to find a custom build path,
and never writes that file.

| Variable | Effect |
|---|---|
| `POB_REDUX_USER_DIR` | Parent folder for `Path of Building (PoE2)/`. Default: Documents |
| `POB_REDUX_POB_ROOT` | Use this PoB data folder instead of the bundled one |
| `POB_REDUX_OPEN` | Build XML to open at launch. The first argument does the same |
| `POB_REDUX_POOL` | Worker engines for node power and gem scoring. They boot on the first scan and are released two minutes after the last. Default: half the cores, at most 8 |
| `POB_REDUX_MCP` | Start the MCP server on this port at launch, whatever the saved setting says |
