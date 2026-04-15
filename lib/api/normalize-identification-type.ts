// Maps the verbose legacy values sent by rentacar-main ("Cedula Ciudadania",
// "Pasaporte", "Cedula Extranjeria") to the DB check constraint codes
// ('CC', 'CE', 'NIT', 'PP', 'TI'). Already-normalized codes and unknown
// values pass through unchanged so the DB layer stays the source of truth.

const VERBOSE_TO_CODE: Record<string, string> = {
  "cedula ciudadania": "CC",
  "cedula extranjeria": "CE",
  "pasaporte": "PP",
  "tarjeta identidad": "TI",
  "nit": "NIT",
};

export function normalizeIdentificationType(raw: string): string {
  const mapped = VERBOSE_TO_CODE[raw.trim().toLowerCase()];
  return mapped ?? raw;
}
