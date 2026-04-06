import type { ReservationStatus } from "@/lib/schemas/reservation";

export interface GhlConfig {
  api_key: string;
  location_id: string;
  pipeline_id: string;
  stages: {
    pendiente: string;
    reservado: string;
    pendiente_modificar: string;
    utilizado: string;
    sin_disponibilidad: string;
    mensualidad: string;
  };
}

const FRANCHISE_ENV_PREFIX: Record<string, string> = {
  alquilatucarro: "ALQUILATUCARRO",
  alquilame: "ALQUILAME",
  alquicarros: "ALQUICARROS",
};

export function getGhlConfig(franchiseCode: string): GhlConfig | null {
  const prefix = FRANCHISE_ENV_PREFIX[franchiseCode];
  if (!prefix) return null;

  const apiKey = process.env[`${prefix}_GHL_API_KEY`];
  if (!apiKey) return null;

  const locationId = process.env[`${prefix}_GHL_LOCATION_ID`] ?? "";
  const pipelineId = process.env[`${prefix}_GHL_PIPELINE_ID`] ?? "";

  return {
    api_key: apiKey,
    location_id: locationId,
    pipeline_id: pipelineId,
    stages: {
      pendiente: process.env[`${prefix}_GHL_STAGE_PENDIENTE`] ?? "",
      reservado: process.env[`${prefix}_GHL_STAGE_RESERVADO`] ?? "",
      pendiente_modificar:
        process.env[`${prefix}_GHL_STAGE_PENDIENTE_MODIFICAR`] ?? "",
      utilizado: process.env[`${prefix}_GHL_STAGE_UTILIZADO`] ?? "",
      sin_disponibilidad:
        process.env[`${prefix}_GHL_STAGE_SIN_DISPONIBILIDAD`] ?? "",
      mensualidad: process.env[`${prefix}_GHL_STAGE_MENSUALIDAD`] ?? "",
    },
  };
}

const STAGE_MAP: Record<string, keyof GhlConfig["stages"]> = {
  pendiente: "pendiente",
  reservado: "reservado",
  pendiente_modificar: "pendiente_modificar",
  utilizado: "utilizado",
  sin_disponibilidad: "sin_disponibilidad",
  mensualidad: "mensualidad",
};

export function getStageId(
  config: GhlConfig,
  status: ReservationStatus
): string | null {
  const stageKey = STAGE_MAP[status];
  if (!stageKey) return null;
  return config.stages[stageKey] || null;
}

const LOST_STATUSES: ReservationStatus[] = [
  "no_contactado",
  "no_recogido",
  "baneado",
  "cancelado",
];

export function getOpportunityStatus(
  status: ReservationStatus
): "open" | "lost" {
  return LOST_STATUSES.includes(status) ? "lost" : "open";
}
