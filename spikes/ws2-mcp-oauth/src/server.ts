// Single-process spike server: MCP resource server + mock OAuth AS + logger,
// all on one origin. node:http, no framework. The tiered 401 for crear_reserva
// is emitted at the TRANSPORT level by peeking the JSON-RPC body before handing
// it to the MCP transport — that real HTTP 401 + WWW-Authenticate header is the
// whole point of the spike.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { URL } from "node:url";
import {
  BASE,
  RESOURCE,
  ISSUER,
  PORT,
  REQUIRED_SCOPE,
} from "./config.js";
import { initKeys, jwks, signAccessToken, verifyAccessToken } from "./keys.js";
import { record, getLog, type AuthKind } from "./log.js";
import { createTransport } from "./mcp.js";

// ---- in-memory authorization-code store ----
interface CodeRecord {
  code_challenge: string;
  scope: string;
  resource: string;
  redirect_uri: string;
  expiresAt: number;
}
const codes = new Map<string, CodeRecord>();

// ---- helpers ----

function json(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authKind(req: IncomingMessage): AuthKind {
  const h = req.headers["authorization"];
  return typeof h === "string" && h.toLowerCase().startsWith("bearer ") ? "Bearer" : "none";
}

function bearerToken(req: IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) {
    return h.slice(7).trim();
  }
  return null;
}

function base64urlSha256(input: string): string {
  return createHash("sha256").update(input, "ascii").digest("base64url");
}

function parseForm(raw: string, contentType: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const ct = contentType ?? "";
  if (ct.includes("application/json")) {
    try {
      const obj = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj)) out[k] = String(v);
    } catch {
      /* ignore */
    }
    return out;
  }
  // default: x-www-form-urlencoded
  const params = new URLSearchParams(raw);
  for (const [k, v] of params) out[k] = v;
  return out;
}

// ---- metadata bodies ----

function protectedResourceMetadata() {
  return {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    bearer_methods_supported: ["header"],
    scopes_supported: [REQUIRED_SCOPE],
  };
}

function asMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${BASE}/authorize`,
    token_endpoint: `${BASE}/token`,
    registration_endpoint: `${BASE}/register`,
    jwks_uri: `${BASE}/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [REQUIRED_SCOPE],
  };
}

// RFC 9728: for a resource at <origin>/mcp, the canonical PRM location is
// <origin>/.well-known/oauth-protected-resource/mcp (path appended). ChatGPT
// probes that first. Point the challenge at the canonical location.
const WWW_AUTH = `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp", scope="${REQUIRED_SCOPE}"`;

// ---- request handler ----

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", BASE);
  const path = url.pathname;
  const auth = authKind(req);

  // GET /.well-known/oauth-protected-resource (root) AND the RFC 9728 canonical
  // path-suffixed variant /.well-known/oauth-protected-resource/mcp.
  if (
    method === "GET" &&
    (path === "/.well-known/oauth-protected-resource" ||
      path === "/.well-known/oauth-protected-resource/mcp")
  ) {
    json(res, 200, protectedResourceMetadata());
    record({ method, path, auth, tool: null, status: 200 });
    return;
  }

  // GET /.well-known/oauth-authorization-server  +  alias openid-configuration
  if (
    method === "GET" &&
    (path === "/.well-known/oauth-authorization-server" ||
      path === "/.well-known/openid-configuration")
  ) {
    json(res, 200, asMetadata());
    record({ method, path, auth, tool: null, status: 200 });
    return;
  }

  // GET /jwks.json
  if (method === "GET" && path === "/jwks.json") {
    json(res, 200, jwks());
    record({ method, path, auth, tool: null, status: 200 });
    return;
  }

  // POST /register (DCR permissive)
  if (method === "POST" && path === "/register") {
    const raw = await readBody(req);
    let redirect_uris: string[] = [];
    try {
      const body = JSON.parse(raw || "{}");
      if (Array.isArray(body.redirect_uris)) redirect_uris = body.redirect_uris;
    } catch {
      /* permissive: accept anything */
    }
    const client_id = `spike-client-${randomUUID()}`;
    json(res, 201, {
      client_id,
      token_endpoint_auth_method: "none",
      redirect_uris,
    });
    record({ method, path, auth, tool: null, status: 201 });
    return;
  }

  // GET /authorize (auto-approve, PKCE S256)
  if (method === "GET" && path === "/authorize") {
    const q = url.searchParams;
    const redirect_uri = q.get("redirect_uri") ?? "";
    const code_challenge = q.get("code_challenge") ?? "";
    const code_challenge_method = q.get("code_challenge_method") ?? "";
    const state = q.get("state") ?? "";
    const scope = q.get("scope") ?? REQUIRED_SCOPE;
    const resource = q.get("resource") ?? RESOURCE;

    if (code_challenge_method !== "S256" || !code_challenge || !redirect_uri) {
      json(res, 400, {
        error: "invalid_request",
        error_description: "S256 code_challenge and redirect_uri required",
      });
      record({ method, path, auth, tool: null, status: 400 });
      return;
    }

    const code = randomUUID();
    codes.set(code, {
      code_challenge,
      scope,
      resource,
      redirect_uri,
      expiresAt: Date.now() + 5 * 60_000,
    });

    const loc = new URL(redirect_uri);
    loc.searchParams.set("code", code);
    if (state) loc.searchParams.set("state", state);

    res.writeHead(302, { location: loc.toString(), "cache-control": "no-store" });
    res.end();
    record({ method, path, auth, tool: null, status: 302 });
    return;
  }

  // POST /token (authorization_code + PKCE S256 verify)
  if (method === "POST" && path === "/token") {
    const raw = await readBody(req);
    const form = parseForm(raw, req.headers["content-type"]);
    const grant_type = form["grant_type"];
    const code = form["code"];
    const code_verifier = form["code_verifier"];

    if (grant_type !== "authorization_code" || !code || !code_verifier) {
      json(res, 400, { error: "invalid_request" });
      record({ method, path, auth, tool: null, status: 400 });
      return;
    }

    const rec = codes.get(code);
    if (!rec || rec.expiresAt < Date.now()) {
      json(res, 400, { error: "invalid_grant", error_description: "unknown or expired code" });
      record({ method, path, auth, tool: null, status: 400 });
      return;
    }
    // Single-use the code regardless of outcome.
    codes.delete(code);

    // RFC 7636 S256: BASE64URL(SHA256(ASCII(verifier))) === stored challenge.
    const computed = base64urlSha256(code_verifier);
    if (computed !== rec.code_challenge) {
      json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
      record({ method, path, auth, tool: null, status: 400 });
      return;
    }

    const expires_in = 600;
    const access_token = await signAccessToken({
      aud: rec.resource, // RFC 8707: audience-bound to the MCP resource.
      scope: rec.scope,
      expSeconds: expires_in,
    });
    json(res, 200, {
      access_token,
      token_type: "Bearer",
      expires_in,
      scope: rec.scope,
    });
    record({ method, path, auth, tool: null, status: 200 });
    return;
  }

  // GET /__log (debug)
  if (method === "GET" && path === "/__log") {
    json(res, 200, getLog());
    // do not log the log read itself
    return;
  }

  // POST / GET /mcp  (MCP Streamable HTTP)
  if (path === "/mcp") {
    await handleMcp(req, res, method, path, auth);
    return;
  }

  json(res, 404, { error: "not_found", path });
  record({ method, path, auth, tool: null, status: 404 });
}

// Peek the JSON-RPC body; gate crear_reserva at the transport boundary.
async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  auth: AuthKind,
): Promise<void> {
  let parsedBody: unknown = undefined;
  let toolName: string | null = null;

  if (method === "POST") {
    const raw = await readBody(req);
    if (raw.length > 0) {
      try {
        parsedBody = JSON.parse(raw);
      } catch {
        json(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error" },
          id: null,
        });
        record({ method, path, auth, tool: null, status: 400 });
        return;
      }
    }

    // Identify every tools/call in the body. JSON-RPC permits a batch ARRAY,
    // so normalize: a single crear_reserva wrapped in [ ... ] must still be gated,
    // otherwise the tool executes unauthenticated and Phase B attribution breaks.
    const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
    const calledTools = messages
      .map((m) => {
        const b = m as { method?: string; params?: { name?: string } } | undefined;
        return b && b.method === "tools/call" && b.params && typeof b.params.name === "string"
          ? b.params.name
          : null;
      })
      .filter((n): n is string => n !== null);
    toolName = calledTools.length > 0 ? calledTools.join(",") : null;

    // SPIKE_GATE=off disables the auth gate — used ONLY for the WS2 isolation
    // experiment (does ChatGPT refuse crear_reserva because of auth, or caution?).
    // Default (unset) keeps the gate ON, so verify:all is unaffected.
    if (calledTools.includes("crear_reserva") && process.env.SPIKE_GATE !== "off") {
      const token = bearerToken(req);
      let ok = false;
      if (token) {
        try {
          await verifyAccessToken(token, {
            expectedAud: RESOURCE,
            requiredScope: REQUIRED_SCOPE,
          });
          ok = true;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        // Real HTTP 401 at the transport boundary — never a JSON-RPC error in 200.
        json(
          res,
          401,
          { error: "invalid_token", error_description: "Bearer with scope reservation:create required" },
          { "www-authenticate": WWW_AUTH },
        );
        record({ method, path, auth, tool: "crear_reserva", status: 401 });
        return;
      }
    }
  }

  // Anonymous / non-gated paths (initialize, tools/list, notifications,
  // buscar_disponibilidad, valid crear_reserva) -> straight to the transport.
  const transport = await createTransport();
  // Capture the final status for the log without consuming the stream.
  const origWriteHead = res.writeHead.bind(res);
  let finalStatus = 200;
  (res as ServerResponse).writeHead = ((statusCode: number, ...rest: unknown[]) => {
    finalStatus = statusCode;
    // @ts-expect-error variadic passthrough to node's overloaded writeHead
    return origWriteHead(statusCode, ...rest);
  }) as ServerResponse["writeHead"];

  res.on("finish", () => {
    record({ method, path, auth, tool: toolName, status: finalStatus });
  });

  try {
    await transport.handleRequest(req, res, parsedBody);
  } finally {
    // stateless: close the per-request transport.
    await transport.close().catch(() => {});
  }
}

export async function start(): Promise<{ close: () => Promise<void>; port: number }> {
  await initKeys();
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[server] unhandled error", err);
      if (!res.headersSent) {
        json(res, 500, { error: "internal_error" });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.error(`[spike] listening on ${BASE}  (RESOURCE=${RESOURCE}, ISSUER=${ISSUER})`);

  return {
    port: PORT,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Run directly when invoked as the entrypoint.
const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  start().catch((err) => {
    console.error("[spike] failed to start", err);
    process.exit(1);
  });
}
