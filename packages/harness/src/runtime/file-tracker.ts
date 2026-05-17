import { createHash } from "node:crypto";
import type { DirEntry, FileStat, FsProvider } from "@openharness/core";

type FileStamp = {
  size: number | null;
  hash: string;
};

const SESSION_READS = new Map<string, Map<string, FileStamp>>();

function sessionReads(sessionId: string): Map<string, FileStamp> {
  let reads = SESSION_READS.get(sessionId);
  if (!reads) {
    reads = new Map<string, FileStamp>();
    SESSION_READS.set(sessionId, reads);
  }
  return reads;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function captureStamp(fs: FsProvider, path: string): Promise<FileStamp | null> {
  try {
    const stat = await fs.stat(path);
    const content = await fs.readFile(path);
    return {
      size: typeof stat.size === "number" ? stat.size : null,
      hash: hashContent(content),
    };
  } catch {
    return null;
  }
}

function stampForContent(content: string): FileStamp {
  return {
    size: Buffer.byteLength(content),
    hash: hashContent(content),
  };
}

async function recordRead(
  sessionId: string,
  fs: FsProvider,
  path: string,
  content: string,
): Promise<void> {
  const resolved = fs.resolvePath(path);
  const stamp = stampForContent(content);
  sessionReads(sessionId).set(resolved, stamp);
}

async function assertWriteAllowed(sessionId: string, fs: FsProvider, path: string): Promise<void> {
  const resolved = fs.resolvePath(path);
  const reads = sessionReads(sessionId);
  const previous = reads.get(resolved);
  const current = await captureStamp(fs, path);
  const exists = await fs.exists(path).catch(() => false);

  if (!previous) {
    if (!current && !exists) {
      return;
    }

    throw new Error(`You must read ${resolved} before editing it.`);
  }

  if (!current) {
    if (exists) {
      throw new Error(`Unable to verify file state before writing: ${resolved}`);
    }

    return;
  }

  if (current.hash !== previous.hash || current.size !== previous.size) {
    throw new Error(`File changed since last read: ${resolved}`);
  }
}

function markWritten(sessionId: string, fs: FsProvider, path: string, content: string): void {
  const resolved = fs.resolvePath(path);
  if (!resolved) {
    return;
  }

  sessionReads(sessionId).set(resolved, stampForContent(content));
}

export function createTrackedFsProvider(base: FsProvider, sessionId: string): FsProvider {
  return {
    async readFile(path: string): Promise<string> {
      const output = await base.readFile(path);
      await recordRead(sessionId, base, path, output);
      return output;
    },

    async writeFile(path: string, content: string): Promise<void> {
      await assertWriteAllowed(sessionId, base, path);
      await base.writeFile(path, content);
      markWritten(sessionId, base, path, content);
    },

    async exists(path: string): Promise<boolean> {
      return base.exists(path);
    },

    async stat(path: string): Promise<FileStat> {
      return base.stat(path);
    },

    async readdir(path: string): Promise<DirEntry[]> {
      return base.readdir(path);
    },

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      await base.mkdir(path, options);
    },

    async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
      await base.remove(path, options);
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      await base.rename(oldPath, newPath);
    },

    resolvePath(path: string): string {
      return base.resolvePath(path);
    },
  };
}
