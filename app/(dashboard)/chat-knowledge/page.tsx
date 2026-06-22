import { getChatKnowledge } from "@/lib/queries/chat-knowledge";
import { ChatKnowledgeEditor } from "./chat-knowledge-editor";

export default async function ChatKnowledgePage() {
  const knowledge = await getChatKnowledge("shared");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Base de conocimiento del chat</h1>
        <p className="text-sm text-muted-foreground">
          Respaldo del bot para políticas, requisitos, objeciones y tono. Es
          secundaria a las herramientas (precios, sedes, gamas, tarifa mensual):
          si una herramienta tiene el dato, ese gana. Lo que edites aquí aplica
          en la siguiente respuesta del bot.
        </p>
      </div>

      <ChatKnowledgeEditor
        initialContent={knowledge.content as string}
        updatedAt={knowledge.updated_at as string}
      />
    </div>
  );
}
