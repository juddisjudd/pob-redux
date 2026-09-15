# macOS

Apple Silicon (arm64). Intel Macs are not built.

## Running it

Download the `.dmg`, drag the app to Applications, done. Nothing else to install: the app uses the
system WKWebView, so there is no equivalent of the WebView2 download on Windows or the
`libwebkit2gtk` packages on Linux.

Builds live in `~/Documents/Path of Building (PoE2)/Builds` and `~/Documents/Path of Building/Builds`,
the same as every other platform, so a Path of Building install shares the same files.

Until the app is signed with a Developer ID and notarized, Gatekeeper refuses it on first launch with
*"cannot be opened because the developer cannot be verified"*. Right-click the app and choose **Open**,
which offers the same dialog with an Open button, or clear the quarantine flag:

```sh
xattr -dr com.apple.quarantine "/Applications/PoB Redux.app"
```

## Building it

Only for working on the app. Users do not need any of this.

Most Macs already have Homebrew and the Apple toolchain. On the machine this port was developed on,
already present were **Homebrew 6.0.22**, **Xcode 27.0** and **Node 26.8.2** (Homebrew). Newly
installed were **Rust 1.98.1** and **Bun 1.4.2**.

A C compiler is required because the first build compiles LuaJIT from source. Full Xcode works; the
Command Line Tools alone are normally enough (`xcode-select --install`). Either way the licence must
be accepted once, or `clang` refuses to run and the build fails on LuaJIT:

```sh
sudo xcodebuild -license accept
```

Then:

```sh
brew install oven-sh/bun/bun
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Rustup does not touch your `PATH` unless you let it, so add Cargo to the shell if you skipped that:

```sh
echo '. "$HOME/.cargo/env"' >> ~/.zshrc
```

Path of Building itself is not vendored in this repo. Clone both upstreams next to it at the commits
pinned in `pob-sync.toml`, or point `POB_SOURCE` at them:

```sh
cd ..
git clone https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git
git clone https://github.com/PathOfBuildingCommunity/PathOfBuilding.git
cd pob-redux
bun install
bun run sync          # vendors both into src-tauri/resources. Run before the first build.
bun run tauri build   # .app and .dmg land in target/release/bundle/
```

Expect roughly 7 GB once everything is in place: about 2 GB of upstream git history, 480 MB vendored
into `src-tauri/resources`, and a `target/` directory that reaches 4.7 GB.

## Signing

Ad-hoc builds run fine locally, and that is what `bun run tauri build` produces without a signing
identity. Hardened runtime is off in that case, so LuaJIT's JIT is unrestricted.

Signing with a Developer ID turns hardened runtime on, and that is when `entitlements.plist` starts to
matter: PoB's calculations run under LuaJIT, whose trace compiler writes native arm64 code and then
executes it, which the hardened runtime blocks without `com.apple.security.cs.allow-jit`. The
entitlement is declared in `tauri.conf.json` but has not been exercised, because doing so needs a paid
Apple Developer account.
