import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import type { HarnessDirEntry, HarnessFileStat, HarnessFsProvider } from "@archer/shared/runtime";

export class NodeFsProvider implements HarnessFsProvider {
  constructor(private readonly options: { cwd: string }) {}

  resolvePath(path: string): string {
    if (path.startsWith("/")) return path;
    return resolve(this.options.cwd, path);
  }

  async readFile(path: string): Promise<string> {
    return fs.readFile(this.resolvePath(path), "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    await fs.writeFile(this.resolvePath(path), content, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(path));
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<HarnessFileStat> {
    const result = await fs.stat(this.resolvePath(path));
    return {
      size: result.size,
      mtimeMs: result.mtimeMs,
      isDirectory: result.isDirectory(),
      isFile: result.isFile(),
    };
  }

  async readdir(path: string): Promise<HarnessDirEntry[]> {
    const entries = await fs.readdir(this.resolvePath(path), { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(this.resolvePath(path), { recursive: options?.recursive ?? false });
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.rm(this.resolvePath(path), { recursive: options?.recursive ?? false, force: false });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(this.resolvePath(oldPath), this.resolvePath(newPath));
  }
}
