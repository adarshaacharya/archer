import { z } from "zod";

export const ComposerTextElementSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  kind: z.enum(["mention", "image-placeholder", "attachment-placeholder"]),
  display: z.string().min(1).optional(),
  bindingId: z.string().min(1).optional(),
});
export type ComposerTextElement = z.infer<typeof ComposerTextElementSchema>;

export const ComposerMentionTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file"),
    path: z.string().min(1),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("skill"),
    path: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal("resource"),
    uri: z.string().min(1),
    name: z.string().min(1),
  }),
]);
export type ComposerMentionTarget = z.infer<typeof ComposerMentionTargetSchema>;

export const ComposerMentionBindingSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  target: ComposerMentionTargetSchema,
});
export type ComposerMentionBinding = z.infer<typeof ComposerMentionBindingSchema>;

export const ComposerAttachmentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("local-image"),
    path: z.string().min(1),
  }),
]);
export type ComposerAttachment = z.infer<typeof ComposerAttachmentSchema>;

export const ComposerSubmissionSchema = z.object({
  text: z.string(),
  textElements: z.array(ComposerTextElementSchema).default([]),
  mentions: z.array(ComposerMentionBindingSchema).default([]),
  attachments: z.array(ComposerAttachmentSchema).default([]),
});
export type ComposerSubmission = z.infer<typeof ComposerSubmissionSchema>;

export function createPlainComposerSubmission(text: string): ComposerSubmission {
  return {
    text,
    textElements: [],
    mentions: [],
    attachments: [],
  };
}
