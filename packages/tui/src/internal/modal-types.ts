import type { BoxRenderable, SelectRenderable, TextRenderable } from "@opentui/core";

export type PendingModal =
  | {
      type: "approval";
      resolve: (value: string) => void;
      select: SelectRenderable;
      box: BoxRenderable;
    }
  | {
      type: "review";
      resolve: (value: string) => void;
      fileSelect: SelectRenderable;
      actionSelect: SelectRenderable;
      preview: TextRenderable;
      box: BoxRenderable;
      focused: "files" | "actions";
    };
