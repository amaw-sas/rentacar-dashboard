// Reference client — the self-verifier. Hand-rolled raw fetch so we observe the
// OAuth wire contract directly (an SDK browser-OAuth provider would swallow the
// raw 401 + headers we must assert). Asserts SCEN-A1..A4.
//
// Exit 0 if all scenarios pass; exit 1 with FAIL:<detail> on any failure.

import { randomBytes, createHash } from "node:crypto";
import { BASE, RESOURCE, ISSUER, REQUIRED_SCOPE } from "./config.js";
import {
  initKeys,
  signAccessToken,
  generateThrowawayPrivateKey,
} from "./keys.js";

const MCP_URL = `${BASE}/mcp`;
const PROTOCOL_VERSION = "2025-11-25";

class AssertError extends Error {}
function assert(cond: unknown, detail: string): asserts cond {
  if (!cond) throw new AssertError(detail);
}

// ---- raw JSON-RPC over Streamable HTTP ----

let rpcId = 0;

interface RpcResult {
  httpStatus: number;
  headers: Headers;
  body: unknown;
}

// Parse either application/json or an SSE-framed single message.
function parseMaybeSse(text: string, contentType: string): unknown {
  if (contentType.includes("text/event-stream")) {
    // Grab the last `data:` line's JSON.
    const lines = text.split(/\r?\n/);
    const dataLines = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    const joined = dataLines.join("");
    if (!joined) return undefined;
    try {
      return JSON.parse(joined);
    } catch {
      return undefined;
    }
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function rpc(
  payload: Record<string, unknown>,
  opts: { bearer?: string; protocolHeader?: boolean } = {},
): Promise<RpcResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (opts.protocolHeader !== false) headers["mcp-protocol-version"] = PROTOCOL_VERSION;
  if (opts.bearer) headers["authorization"] = `Bearer ${opts.bearer}`;

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  return { httpStatus: res.status, headers: res.headers, body: parseMaybeSse(text, ct) };
}

function rpcReq(method: string, params: unknown): Record<string, unknown> {
  rpcId += 1;
  return { jsonrpc: "2.0", id: rpcId, method, params };
}

// Initialize handshake (required before tools/call on Streamable HTTP).
async function initialize(): Promise<void> {
  const r = await rpc(
    rpcReq("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "ws2-reference-client", version: "0.0.0" },
    }),
  );
  assert(r.httpStatus === 200, `initialize expected 200, got ${r.httpStatus}`);
  // Send the initialized notification (no id; transport returns 202).
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
}

function extractToolResult(body: unknown): { isError: boolean; data: unknown } {
  const b = body as { result?: { isError?: boolean; structuredContent?: unknown; content?: Array<{ text?: string }> }; error?: unknown };
  if (b?.error) return { isError: true, data: b.error };
  const result = b?.result;
  if (!result) return { isError: true, data: body };
  let data: unknown = result.structuredContent;
  if (data === undefined && Array.isArray(result.content) && result.content[0]?.text) {
    try {
      data = JSON.parse(result.content[0].text);
    } catch {
      data = result.content[0].text;
    }
  }
  return { isError: Boolean(result.isError), data };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  bearer?: string,
): Promise<RpcResult> {
  return rpc(rpcReq("tools/call", { name, arguments: args }), { bearer });
}

// ---- PKCE ----

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}
function makePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

// ---- scenarios ----

const REDIRECT_URI = "http://127.0.0.1:0/callback"; // never actually hit; we read Location ourselves.

async function scenA1(): Promise<void> {
  const r = await callTool("buscar_disponibilidad", {
    ciudad: "Bogota",
    fecha_recogida: "2026-07-01",
    fecha_entrega: "2026-07-05",
  });
  assert(r.httpStatus === 200, `A1: expected HTTP 200, got ${r.httpStatus}`);
  const { isError, data } = extractToolResult(r.body);
  assert(!isError, `A1: tool returned error: ${JSON.stringify(data)}`);
  const d = data as { disponibilidad?: unknown[] };
  assert(
    Array.isArray(d?.disponibilidad) && d.disponibilidad.length > 0,
    `A1: expected disponibilidad data, got ${JSON.stringify(data)}`,
  );
  console.log("SCEN-A1 PASS");
}

async function scenA2(): Promise<void> {
  const r = await callTool("crear_reserva", {
    quote: "QUOTE-SPIKE-ECON-0001",
    nombre: "Test User",
    email: "test@example.com",
  });
  assert(r.httpStatus === 401, `A2: expected HTTP 401, got ${r.httpStatus}`);
  const wwwAuth = r.headers.get("www-authenticate");
  assert(wwwAuth !== null, "A2: missing WWW-Authenticate header");
  assert(wwwAuth!.startsWith("Bearer "), `A2: WWW-Authenticate must start with "Bearer ", got: ${wwwAuth}`);
  assert(
    /resource_metadata="[^"]+"/.test(wwwAuth!),
    `A2: WWW-Authenticate missing resource_metadata: ${wwwAuth}`,
  );
  assert(
    wwwAuth!.includes(`scope="${REQUIRED_SCOPE}"`),
    `A2: WWW-Authenticate missing scope="${REQUIRED_SCOPE}": ${wwwAuth}`,
  );
  console.log("SCEN-A2 PASS");
}

// Regression for the batch-bypass hole: a crear_reserva wrapped in a JSON-RPC
// batch array must still produce a real HTTP 401, not slip past the gate as a 200.
async function scenA2Batch(): Promise<void> {
  const body = [
    rpcReq("tools/call", {
      name: "crear_reserva",
      arguments: { quote: "QUOTE-SPIKE-ECON-0001", nombre: "Batch User", email: "batch@example.com" },
    }),
  ];
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
    },
    body: JSON.stringify(body),
  });
  assert(
    res.status === 401,
    `A2b: batch-wrapped crear_reserva must be HTTP 401 (gate bypass), got ${res.status}`,
  );
  const wwwAuth = res.headers.get("www-authenticate");
  assert(
    wwwAuth !== null && wwwAuth.startsWith("Bearer "),
    `A2b: batch 401 missing WWW-Authenticate: ${wwwAuth}`,
  );
  console.log("SCEN-A2b PASS (batch-wrapped crear_reserva gated)");
}

interface LogEntry {
  method: string;
  path: string;
  auth: string;
  tool: string | null;
  status: number;
}

async function fetchLog(): Promise<LogEntry[]> {
  const res = await fetch(`${BASE}/__log`);
  return (await res.json()) as LogEntry[];
}

// Assert that the given subsequence appears IN ORDER within the full log.
function assertOrderedSubsequence(
  log: LogEntry[],
  expected: Array<Partial<LogEntry>>,
): void {
  let cursor = 0;
  for (const exp of expected) {
    let found = -1;
    for (let i = cursor; i < log.length; i++) {
      const e = log[i];
      const match =
        (exp.method === undefined || e.method === exp.method) &&
        (exp.path === undefined || e.path === exp.path) &&
        (exp.tool === undefined || e.tool === exp.tool) &&
        (exp.status === undefined || e.status === exp.status);
      if (match) {
        found = i;
        break;
      }
    }
    assert(
      found >= 0,
      `A3: log missing ordered entry ${JSON.stringify(exp)} after index ${cursor}. Log=${JSON.stringify(log)}`,
    );
    cursor = found + 1;
  }
}

async function scenA3(): Promise<void> {
  // (A2 already produced the step-1 401; this runs the full dance and retries.)

  // step 2: protected resource metadata
  const prm = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
  assert(prm.status === 200, `A3: PRM expected 200, got ${prm.status}`);
  const prmBody = (await prm.json()) as { resource: string; authorization_servers: string[] };
  assert(prmBody.resource === RESOURCE, `A3: PRM resource mismatch: ${prmBody.resource} !== ${RESOURCE}`);
  const asUrl = prmBody.authorization_servers[0];
  assert(asUrl === ISSUER, `A3: PRM authorization_servers[0] mismatch: ${asUrl} !== ${ISSUER}`);

  // step 3: AS metadata
  const asm = await fetch(`${asUrl}/.well-known/oauth-authorization-server`);
  assert(asm.status === 200, `A3: AS metadata expected 200, got ${asm.status}`);
  const asmBody = (await asm.json()) as {
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    code_challenge_methods_supported: string[];
  };
  assert(
    asmBody.code_challenge_methods_supported.includes("S256"),
    "A3: AS metadata must advertise S256",
  );

  // step 4: DCR
  const reg = await fetch(asmBody.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" }),
  });
  assert(reg.status === 201, `A3: register expected 201, got ${reg.status}`);
  const regBody = (await reg.json()) as { client_id: string };
  assert(typeof regBody.client_id === "string" && regBody.client_id.length > 0, "A3: register returned no client_id");

  // step 5: authorize (read Location WITHOUT following the redirect)
  const { verifier, challenge } = makePkce();
  const state = base64url(randomBytes(16));
  const authUrl = new URL(asmBody.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", regBody.client_id);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", REQUIRED_SCOPE);
  authUrl.searchParams.set("resource", RESOURCE);

  const authRes = await fetch(authUrl.toString(), { redirect: "manual" });
  assert(authRes.status === 302, `A3: authorize expected 302, got ${authRes.status}`);
  const location = authRes.headers.get("location");
  assert(location !== null, "A3: authorize missing Location header");
  const locUrl = new URL(location!);
  const code = locUrl.searchParams.get("code");
  const returnedState = locUrl.searchParams.get("state");
  assert(code !== null, "A3: authorize redirect missing code");
  assert(returnedState === state, `A3: state mismatch: ${returnedState} !== ${state}`);

  // step 6: token exchange (PKCE verifier + resource)
  const tokenRes = await fetch(asmBody.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      client_id: regBody.client_id,
      resource: RESOURCE,
    }).toString(),
  });
  const tokenText = await tokenRes.text();
  assert(tokenRes.status === 200, `A3: token expected 200, got ${tokenRes.status} body=${tokenText}`);
  const tokenBody = JSON.parse(tokenText) as { access_token: string; token_type: string; scope: string };
  assert(typeof tokenBody.access_token === "string" && tokenBody.access_token.length > 0, "A3: token returned no access_token");
  assert(tokenBody.token_type === "Bearer", `A3: token_type expected Bearer, got ${tokenBody.token_type}`);

  // step 7: retry crear_reserva with the Bearer
  const retry = await callTool(
    "crear_reserva",
    { quote: "QUOTE-SPIKE-ECON-0001", nombre: "Test User", email: "test@example.com" },
    tokenBody.access_token,
  );
  assert(retry.httpStatus === 200, `A3: authorized crear_reserva expected 200, got ${retry.httpStatus}`);
  const { isError, data } = extractToolResult(retry.body);
  assert(!isError, `A3: crear_reserva returned error: ${JSON.stringify(data)}`);
  const d = data as { status?: string; codigo?: string };
  assert(d?.status === "ok" && d?.codigo === "SPIKE-TEST-001", `A3: unexpected crear_reserva result: ${JSON.stringify(data)}`);

  // assert the ordered 7-step flow in the server log
  const log = await fetchLog();
  assertOrderedSubsequence(log, [
    { method: "POST", path: "/mcp", tool: "crear_reserva", status: 401 },
    { method: "GET", path: "/.well-known/oauth-protected-resource", status: 200 },
    { method: "GET", path: "/.well-known/oauth-authorization-server", status: 200 },
    { method: "POST", path: "/token", status: 200 },
    { method: "POST", path: "/mcp", tool: "crear_reserva", status: 200 },
  ]);

  console.log("SCEN-A3 PASS");
}

async function scenA4(): Promise<void> {
  // (a) bad signature: valid claims but signed with a DIFFERENT key.
  const throwaway = await generateThrowawayPrivateKey();
  const badSig = await signAccessToken({
    aud: RESOURCE,
    scope: REQUIRED_SCOPE,
    signWith: throwaway,
  });

  // (b) wrong audience: valid signature, aud points elsewhere.
  const wrongAud = await signAccessToken({
    aud: "https://evil.example.com/mcp",
    scope: REQUIRED_SCOPE,
  });

  // (c) expired: valid signature + aud, but exp in the past.
  const expired = await signAccessToken({
    aud: RESOURCE,
    scope: REQUIRED_SCOPE,
    expSeconds: -60,
  });

  const cases: Array<[string, string]> = [
    ["bad-signature", badSig],
    ["wrong-audience", wrongAud],
    ["expired", expired],
  ];

  for (const [label, token] of cases) {
    const r = await callTool(
      "crear_reserva",
      { quote: "Q", nombre: "X", email: "x@example.com" },
      token,
    );
    assert(r.httpStatus === 401, `A4(${label}): expected HTTP 401, got ${r.httpStatus}`);
  }
  console.log("SCEN-A4 PASS");
}

export async function run(): Promise<number> {
  // Reference client signs forged tokens against the SAME in-memory keypair as
  // the server only when running in-process (verify:all). For the standalone
  // `verify` script the server runs in another process with a different key, so
  // A4(b)/(c) "valid signature" cases would be rejected by signature too — still
  // a 401, which is the assertion. initKeys here gives A4(a) a real signer.
  await initKeys();

  try {
    await initialize();
    await scenA1();
    await scenA2();
    await scenA2Batch();
    await scenA3();
    await scenA4();
    console.log("\nAll Phase A scenarios passed.");
    return 0;
  } catch (err) {
    if (err instanceof AssertError) {
      console.error(`FAIL: ${err.message}`);
    } else {
      console.error(`FAIL: unexpected error: ${(err as Error).stack ?? err}`);
    }
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  run().then((code) => process.exit(code));
}
