import type { RuntimeProviders } from "../harness-types.js";
import type { HarnessToolRouter } from "./tool-router.js";

type ShellArgs = {
  command?: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
};

type FileArgs = {
  filePath?: string;
  content?: string;
};

type DirArgs = {
  dirPath?: string;
  recursive?: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

export function registerDefaultHarnessTools(
  router: HarnessToolRouter,
  providers: RuntimeProviders,
): void {
  router.registerTool("readFile", async (args) => {
    const input = asObject(args) as FileArgs;
    const filePath = requireString(input.filePath, "filePath");
    return {
      filePath: providers.fs.resolvePath(filePath),
      content: await providers.fs.readFile(filePath),
    };
  });

  router.registerTool("writeFile", async (args) => {
    const input = asObject(args) as FileArgs;
    const filePath = requireString(input.filePath, "filePath");
    const content = typeof input.content === "string" ? input.content : "";
    await providers.fs.writeFile(filePath, content);
    return {
      filePath: providers.fs.resolvePath(filePath),
      written: true,
    };
  });

  router.registerTool("editFile", async (args) => {
    const input = asObject(args) as FileArgs;
    const filePath = requireString(input.filePath, "filePath");
    const content = typeof input.content === "string" ? input.content : "";
    await providers.fs.writeFile(filePath, content);
    return {
      filePath: providers.fs.resolvePath(filePath),
      edited: true,
    };
  });

  router.registerTool("deleteFile", async (args) => {
    const input = asObject(args) as FileArgs;
    const filePath = requireString(input.filePath, "filePath");
    await providers.fs.remove(filePath, { recursive: false });
    return {
      filePath: providers.fs.resolvePath(filePath),
      deleted: true,
    };
  });

  router.registerTool("createDirectory", async (args) => {
    const input = asObject(args) as DirArgs;
    const dirPath = requireString(input.dirPath, "dirPath");
    const recursive = input.recursive !== false;
    await providers.fs.mkdir(dirPath, { recursive });
    return {
      dirPath: providers.fs.resolvePath(dirPath),
      created: true,
      recursive,
    };
  });

  router.registerTool("listFiles", async (args) => {
    const input = asObject(args) as { path?: string };
    const path = typeof input.path === "string" && input.path.trim() ? input.path : ".";
    const entries = await providers.fs.readdir(path);
    return {
      path: providers.fs.resolvePath(path),
      entries: entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
      })),
    };
  });

  router.registerTool("bash", async (args) => {
    const input = asObject(args) as ShellArgs;
    const command = requireString(input.command, "command");
    const result = await providers.shell.exec(command, {
      cwd: input.cwd,
      timeout: input.timeout,
      env: input.env,
    });
    return result;
  });
}
