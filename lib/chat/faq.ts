import { RENTAL_REQUIREMENTS } from "@/lib/api/rental-requirements";

/**
 * Knowledge section injected into the chatbot system prompt. REUSES
 * `RENTAL_REQUIREMENTS` (the business-authored source of truth, kept in sync with
 * the post-reservation email) instead of duplicating policy text — so the bot
 * never invents requirements. RAG over real WhatsApp conversations is a future
 * phase; V1 answers FAQs from this curated, authoritative content.
 */
export function buildKnowledgeSection(): string {
  const r = RENTAL_REQUIREMENTS;

  const docs = r.documentosRequeridos
    .map((d) => `- ${d.titulo}: ${d.detalle}`)
    .join("\n");

  const politicas = r.politicasDeUso.map((p) => `- ${p}`).join("\n");

  return [
    "CONOCIMIENTO (requisitos de alquiler — responde dudas con esto, no inventes):",
    "",
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
