// In-memory ordered request log — the heart of the spike.
// Each /mcp entry carries the tool name so the two POST /mcp calls of the
// flow (step 1 = 401, step 7 = 200) are machine-distinguishable for SCEN-A3.

export type AuthKind = "none" | "Bearer";

export interface LogEntry {
  ts: string;
  method: string;
  path: string;
  auth: AuthKind;
  tool: string | null;
  status: number;
}

const entries: LogEntry[] = [];

export function record(e: Omit<LogEntry, "ts">): void {
  const ts = new Date().toISOString();
  const full: LogEntry = { ts, ...e };
  entries.push(full);
  // Stream to terminal so the live flow is visible during Phase B too.
  console.error(
    `[${ts}] ${e.method} ${e.path} auth=${e.auth} tool=${e.tool ?? "-"} -> ${e.status}`,
  );
}

export function getLog(): LogEntry[] {
  return entries;
}

export function clearLog(): void {
  entries.length = 0;
}
