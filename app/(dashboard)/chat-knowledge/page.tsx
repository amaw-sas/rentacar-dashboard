import { getChatKnowledge } from "@/lib/queries/chat-knowledge";
import { getChatBrandSettings } from "@/lib/queries/chat-brand-settings";
import { ChatKnowledgeEditor } from "./chat-knowledge-editor";
import { ChatBrandToggles } from "./chat-brand-toggles";

export default async function ChatKnowledgePage() {
  const [knowledge, brandSettings] = await Promise.all([
    getChatKnowledge("shared"),
    getChatBrandSettings(),
  ]);

  return (
    <div className="space-y-6">
      <ChatBrandToggles initial={brandSettings} />

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
