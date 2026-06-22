import { z } from "zod";

// Bound the editable knowledge document. Generous cap (the seed is ~30 KB) but
// not unbounded, since the whole thing is injected into every system prompt.
export const KNOWLEDGE_MAX = 60_000;

export const chatKnowledgeSchema = z.object({
  content: z.string().min(1, "El contenido no puede estar vacío").max(KNOWLEDGE_MAX),
});

export type ChatKnowledgeInput = z.infer<typeof chatKnowledgeSchema>;
