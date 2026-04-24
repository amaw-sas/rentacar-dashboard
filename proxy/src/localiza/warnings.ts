// Maps Localiza SOAP warning ShortText codes to the structured error payload
// that the Nuxt client (useMessages.createErrorMessage) already knows how to
// render as a toast. Ports the behavior of the legacy Laravel admin's
// App\Rentcar\Localiza\ProcessWarning + resources/lang/es/localiza.php.

export interface LocalizaWarningPayload {
  code: string;
  message: string;
  httpStatus: number;
}

interface WarningEntry {
  code: string;
  message: string;
  httpStatus?: number;
}

const DEFAULT_HTTP_STATUS = 500;

export const LOCALIZA_WARNING_MAP: Record<string, WarningEntry> = {
  LLNRRE002: {
    code: "inferior_pickup_date",
    message:
      "Selecciona la fecha de recogida igual o posterior a la fecha actual",
  },
  LLNRAG009: {
    code: "no_available_categories_error",
    message:
      "Lo sentimos, No se encontraron vehículos disponibles, inténta cambiando el día o la sede de recogida",
  },
  LLNRRE010: {
    code: "same_hour_error",
    message: "El día y hora de recogida son iguales a los de devolución",
  },
  LLNRAG011: {
    code: "out_of_schedule_pickup_hour_error",
    message:
      "La hora de recogida está por fuera del horario de atención de la sede seleccionada",
  },
  LLNRAG012: {
    code: "holiday_pickup_date_error",
    message:
      "El lugar de recogida no funciona en esa fecha por ser día festivo",
  },
  LLNRAG013: {
    code: "out_of_schedule_pickup_date_error",
    message:
      "El día de recogida está por fuera del horario de atención de la sede seleccionada",
  },
  LLNRAG014: {
    code: "holiday_out_of_schedule_return_date_error",
    message:
      "El lugar de devolución está por fuera del horario de atención de la sede seleccionada por ser día festivo",
  },
  LLNRAG015: {
    code: "out_of_schedule_return_hour_error",
    message:
      "La hora de devolución está por fuera del horario de atención de la sede seleccionada",
  },
  LLNRAG016: {
    code: "holiday_return_date_error",
    message:
      "El lugar de devolución no funciona en esa fecha por ser día festivo",
  },
  LLNRAG017: {
    code: "out_of_schedule_return_date_error",
    message:
      "El día de devolución está por fuera del horario de atención de la sede seleccionada",
  },
  LLNRRE045: {
    code: "reservation_cancelled_error",
    message: "La reserva fue cancelada",
  },
};

const UNKNOWN_WARNING: LocalizaWarningPayload = {
  code: "unknown_error",
  message:
    "Ha ocurrido un error inesperado, por favor contacte a nuestros asesores",
  httpStatus: DEFAULT_HTTP_STATUS,
};

export class LocalizaWarningError extends Error {
  readonly code: string;
  readonly shortText: string | null;
  readonly httpStatus: number;

  constructor(payload: LocalizaWarningPayload, shortText: string | null) {
    super(payload.message);
    this.name = "LocalizaWarningError";
    this.code = payload.code;
    this.shortText = shortText;
    this.httpStatus = payload.httpStatus;
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      shortText: this.shortText,
    };
  }
}

export function extractWarningShortText(warnings: unknown): string | null {
  if (!warnings || typeof warnings !== "object") return null;
  const warningNode = (warnings as Record<string, unknown>)["Warning"];
  if (!warningNode) return null;
  const first = Array.isArray(warningNode) ? warningNode[0] : warningNode;
  if (!first || typeof first !== "object") return null;
  const attrs = (first as Record<string, unknown>)["$"];
  if (!attrs || typeof attrs !== "object") return null;
  const shortText = (attrs as Record<string, unknown>)["ShortText"];
  return typeof shortText === "string" && shortText.length > 0
    ? shortText
    : null;
}

export function extractErrorMessage(errors: unknown): string | null {
  if (!errors || typeof errors !== "object") return null;
  const errorNode = (errors as Record<string, unknown>)["Error"];
  if (!errorNode) return null;
  const first = Array.isArray(errorNode) ? errorNode[0] : errorNode;
  if (!first || typeof first !== "object") return null;
  const text = (first as Record<string, unknown>)["_"];
  if (typeof text === "string" && text.length > 0) return text;
  const attrs = (first as Record<string, unknown>)["$"];
  if (attrs && typeof attrs === "object") {
    const short = (attrs as Record<string, unknown>)["ShortText"];
    if (typeof short === "string" && short.length > 0) return short;
  }
  return null;
}

export function buildLocalizaWarning(
  shortText: string | null,
): LocalizaWarningError {
  const entry = shortText ? LOCALIZA_WARNING_MAP[shortText] : undefined;

  if (!entry) {
    console.warn(
      JSON.stringify({
        level: "WARN",
        event: "localiza_warning_unmapped",
        shortText: shortText ?? null,
        timestamp: new Date().toISOString(),
      }),
    );
    return new LocalizaWarningError(UNKNOWN_WARNING, shortText);
  }

  return new LocalizaWarningError(
    {
      code: entry.code,
      message: entry.message,
      httpStatus: entry.httpStatus ?? DEFAULT_HTTP_STATUS,
    },
    shortText,
  );
}
