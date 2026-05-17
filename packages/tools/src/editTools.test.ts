import { describe, expect, it } from "bun:test";
import type { HarnessDirEntry, HarnessFileStat, HarnessFsProvider } from "@archer/shared/runtime";
import { createEditTools } from "./editTools.js";

class MemoryFsProvider implements HarnessFsProvider {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>(["/repo"]);

  resolvePath(path: string): string {
    if (path.startsWith("/")) return path;
    return `/repo/${path.replace(/^\.?\//, "")}`;
  }

  async readFile(path: string): Promise<string> {
    const resolved = this.resolvePath(path);
    const content = this.files.get(resolved);
    if (content == null) {
      throw new Error(`ENOENT: no such file, open '${resolved}'`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const resolved = this.resolvePath(path);
    const parent = resolved.slice(0, resolved.lastIndexOf("/")) || "/";
    if (!this.directories.has(parent)) {
      throw new Error(`ENOENT: no such file or directory, open '${resolved}'`);
    }
    this.files.set(resolved, content);
  }

  async exists(path: string): Promise<boolean> {
    const resolved = this.resolvePath(path);
    return this.files.has(resolved) || this.directories.has(resolved);
  }

  async stat(path: string): Promise<HarnessFileStat> {
    const resolved = this.resolvePath(path);
    if (this.files.has(resolved)) {
      const content = this.files.get(resolved) ?? "";
      return {
        size: Buffer.byteLength(content),
        mtimeMs: Date.now(),
        isDirectory: false,
        isFile: true,
      };
    }
    if (this.directories.has(resolved)) {
      return {
        size: 0,
        mtimeMs: Date.now(),
        isDirectory: true,
        isFile: false,
      };
    }
    throw new Error(`ENOENT: no such file or directory, stat '${resolved}'`);
  }

  async readdir(path: string): Promise<HarnessDirEntry[]> {
    const resolved = this.resolvePath(path);
    if (!this.directories.has(resolved)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${resolved}'`);
    }
    return [];
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = this.resolvePath(path);
    if (options?.recursive) {
      const parts = resolved.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current += `/${part}`;
        this.directories.add(current);
      }
      return;
    }

    const parent = resolved.slice(0, resolved.lastIndexOf("/")) || "/";
    if (!this.directories.has(parent)) {
      throw new Error(`ENOENT: no such file or directory, mkdir '${resolved}'`);
    }
    this.directories.add(resolved);
  }

  async remove(_path: string, _options?: { recursive?: boolean }): Promise<void> {
    throw new Error("not implemented");
  }

  async rename(_oldPath: string, _newPath: string): Promise<void> {
    throw new Error("not implemented");
  }

  hasDirectory(path: string): boolean {
    return this.directories.has(this.resolvePath(path));
  }

  fileContent(path: string): string | undefined {
    return this.files.get(this.resolvePath(path));
  }
}

describe("createEditTools", () => {
  it("creates a directory explicitly", async () => {
    const fs = new MemoryFsProvider();
    const tools = createEditTools(fs);

    const result = await tools.createDirectory.execute?.(
      { dirPath: "lib/utils", recursive: true },
      { toolCallId: "test", messages: [] },
    );

    expect(result).toEqual({
      dirPath: "/repo/lib/utils",
      created: true,
      recursive: true,
    });
    expect(fs.hasDirectory("lib/utils")).toBe(true);
  });

  it("creates missing parent directories before applying a new-file patch", async () => {
    const fs = new MemoryFsProvider();
    const tools = createEditTools(fs, {
      onPatchPreview: async () => true,
    });

    const result = await tools.preparePatch.execute?.(
      {
        filePath: "lib/date.ts",
        content: "export const value = 1;\n",
      },
      { toolCallId: "test", messages: [] },
    );

    expect(fs.hasDirectory("lib")).toBe(true);
    expect(fs.fileContent("lib/date.ts")).toBe("export const value = 1;\n");
    if (!result || Symbol.asyncIterator in result) {
      throw new Error("Expected a direct patch result");
    }
    expect(result.status).toBe("applied");
  });
});
