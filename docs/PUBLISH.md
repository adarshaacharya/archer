# Publishing Archer CLI

This repo is a Bun monorepo. The publishable npm package is:

- `apps/cli`
- package name: `@adartsahacahrya/archer`

## 1. Prerequisites

- npm account with access to scope `@adartsahacahrya`
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
- tarball name like `adartsahacahrya-archer-<version>.tgz`
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
npx @adartsahacahrya/archer --help
```

## 6. Version Bump For Next Release

Before publishing an update, bump `apps/cli/package.json` version:

```bash
cd apps/cli
npm version patch
npm publish --access public
```

Use `minor` or `major` instead of `patch` when appropriate.
