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

4. Tag and push.
```bash
git tag vX.Y.Z
git push origin main --tags
```

5. Confirm GitHub Actions `CLI Release` passes:
- `Publish npm Package` job publishes `@adarshaacharya/archer`
- GitHub Release includes:
- `archer-darwin-arm64.tar.gz`
- `archer-darwin-x64.tar.gz`
- `archer-linux-arm64.tar.gz`
- `archer-linux-x64.tar.gz`
