/**
 * Rental requirements exposed to AI agents / clients via GET /api/requirements,
 * so a model can answer "qué requisitos aplican", and specifically "qué necesita
 * un turista extranjero" (see `reglaLicenciaConduccion`).
 *
 * SOURCE OF TRUTH: this content is authored by the business and currently also
 * lives, verbatim in prose, in the post-reservation email
 * (`lib/email/templates/reserved-confirmation.tsx`, "Antes de recoger el
 * vehículo" / "Durante el periodo de renta"). The two MUST be kept in sync until
 * a future change consolidates the email to consume this constant. Do NOT invent
 * new rules here — only mirror what the business has already published.
 *
 * Static, COP-/price-free (prices are dynamic and belong to the quote), and
 * Localiza-generic.
 */
export interface RequiredDocument {
  titulo: string;
  detalle: string;
}

export interface RentalRequirements {
  documentosRequeridos: RequiredDocument[];
  reglaLicenciaConduccion: string;
  formaDePago: string;
  conductorAdicional: string;
  politicasDeUso: string[];
  recogida: string;
  fuente: string;
}

export const RENTAL_REQUIREMENTS: RentalRequirements = {
  documentosRequeridos: [
    {
      titulo: "Tarjeta de crédito",
      detalle:
        "Solo se reciben pagos con tarjetas de crédito físicas. No se aceptan pagos en efectivo ni otros medios de pago.",
    },
    {
      titulo: "Cédula o pasaporte",
      detalle:
        "Documento de identidad. El documento exacto a presentar depende del tipo de licencia de conducción (ver la regla de licencia).",
    },
    {
      titulo: "Licencia de conducción",
      detalle:
        "Vigente. La licencia determina el documento de identificación a presentar.",
    },
  ],
  reglaLicenciaConduccion:
    "Si tiene una licencia de conducción colombiana debe presentar su cédula colombiana (no se acepta pasaporte). Si tiene una licencia extranjera debe presentar su pasaporte, incluso si es colombiano residente en el exterior.",
  formaDePago:
    "El pago se realiza únicamente con tarjeta de crédito física al momento de la recogida del vehículo.",
  conductorAdicional:
    "Si el vehículo será conducido por personas distintas al titular del contrato, se cobra un cargo adicional diario por su seguro. Los conductores adicionales y el titular de la tarjeta de crédito deben estar presentes para la firma del contrato.",
  politicasDeUso: [
    "El vehículo no puede salir del país.",
    "No puede usarse para aplicaciones de movilidad como Uber, Cabify o similares.",
    "Puede recorrer todo el país; en mensualidades, respete los kilómetros contratados para evitar sobrecostos.",
    "Tenga en cuenta las restricciones de movilidad 'pico y placa' de cada ciudad por donde transite.",
  ],
  recogida:
    "Preséntese en el lugar de recogida 30 minutos antes de la hora programada con los documentos requeridos.",
  fuente:
    "Requisitos generales de alquiler. Las condiciones específicas se confirman en la agencia al momento de la recogida.",
};
