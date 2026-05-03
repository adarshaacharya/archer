import { dirname } from "node:path";
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

type PreparedPatchBundle = {
  bundleId: string;
  patchIds: string[];
  summary: string;
};

type PatchPreview = {
  patchId: string;
  filePath: string;
  status: "prepared" | "no-op" | "rejected" | "applied";
  diff: string;
};

type AppliedPatch = {
  patchId: string;
  filePath: string;
  status: "applied";
  diff: string;
};

type AppliedPatchBundle = {
  bundleId: string;
  status: "applied";
  files: Array<{
    patchId: string;
    filePath: string;
  }>;
};

function newPatchId(): string {
  return `patch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function newBundleId(): string {
  return `bundle_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildDiff(filePath: string, oldContent: string, newContent: string): string {
  const resolvedPath = filePath;
  return createTwoFilesPatch(resolvedPath, resolvedPath, oldContent, newContent, "", "", {
    context: 2,
  });
}

type EditToolsOptions = {
  onPatchPreview?: (
    preview:
      | PatchPreview
      | { bundleId: string; summary: string; changedFilesCount: number; files: PatchPreview[] },
  ) => Promise<boolean> | boolean;
};

export function createEditTools(fs: FsProvider, options: EditToolsOptions = {}) {
  const patches = new Map<string, PreparedPatch>();
  const bundles = new Map<string, PreparedPatchBundle>();
  const appliedPatches = new Map<string, AppliedPatch>();
  const appliedBundles = new Map<string, AppliedPatchBundle>();

  async function commitPatch(patch: PreparedPatch): Promise<AppliedPatch> {
    await fs.mkdir(dirname(patch.filePath), { recursive: true });
    await fs.writeFile(patch.filePath, patch.newContent);
    const applied: AppliedPatch = {
      patchId: patch.patchId,
      filePath: fs.resolvePath(patch.filePath),
      status: "applied",
      diff: patch.diff,
    };
    patches.delete(patch.patchId);
    appliedPatches.set(patch.patchId, applied);
    return applied;
  }

  async function commitBundle(bundle: PreparedPatchBundle): Promise<AppliedPatchBundle> {
    const files: AppliedPatchBundle["files"] = [];
    for (const patchId of bundle.patchIds) {
      const patch = patches.get(patchId);
      if (!patch) {
        continue;
      }
      const applied = await commitPatch(patch);
      files.push({
        patchId: applied.patchId,
        filePath: applied.filePath,
      });
    }

    const appliedBundle: AppliedPatchBundle = {
      bundleId: bundle.bundleId,
      status: "applied",
      files,
    };
    bundles.delete(bundle.bundleId);
    appliedBundles.set(bundle.bundleId, appliedBundle);
    return appliedBundle;
  }

  async function prepareSinglePatch(filePath: string, content: string): Promise<PatchPreview> {
    const resolvedPath = fs.resolvePath(filePath);
    let oldContent = "";

    try {
      oldContent = await fs.readFile(filePath);
    } catch {
      oldContent = "";
    }

    const diff = buildDiff(resolvedPath, oldContent, content);
    const patchId = newPatchId();
    const prepared = {
      patchId,
      filePath,
      oldContent,
      newContent: content,
      diff,
    };
    patches.set(patchId, prepared);

    const preview: PatchPreview = {
      patchId,
      filePath: resolvedPath,
      status: oldContent === content ? "no-op" : "prepared",
      diff,
    };

    if (preview.status !== "no-op" && options.onPatchPreview) {
      const approved = await options.onPatchPreview(preview);
      if (!approved) {
        patches.delete(patchId);
        preview.status = "rejected";
      } else {
        const applied = await commitPatch(prepared);
        preview.status = "prepared";
        return {
          patchId: applied.patchId,
          filePath: applied.filePath,
          status: "applied",
          diff: applied.diff,
        };
      }
    }

    return preview;
  }

  const preparePatchBundle = tool({
    description:
      "Prepare a bundle of file changes, returning unified diff previews for each file before anything is written.",
    inputSchema: z.object({
      files: z
        .array(
          z.object({
            filePath: z.string().min(1),
            content: z.string(),
          }),
        )
        .min(1),
    }),
    execute: async (input) => {
      const previews: PatchPreview[] = [];
      for (const file of input.files) {
        previews.push(await prepareSinglePatch(file.filePath, file.content));
      }

      const bundleId = newBundleId();
      const bundle = {
        bundleId,
        patchIds: previews.map((preview) => preview.patchId),
        summary: `${previews.length} file${previews.length === 1 ? "" : "s"} prepared`,
      };
      bundles.set(bundleId, bundle);

      if (options.onPatchPreview) {
        const approved = await options.onPatchPreview({
          bundleId,
          summary: bundle.summary,
          changedFilesCount: previews.filter((preview) => preview.status !== "no-op").length,
          files: previews,
        });
        if (!approved) {
          for (const patchId of bundle.patchIds) {
            patches.delete(patchId);
          }
          bundles.delete(bundleId);
          return {
            bundleId,
            status: "rejected",
            changedFilesCount: previews.filter((preview) => preview.status !== "no-op").length,
            summary: bundle.summary,
            files: previews.map((preview) => ({
              ...preview,
              status: "rejected" as const,
            })),
          };
        }

        const applied = await commitBundle(bundle);
        return {
          bundleId: applied.bundleId,
          status: applied.status,
          changedFilesCount: previews.filter((preview) => preview.status !== "no-op").length,
          summary: bundle.summary,
          files: applied.files,
        };
      }

      return {
        bundleId,
        status: "prepared",
        changedFilesCount: previews.filter((preview) => preview.status !== "no-op").length,
        summary: bundles.get(bundleId)?.summary ?? "prepared",
        files: previews,
      };
    },
  });

  const preparePatch = tool({
    description:
      "Prepare a patch for a file change, returning a unified diff preview before anything is written.",
    inputSchema: z.object({
      filePath: z.string().min(1),
      content: z.string(),
    }),
    execute: async (input) => {
      return prepareSinglePatch(input.filePath, input.content);
    },
  });

  const createDirectory = tool({
    description:
      "Create a directory on the local filesystem. Creates parent directories by default.",
    inputSchema: z.object({
      dirPath: z.string().min(1),
      recursive: z.boolean().optional().default(true),
    }),
    execute: async (input) => {
      const resolvedPath = fs.resolvePath(input.dirPath);
      await fs.mkdir(input.dirPath, { recursive: input.recursive });
      return {
        dirPath: resolvedPath,
        created: true,
        recursive: input.recursive,
      };
    },
  });

  return {
    createDirectory,
    preparePatchBundle,
    preparePatch,
  };
}
