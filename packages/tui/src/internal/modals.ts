import { BoxRenderable, SelectRenderable, SelectRenderableEvents, TextRenderable, type CliRenderer } from "@opentui/core";
import { approvalTitle, compactDiff, defaultApprovalChoices, normalizeText } from "./ui-helpers.js";
import { col } from "./theme.js";
import type { PendingModal } from "./modal-types.js";

type ApprovalDialogChoice = { value: string; label: string; description?: string };
type PatchReviewState = { summary: string; changedFilesCount: number; files: Array<{ filePath: string; diff: string; status?: string }> };
type ApprovalPromptState = { message: string; options?: string[]; choices?: ApprovalDialogChoice[]; selectedIndex?: number; details?: string; review?: PatchReviewState };

export function createApprovalBox(renderer: CliRenderer, id: string, innerRows: number, title: string): BoxRenderable {
  return new BoxRenderable(renderer, {
    id,
    width: "100%",
    maxWidth: "100%",
    height: innerRows + 2,
    flexShrink: 0,
    flexDirection: "column",
    alignItems: "stretch",
    border: ["left"],
    borderColor: col.accent,
    backgroundColor: "#0b1016",
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    title: ` ${title} `,
  });
}

export function mountApprovalModal(args: {
  renderer: CliRenderer;
  footerRoot: BoxRenderable;
  prompt: ApprovalPromptState;
  resolve: (value: string) => void;
  closePendingModal: () => void;
  onResolved: (value: string) => void;
  focusInput: () => void;
  requestRender: () => void;
  setApprovalRows: (rows: number) => void;
  syncFooterHeight: () => void;
}): PendingModal | null {
  const choices = args.prompt.choices ?? defaultApprovalChoices();
  const selectedIndex = Math.max(0, Math.min(choices.length - 1, args.prompt.selectedIndex ?? 1));
  const visibleChoices = Math.min(choices.length, 12);
  const hasDetails = Boolean(args.prompt.details?.trim());
  const showPreview = choices.some((choice) => choice.description?.trim());
  const innerRows = 1 + (hasDetails ? 1 : 0) + visibleChoices + (showPreview ? 1 : 0) + 1;
  const box = createApprovalBox(args.renderer, "approval-modal", innerRows, approvalTitle(args.prompt));

  box.add(new TextRenderable(args.renderer, { id: "approval-msg", content: normalizeText(args.prompt.message), width: "100%", height: 1, fg: col.muted }));
  if (hasDetails) {
    box.add(new TextRenderable(args.renderer, { id: "approval-details", content: normalizeText(args.prompt.details ?? ""), width: "100%", height: 1, fg: col.step }));
  }
  const selectOptions = choices.map((ch, index) => ({ name: index === selectedIndex ? `${ch.label}  (current)` : ch.label, description: ch.description ?? "", value: ch.value }));
  const select = new SelectRenderable(args.renderer, {
    id: "approval-select", options: selectOptions, selectedIndex, width: "100%", height: visibleChoices, backgroundColor: col.userBg, focusedBackgroundColor: col.userBg,
    showScrollIndicator: choices.length > visibleChoices, showDescription: false, selectedBackgroundColor: col.border, selectedTextColor: col.text, textColor: col.text, descriptionColor: col.muted, selectedDescriptionColor: col.muted,
  });
  box.add(select);
  const preview = showPreview ? new TextRenderable(args.renderer, { id: "approval-preview", content: selectOptions[selectedIndex]?.description || "", width: "100%", height: 1, truncate: true, fg: col.step }) : null;
  if (preview) box.add(preview);
  box.add(new TextRenderable(args.renderer, { id: "approval-help", content: "↑↓ move   enter select   esc reject", width: "100%", height: 1, fg: col.muted }));

  args.footerRoot.add(box);
  args.setApprovalRows(innerRows + 2);
  args.syncFooterHeight();

  if (preview) {
    select.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
      preview.content = selectOptions[index]?.description || "";
      args.requestRender();
    });
  }
  let armed = false;
  queueMicrotask(() => {
    armed = true;
    select.focus();
    args.syncFooterHeight();
  });
  select.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, item: { value: string }) => {
    if (!armed) return;
    args.closePendingModal();
    args.onResolved(item.value);
    args.focusInput();
    args.requestRender();
  });
  return { type: "approval", resolve: args.resolve, select, box };
}

export function mountReviewModal(args: {
  renderer: CliRenderer;
  footerRoot: BoxRenderable;
  prompt: ApprovalPromptState;
  resolve: (value: string) => void;
  closePendingModal: () => void;
  onResolved: (value: string) => void;
  focusInput: () => void;
  requestRender: () => void;
  setApprovalRows: (rows: number) => void;
  syncFooterHeight: () => void;
  registerInputHandler: (handler: (seq: string) => boolean) => void;
}): PendingModal | null {
  if (!args.prompt.review) return null;
  const box = createApprovalBox(args.renderer, "review-modal", 17, "review changes");
  box.add(new TextRenderable(args.renderer, { id: "review-header", content: normalizeText(args.prompt.message), width: "100%", height: 1, fg: col.text }));
  box.add(new TextRenderable(args.renderer, { id: "review-subtitle", content: normalizeText(args.prompt.details ?? args.prompt.review.summary), width: "100%", height: 1, fg: col.muted }));
  box.add(new TextRenderable(args.renderer, { id: "review-files-label", content: "Files", width: "100%", height: 1, fg: col.accent }));

  const fileSelect = new SelectRenderable(args.renderer, {
    id: "review-files",
    options: args.prompt.review.files.map((f) => ({ name: f.filePath, description: f.status ?? "modified", value: f.filePath })),
    selectedIndex: 0,
    width: "100%",
    height: 4,
    showDescription: true,
  });
  box.add(fileSelect);
  box.add(new TextRenderable(args.renderer, { id: "review-diff-label", content: "Diff", width: "100%", height: 1, fg: col.accent }));
  const preview = new TextRenderable(args.renderer, {
    id: "review-preview",
    content: compactDiff(args.prompt.review.files[0]?.diff ?? "", 10),
    width: "100%",
    height: 5,
    wrapMode: "word",
    fg: col.muted,
  });
  const actionSelect = new SelectRenderable(args.renderer, {
    id: "review-actions",
    options: (args.prompt.choices ?? defaultApprovalChoices()).map((ch) => ({ name: ch.label, description: ch.description ?? "", value: ch.value })),
    selectedIndex: 1,
    width: "100%",
    height: 4,
    showDescription: true,
  });
  box.add(preview);
  box.add(actionSelect);
  box.add(new TextRenderable(args.renderer, { id: "review-help", content: "tab switch focus   enter choose   esc reject", width: "100%", height: 1, fg: col.muted }));

  args.footerRoot.add(box);
  args.setApprovalRows(19);
  args.syncFooterHeight();

  const modal: PendingModal = { type: "review", resolve: args.resolve, fileSelect, actionSelect, preview, box, focused: "actions" };

  let armed = false;
  queueMicrotask(() => {
    armed = true;
    actionSelect.focus();
    args.syncFooterHeight();
  });

  fileSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
    const sel = fileSelect.getSelectedOption();
    const file = args.prompt.review?.files.find((f) => f.filePath === sel?.value);
    preview.content = file ? compactDiff(file.diff, 10) : "(no file selected)";
    args.requestRender();
  });
  fileSelect.on(SelectRenderableEvents.ITEM_SELECTED, () => {
    modal.focused = "actions";
    modal.actionSelect.focus();
    args.requestRender();
  });
  actionSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, item: { value: string }) => {
    if (!armed) return;
    args.closePendingModal();
    args.onResolved(item.value);
    args.focusInput();
    args.requestRender();
  });
  args.registerInputHandler((seq) => {
    if (seq !== "\t") return false;
    if (modal.focused === "files") {
      modal.focused = "actions";
      modal.actionSelect.focus();
    } else {
      modal.focused = "files";
      modal.fileSelect.focus();
    }
    args.requestRender();
    return true;
  });

  fileSelect.focus();
  return modal;
}
