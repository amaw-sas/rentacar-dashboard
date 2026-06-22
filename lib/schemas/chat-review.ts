import { z } from "zod";

// Input contract for the conversation-review server action. The label is
// nullable so a reviewer can clear a previous verdict; the note is capped to keep
// the free text bounded.
export const REVIEW_NOTE_MAX = 2000;

export const conversationReviewSchema = z.object({
  conversationId: z.string().uuid(),
  label: z.enum(["good", "bad"]).nullable(),
  note: z.string().max(REVIEW_NOTE_MAX).nullable().optional(),
});

export type ConversationReviewInput = z.infer<typeof conversationReviewSchema>;
