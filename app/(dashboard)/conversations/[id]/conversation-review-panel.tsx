"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { REVIEW_NOTE_MAX } from "@/lib/schemas/chat-review";
import { setConversationReview } from "@/lib/actions/chat-reviews";

type Label = "good" | "bad" | null;

interface ConversationReviewPanelProps {
  conversationId: string;
  initialLabel: Label;
  initialNote: string | null;
}

// Lets a reviewer grade a conversation good/bad with a note. One review per
// conversation (latest wins) — submitting overwrites the previous verdict via the
// server action. The good/bad toggle is two buttons (no radio-group component in
// the kit); clicking the active label again clears it.
export function ConversationReviewPanel({
  conversationId,
  initialLabel,
  initialNote,
}: ConversationReviewPanelProps) {
  const [label, setLabel] = useState<Label>(initialLabel);
  const [note, setNote] = useState(initialNote ?? "");
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await setConversationReview({
        conversationId,
        label,
        note: note.trim() ? note.trim() : null,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Revisión guardada");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={label === "good" ? "default" : "outline"}
          size="sm"
          className={cn(
            "flex-1",
            label === "good" && "bg-emerald-600 hover:bg-emerald-600/90",
          )}
          onClick={() => setLabel(label === "good" ? null : "good")}
        >
          <ThumbsUpIcon className="mr-1" />
          Buena
        </Button>
        <Button
          type="button"
          variant={label === "bad" ? "destructive" : "outline"}
          size="sm"
          className="flex-1"
          onClick={() => setLabel(label === "bad" ? null : "bad")}
        >
          <ThumbsDownIcon className="mr-1" />
          Mala
        </Button>
      </div>

      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, REVIEW_NOTE_MAX))}
        placeholder="Nota: qué salió bien o mal, qué mejorar…"
        rows={4}
      />

      <Button
        type="button"
        className="w-full"
        onClick={submit}
        disabled={isPending}
      >
        {isPending ? "Guardando…" : "Guardar revisión"}
      </Button>
    </div>
  );
}
