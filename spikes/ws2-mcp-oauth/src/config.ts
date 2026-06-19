// Single source of truth for the spike's URLs.
// Confusing RESOURCE (origin + /mcp path) with the bare origin is the classic
// RFC 9728 / RFC 8707 exact-match bug — keep the /mcp path.

const DEFAULT_BASE = "http://localhost:8787";

export const BASE = (process.env.SPIKE_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");

// RFC 9728 resource = the MCP endpoint WITH the /mcp path.
export const RESOURCE = `${BASE}/mcp`;

// RFC 8414 issuer = the bare origin (this mock AS is co-hosted with the RS).
export const ISSUER = BASE;

// The scope that gates crear_reserva.
export const REQUIRED_SCOPE = "reservation:create";

// Port: prefer explicit env, else derive from BASE, else 8787.
function derivePort(): number {
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    const u = new URL(BASE);
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return 8787;
  }
}

export const PORT = derivePort();
