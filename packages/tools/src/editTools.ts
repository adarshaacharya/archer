import type { FsProvider } from "@openharness/core";
import { tool } from "ai";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";

type PreparedPatch = {
  patchId: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  diff: string;
};

function newPatchId(): string {
  return `patch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEditTools(fs: FsProvider) {
  const patches = new Map<string, PreparedPatch>();

  const preparePatch = tool({
    description:
      "Prepare a patch for a file change, returning a unified diff preview before anything is written.",
    inputSchema: z.object({
      filePath: z.string().min(1),
      content: z.string(),
    }),
    execute: async (input) => {
      const filePath = input.filePath;
      const resolvedPath = fs.resolvePath(filePath);
      let oldContent = "";

      try {
        oldContent = await fs.readFile(filePath);
      } catch {
        oldContent = "";
      }

      const newContent = input.content;
      const diff = createTwoFilesPatch(resolvedPath, resolvedPath, oldContent, newContent, "", "", {
        context: 3,
      });

      const patchId = newPatchId();
      patches.set(patchId, {
        patchId,
        filePath,
        oldContent,
        newContent,
        diff,
      });

      return {
        patchId,
        filePath: resolvedPath,
        status: oldContent === newContent ? "no-op" : "prepared",
        diff,
      };
    },
  });

  const applyPatch = tool({
    description:
      "Apply a previously prepared patch to disk. Use this after reviewing the diff preview.",
    inputSchema: z.object({
      patchId: z.string().min(1),
    }),
    execute: async (input) => {
      const patch = patches.get(input.patchId);
      if (!patch) {
        return {
          error: `Unknown patch id: ${input.patchId}`,
        };
      }

      await fs.writeFile(patch.filePath, patch.newContent);
      patches.delete(input.patchId);

      return {
        patchId: input.patchId,
        filePath: fs.resolvePath(patch.filePath),
        status: "applied",
        diff: patch.diff,
      };
    },
  });

  const describePatch = (patchId: string): PreparedPatch | null => patches.get(patchId) ?? null;

  return {
    preparePatch,
    applyPatch,
    describePatch,
  };
}
