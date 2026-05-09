export function resolveProjectRoot(startDir: string): string {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd: startDir,
    stdout: "pipe",
    stderr: "ignore",
  });

  if (result.exitCode === 0) {
    const root = new TextDecoder().decode(result.stdout).trim();
    if (root) {
      return root;
    }
  }

  return startDir;
}
