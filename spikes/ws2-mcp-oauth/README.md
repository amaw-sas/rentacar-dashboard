# WS2 spike — MCP + mock OAuth, tiered-auth wire contract

Throwaway spike for epic #172, workstream WS2. **Not production. Do not merge to `main`.**

It builds the minimal instrument to answer one risk question: when a protected MCP
tool returns **HTTP 401 + `WWW-Authenticate: Bearer`** mid-session, does the AI client
re-trigger OAuth and retry? This package is **Phase A** — it proves the *server* is
correct so that later a ChatGPT/Claude failure is unambiguously a *client* bug.

Design doc (authoritative, binding):
`docs/specs/2026-06-19-spike-ws2-oauth-retrigger-design.md`

## What's here

One `tsx` process on a single origin:

- **MCP resource server** (`POST/GET /mcp`, Streamable HTTP) with two tools:
  - `buscar_disponibilidad` — anonymous, returns canned availability (200).
  - `crear_reserva` — gated: needs a valid Bearer with scope `reservation:create`,
    else a **real HTTP 401** at the transport boundary with the `WWW-Authenticate` header.
- **Mock OAuth Authorization Server**: RFC 9728 protected-resource metadata, RFC 8414 AS
  metadata (+ `openid-configuration` alias), permissive DCR (`/register`), `/authorize`
  (PKCE S256, auto-approved), `/token` (PKCE verify + audience-bound JWT), `/jwks.json`.
- **Logger**: in-memory ordered request log, streamed to the terminal, exposed at `/__log`.
- **Reference client** (`src/reference-client.ts`): hand-rolled raw-fetch OAuth dance that
  self-verifies the wire contract via scenarios SCEN-A1..A4.

The gate is emitted by *peeking* the JSON-RPC body before the SDK transport: a
`tools/call` for `crear_reserva` without a valid Bearer never enters the transport — it
gets a genuine HTTP 401. Everything else (initialize, tools/list, notifications,
`buscar_disponibilidad`, authorized `crear_reserva`) passes straight through.

## Phase A — run it (no external clients needed)

```bash
npm install
npm run verify:all
```

`verify:all` boots the server in-process, runs the reference-client asserts, prints
`SCEN-A1 PASS` … `SCEN-A4 PASS`, and exits 0 on success / 1 on any failure. Because it's
one process, the server and client share one in-memory keypair, so SCEN-A4's
"valid signature, wrong aud / expired exp" cases truly exercise aud/exp rejection.

Type-check: `npm run type-check`.

Run the server alone (e.g. to curl it): `npm run server`, then in another shell
`npm run verify` runs the asserts against the already-running server. (Standalone, the
client's forged tokens are signed with a different keypair, so SCEN-A4 also rejects by
signature — still 401, which is the assertion.)

Scenarios:

- **SCEN-A1** — `buscar_disponibilidad` without token → 200 + data.
- **SCEN-A2** — `crear_reserva` without token → **HTTP 401** + well-formed
  `WWW-Authenticate: Bearer resource_metadata="…", scope="reservation:create"`.
- **SCEN-A3** — 401 → discovery → register → authorize (PKCE S256) → token → retry with
  Bearer → 200; `/__log` shows the ordered 7-step flow.
- **SCEN-A4** — forged-signature / wrong-audience / expired Bearer each → 401.

## Phase B — expose for real clients (gated by client access)

```bash
SPIKE_BASE_URL=https://<your-tunnel>  npm run server
# expose localhost:8787 via cloudflared / ngrok with a STABLE name
```

`SPIKE_BASE_URL` is the single source of truth: every metadata doc and the aud-check read
`RESOURCE = ${SPIKE_BASE_URL}/mcp` from it. The tunnel URL must be stable — `resource` is
exact-match. Then connect Claude (control) and ChatGPT (the unknown) by URL
(`https://<tunnel>/mcp`) and observe the mid-session re-trigger. Full runbook, redirect-URI
notes, and the observation matrix (SCEN-B1/B2) are in the design doc's
"Runbook Fase B" section.

## Config knobs

- `SPIKE_BASE_URL` — base origin (default `http://localhost:8787`). `RESOURCE`/`ISSUER`/`PORT` derive from it.
- `PORT` — override the listen port if it can't be derived from the URL.
