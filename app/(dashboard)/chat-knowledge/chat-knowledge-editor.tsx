"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { KNOWLEDGE_MAX } from "@/lib/schemas/chat-knowledge";
import { updateChatKnowledge } from "@/lib/actions/chat-knowledge";

interface ChatKnowledgeEditorProps {
  initialContent: string;
  updatedAt: string;
}

// Edits the bot's fallback knowledge base (markdown, raw). One big textarea —
// no markdown editor lib in the kit. Mirrors the conversation-review panel
// (useTransition + toast). Saving feeds the bot at the next request.
export function ChatKnowledgeEditor({
  initialContent,
  updatedAt,
}: ChatKnowledgeEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [isPending, startTransition] = useTransition();

  const dirty = content !== initialContent;
  const tooLong = content.length > KNOWLEDGE_MAX;

  function save() {
    startTransition(async () => {
      const res = await updateChatKnowledge(content);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Base de conocimiento guardada");
    });
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        className="min-h-[60vh] font-mono text-xs leading-relaxed"
        placeholder="Markdown de la base de conocimiento…"
      />
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          <span className={tooLong ? "text-destructive" : undefined}>
            {content.length.toLocaleString("es-CO")} / {KNOWLEDGE_MAX.toLocaleString("es-CO")}
          </span>{" "}
          · última edición {new Date(updatedAt).toLocaleString("es-CO", { timeZone: "America/Bogota" })}
        </p>
        <Button onClick={save} disabled={isPending || !dirty || tooLong}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
