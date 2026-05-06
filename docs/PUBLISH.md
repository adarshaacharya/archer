# Releasing Archer CLI

Archer is distributed as release binaries, not as a published npm package.

## 1. Local Binary Build

Build the current platform binary from the repo root:

```bash
bun run build:binary
```

Package it into a release archive:

```bash
bun run package:binary
```

The archive is written to `apps/cli/release/`.

## 2. Native Runner Matrix

The full release matrix is built in CI on matching native runners because the TUI layer loads platform-specific OpenTUI packages at build time.

Current targets:

- `archer-darwin-arm64.tar.gz` on `macos-14`
- `archer-darwin-x64.tar.gz` on `macos-15-intel`
- `archer-linux-arm64.tar.gz` on `ubuntu-24.04-arm`
- `archer-linux-x64.tar.gz` on `ubuntu-24.04`

If you need to build a specific target manually, do it on a matching machine or runner:

```bash
ARCHER_TARGET=bun-darwin-arm64 bun run --filter @adarshaacharya/archer package:binary
```

Produced asset names:

- `archer-darwin-arm64.tar.gz`
- `archer-darwin-x64.tar.gz`
- `archer-linux-arm64.tar.gz`
- `archer-linux-x64.tar.gz`

## 3. Version Bump

Bump the CLI version in `apps/cli/package.json` before tagging a release:

```bash
bun run bump:cli:patch
```

Use `minor` or `major` instead of `patch` when appropriate.
You can also set an exact version:

```bash
bun run bump:cli -- 0.1.1
```

## 4. CI Release Flow

`.github/workflows/cli-release.yml` now does this:

- Push/PR to `main`: runs lint, typecheck, and build.
- Push a tag like `v0.1.1`: builds release archives for macOS and Linux targets, then uploads them to the GitHub Release.

Release command sequence:

```bash
bun run bump:cli:patch
git add apps/cli/package.json
git commit -m "Release v0.1.1"
git tag v0.1.1
git push origin v0.1.1
```

## 5. Installer Contract

The public installer at `apps/web/public/install.sh` expects each GitHub release to include these exact asset names:

- `archer-darwin-arm64.tar.gz`
- `archer-darwin-x64.tar.gz`
- `archer-linux-arm64.tar.gz`
- `archer-linux-x64.tar.gz`
