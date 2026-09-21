`scalpel-item-data-0.1.1.tgz` is the versioned `@scalpel/item-data` package,
maintained in Scalpel's `packages/item-data`. Both applications consume the same
PoE 1 and PoE 2 name-to-CDN-URL maps; item images stay on GGG's CDN.
The package also bundles the user's seven custom socket/link PNGs, exported
under `@scalpel/item-data/sockets/`. PoE 1 W uses the grey `socket-colorless.png`;
PoE 2 uses `socket-rune-poe2.png`.

SHA-256: `3280eb94e24f1f26d48e4d9f62fb942bb849ed4f731173d1a8cc20e7f8229bf0`

Source: Scalpel's `packages/item-data`, prepared on `codex/shared-socket-art`.
Version 0.1.1 is a local package artifact, not a registry release. Its item maps
are unchanged from [Scalpel PR #638](https://github.com/scalpelpoe/scalpel/pull/638).

Until a registry or immutable release URL is available, the package artifact is
committed here so clean installs do not require a sibling Scalpel checkout.
To update, obtain a new versioned artifact from the canonical package, verify its
checksum, and run `bun add --exact ./vendor/scalpel-item-data-<version>.tgz`.
Commit the artifact, package manifest, and lockfile together. Do not edit the maps
in PoB-R; changes belong in Scalpel's package source.
