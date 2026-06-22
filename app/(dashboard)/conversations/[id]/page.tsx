import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHAT_STATUS_LABELS } from "@/lib/chat/list-params";
import { getConversation } from "@/lib/queries/chat-conversations";
import { ChatThread } from "../chat-thread";
import { ConversationReviewPanel } from "./conversation-review-panel";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  open: "secondary",
  closed: "outline",
  handoff: "destructive",
};

const createdFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/Bogota",
});

function formatCreated(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : createdFormatter.format(d);
}

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let result;
  try {
    result = await getConversation(id);
  } catch {
    notFound();
  }
  const { conversation, messages } = result;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/conversations" aria-label="Volver">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Conversación</h1>
        <Badge variant={STATUS_VARIANT[conversation.status] ?? "secondary"}>
          {CHAT_STATUS_LABELS[conversation.status] ?? conversation.status}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          Marca: <span className="text-foreground">{conversation.brand}</span>
        </span>
        <span>
          Ciudad:{" "}
          <span className="text-foreground">
            {conversation.city_detected ?? "—"}
          </span>
        </span>
        <span>
          Creada:{" "}
          <span className="text-foreground">
            {formatCreated(conversation.created_at)}
          </span>
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hilo</CardTitle>
          </CardHeader>
          <CardContent>
            <ChatThread messages={messages} />
          </CardContent>
        </Card>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle className="text-base">Revisión</CardTitle>
          </CardHeader>
          <CardContent>
            <ConversationReviewPanel
              conversationId={conversation.id}
              initialLabel={
                conversation.review_label === "good" ||
                conversation.review_label === "bad"
                  ? conversation.review_label
                  : null
              }
              initialNote={conversation.review_note}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
