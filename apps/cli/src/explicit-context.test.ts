import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildExplicitFileContext, prependExplicitFileContext } from "./explicit-context.js";

const tempRoots: string[] = [];

async function createRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "archer-explicit-context-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

describe("buildExplicitFileContext", () => {
  it("builds a prompt prefix from mentioned files", async () => {
    const repoRoot = await createRepo();
    await mkdir(join(repoRoot, "src"), { recursive: true });
    await writeFile(
      join(repoRoot, "src/example.ts"),
      "export const value = 1;\nexport const next = 2;\n",
    );

    const context = await buildExplicitFileContext(
      {
        text: "check @src/example.ts",
        textElements: [],
        mentions: [
          {
            id: "m1",
            label: "@src/example.ts",
            start: 6,
            end: 21,
            target: { type: "file", path: "src/example.ts" },
          },
        ],
        attachments: [],
      },
      repoRoot,
    );

    expect(context.hasFileMentions).toBe(true);
    expect(context.referencedPaths).toEqual(["src/example.ts"]);
    expect(context.promptPrefix).toContain("Explicit user-mentioned files:");
    expect(context.promptPrefix).toContain("File: src/example.ts");
    expect(context.promptPrefix).toContain("export const value = 1;");
  });

  it("respects line-range mentions", async () => {
    const repoRoot = await createRepo();
    await mkdir(join(repoRoot, "src"), { recursive: true });
    await writeFile(join(repoRoot, "src/example.ts"), "one\ntwo\nthree\nfour\n");

    const context = await buildExplicitFileContext(
      {
        text: "check @src/example.ts",
        textElements: [],
        mentions: [
          {
            id: "m1",
            label: "@src/example.ts",
            start: 6,
            end: 21,
            target: { type: "file", path: "src/example.ts", lineStart: 2, lineEnd: 3 },
          },
        ],
        attachments: [],
      },
      repoRoot,
    );

    expect(context.promptPrefix).toContain("File: src/example.ts#L2-3");
    expect(context.promptPrefix).toContain("two\nthree");
    expect(context.promptPrefix).not.toContain("Content:\none\n");
  });

  it("skips files outside the repository root", async () => {
    const repoRoot = await createRepo();

    const context = await buildExplicitFileContext(
      {
        text: "check @../secret.txt",
        textElements: [],
        mentions: [
          {
            id: "m1",
            label: "@../secret.txt",
            start: 6,
            end: 19,
            target: { type: "file", path: "../secret.txt" },
          },
        ],
        attachments: [],
      },
      repoRoot,
    );

    expect(context.promptPrefix).toContain(
      "skipped because it resolves outside the repository root",
    );
  });

  it("falls back to parsing visible @path text when hidden mention bindings are absent", async () => {
    const repoRoot = await createRepo();
    await mkdir(join(repoRoot, "src"), { recursive: true });
    await writeFile(join(repoRoot, "src/example.ts"), "alpha\nbeta\ngamma\n");

    const context = await buildExplicitFileContext(
      {
        text: "check @src/example.ts#L2-3 please",
        textElements: [],
        mentions: [],
        attachments: [],
      },
      repoRoot,
    );

    expect(context.hasFileMentions).toBe(true);
    expect(context.referencedPaths).toEqual(["src/example.ts"]);
    expect(context.promptPrefix).toContain("File: src/example.ts#L2-3");
    expect(context.promptPrefix).toContain("beta\ngamma");
  });

  it("deduplicates parsed @path text when a structured file mention already exists", async () => {
    const repoRoot = await createRepo();
    await mkdir(join(repoRoot, "src"), { recursive: true });
    await writeFile(join(repoRoot, "src/example.ts"), "alpha\n");

    const context = await buildExplicitFileContext(
      {
        text: "check @src/example.ts",
        textElements: [],
        mentions: [
          {
            id: "m1",
            label: "@src/example.ts",
            start: 6,
            end: 21,
            target: { type: "file", path: "src/example.ts" },
          },
        ],
        attachments: [],
      },
      repoRoot,
    );

    expect(context.referencedPaths).toEqual(["src/example.ts"]);
    expect((context.promptPrefix?.match(/File: src\/example\.ts/g) ?? []).length).toBe(1);
  });
});

describe("prependExplicitFileContext", () => {
  it("prefixes prompts only when context exists", () => {
    expect(
      prependExplicitFileContext("Task:\nhello", {
        hasFileMentions: true,
        referencedPaths: ["src/example.ts"],
        promptPrefix: "Explicit context\n\n",
      }),
    ).toBe("Explicit context\n\nTask:\nhello");

    expect(
      prependExplicitFileContext("Task:\nhello", {
        hasFileMentions: false,
        referencedPaths: [],
        promptPrefix: null,
      }),
    ).toBe("Task:\nhello");
  });
});
