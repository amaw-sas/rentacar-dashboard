import { RENTAL_REQUIREMENTS } from "@/lib/api/rental-requirements";
import { getChatKnowledgeContent } from "@/lib/chat/knowledge-store";

/**
 * Knowledge section injected into the chatbot system prompt as FALLBACK content,
 * secondary to the structured tools (cotizar, info_sedes, tarifa_mensual,
 * info_gamas). Primary source is the editable knowledge base (chat_knowledge,
 * scope 'shared'), edited from the dashboard. If that table is empty or
 * unreachable, falls back to the curated RENTAL_REQUIREMENTS (kept in sync with
 * the post-reservation email) so the bot never loses its baseline policy facts.
 */
export async function buildKnowledgeSection(): Promise<string> {
  const stored = await getChatKnowledgeContent();
  const body = stored ?? buildRequirementsFallback();
  return [
    "CONOCIMIENTO (respaldo — úsalo para políticas, requisitos, objeciones y tono; secundario a las herramientas):",
    "",
    body,
  ].join("\n");
}

/** Baseline policy text derived from the authoritative requirements constant. */
function buildRequirementsFallback(): string {
  const r = RENTAL_REQUIREMENTS;

  const docs = r.documentosRequeridos
    .map((d) => `- ${d.titulo}: ${d.detalle}`)
    .join("\n");

  const politicas = r.politicasDeUso.map((p) => `- ${p}`).join("\n");

  return [
    "Documentos requeridos:",
    docs,
    "",
    `Licencia de conducción: ${r.reglaLicenciaConduccion}`,
    "",
    `Forma de pago: ${r.formaDePago}`,
    "No se exige pago anticipado para reservar: el pago se hace al recoger el vehículo.",
    "",
    `Conductor adicional: ${r.conductorAdicional}`,
    "",
    "Políticas de uso:",
    politicas,
    "",
    `Recogida: ${r.recogida}`,
    "",
    "Para reservar se piden datos mínimos: nombre completo, tipo y número de documento, correo y teléfono.",
    `Nota: ${r.fuente}`,
  ].join("\n");
}
