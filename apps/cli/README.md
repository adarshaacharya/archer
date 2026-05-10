<p align="left">
  <img src="https://raw.githubusercontent.com/adarshaacharya/archer/refs/heads/main/apps/web/public/logos/banner.png" alt="Archer banner" width="240" />
</p>

# Archer CLI

AI coding agent that runs in your terminal, works inside your repo, and uses your own API keys, totally free to use.


## Install

```bash
curl -fsSL https://usearcher.vercel.app/install.sh | bash
```

or using bun:

```bash
bun install -g @adarshaacharya/archer
```

The installer downloads the latest release binary for your platform and installs the app under `~/.local/share/archer` with a launcher in `~/.local/bin`.
After installing from the release script, run `archer update` or `archer --update` to upgrade to the latest release.
If you installed Archer with `bun install -g`, update it with Bun instead of the built-in updater.

## Quick Start

```bash
archer

# Give it a task can be feature, bug, etc.
```
