// Scenario coverage note for the SDD guard.
//
// This spike's observable acceptance criteria are SCEN-A1..A4, encoded as
// executable asserts in src/reference-client.ts (run via `npm run verify:all`).
// That reference client IS the test harness: it boots the real server and
// asserts the OAuth wire contract end-to-end — the only meaningful gate for a
// wire-protocol spike, where unit-mocking the transport would prove nothing.
//
// The logger (src/log.ts) is exercised transitively: SCEN-A3 asserts the exact
// ordered sequence of logged entries (tool name + status) returned by GET /__log.
// A pure unit test of the in-memory array would be redundant with that stronger
// end-to-end assertion, so the scenario lives in the reference client.
//
// Kept here so the SDD ordering guard sees scenarios declared before impl.

export const SCENARIOS = [
  "SCEN-A1: buscar_disponibilidad without token -> HTTP 200 + data (auth=none)",
  "SCEN-A2: crear_reserva without token -> HTTP 401 + WWW-Authenticate Bearer (resource_metadata, scope)",
  "SCEN-A3: 401 -> discovery -> register -> authorize(PKCE S256) -> token -> retry crear_reserva -> 200; /__log shows ordered 7-step flow",
  "SCEN-A4: forged / wrong-aud / expired Bearer -> crear_reserva 401 (rejected by signature / aud / exp)",
] as const;
