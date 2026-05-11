# CLI Release (npm + Binaries)

## Release steps

1. Sync `main` and confirm clean working tree.
```bash
git checkout main
git pull origin main
git status
```

2. Bump the CLI version.
```bash
bun run bump:cli:patch
# or: bun run bump:cli:minor
# or: bun run bump:cli:major
```

3. Commit the version change.
```bash
git add apps/cli/package.json
git commit -m "Release vX.Y.Z"
```

4. Tag the release commit after the version bump commit exists.
```bash
git tag vX.Y.Z
git show --stat --oneline vX.Y.Z
```

The tag must point at the release commit you just created. Do not tag first and bump later.

5. Push `main` and the tag.
```bash
git push origin main --tags
```

6. Confirm GitHub Actions `CLI Release` passes:
- `Publish npm Package` job publishes `@adarshaacharya/archer`
- GitHub Release includes:
- `archer-darwin-arm64.tar.gz`
- `archer-darwin-x64.tar.gz`
- `archer-linux-arm64.tar.gz`
- `archer-linux-x64.tar.gz`

## Manual Run

You can also trigger the workflow from GitHub Actions with `workflow_dispatch`.

Use that for:
- re-running checks manually
- testing workflow changes
- debugging release packaging without creating a new tag

Release jobs still only publish assets and npm packages when the ref is a `v*` tag.


## Full flow:

```bash
bun run bump:cli:patch
  git add .
  git commit -m "chore: bump version to 0.1.21"
  git tag v0.1.21
  git push origin main --tags
```