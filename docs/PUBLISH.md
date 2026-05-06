# Publishing Archer CLI

This repo is a Bun monorepo. The publishable npm package is:

- `apps/cli`
- package name: `@adarshaacharya/archer`

## 1. Prerequisites

- npm account with access to scope `@adarshaacharya`
- Logged in to npm:

```bash
npm login
```

## 2. Build And Validate Package

From repo root:

```bash
cd apps/cli
bun run build
npm pack --dry-run
```

Expected:
- tarball name like `adarshaacharya-archer-<version>.tgz`
- contents from `dist/` only

## 3. Publish

From `apps/cli`:

```bash
npm publish --access public
```

## 4. If npm Cache Permission Fails

If you see errors about `~/.npm/_cacache` permissions, use a temp cache:

```bash
npm_config_cache=/tmp/npm-cache npm pack --dry-run
npm_config_cache=/tmp/npm-cache npm publish --access public
```

## 5. Verify Install

After publish:

```bash
npx @adarshaacharya/archer --help
```

## 6. Version Bump For Next Release

Before publishing an update, bump `apps/cli/package.json` version:

```bash
bun run bump:cli:patch
```

Use `minor` or `major` instead of `patch` when appropriate.
You can also set an exact version:

```bash
bun run bump:cli -- 0.1.1
```

## 7. CI Release Flow (Recommended)

This repo includes `.github/workflows/cli-release.yml`:

- Push/PR to `master`: runs lint, typecheck, and build.
- Push a tag like `v0.1.1`: runs checks, then publishes to npm.

Release command sequence:
```bash
bun run bump:cli:patch
git add apps/cli/package.json
git commit -m "Release v0.1.1"
git tag v0.1.1
git push origin v0.1.1
```

For this to work, enable npm Trusted Publishing for this GitHub repository in npm package settings.
