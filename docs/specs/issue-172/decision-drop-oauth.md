# Decision — Drop OAuth, ship an anonymous MCP endpoint

**Date:** 2026-06-22 · **Issue:** #172 · **Status:** Accepted (directive-approved)

## Decision

`/api/mcp` (the reservation MCP server) ships **anonymous**: no OAuth, no `x-api-key`.
The OAuth requirement from the original #172 scope is dropped. The Phase-1
`x-api-key` / `MCP_API_KEY` / `verifyApiKey` model is also removed — it never reached
production and is superseded here.

## Rationale

- **OAuth support cost outweighs the benefit.** A correct OAuth integration that both
  ChatGPT and Claude accept requires a real authorization-server broker and
  client-specific quirks (see findings below). That is sustained operational and
  maintenance cost for a feature whose only product gain is identity prefill.
- **Identity prefill is marginal.** The chat already supplies the customer's name and
  email in the conversation; the reservation tool collects them as arguments. OAuth
  would re-derive what the chat already has.
- **The user's AI subscription is an out-of-scope identity layer.** Authentication of
  the human sits with ChatGPT/Claude, not with us; re-authenticating at the MCP layer
  duplicates an identity we neither own nor need.
- Directive-approved to drop OAuth and proceed anonymous.

## New model

Anonymous tools, defended in depth — no single secret gates access:

1. **Signed, expiring quote** — `buscar_disponibilidad` issues an HMAC-SHA256-signed
   quote (`MCP_QUOTE_SECRET`, >= 32 chars, fail-closed) that expires in 30 minutes.
   `crear_solicitud_reserva` only acts on a quote it can verify and that has not
   expired. The quote is the integrity/anti-tamper control: prices and quotation
   context cannot be forged or replayed past expiry. See `lib/api/mcp/quote.ts`.
2. **Vercel Firewall rate limit** — platform-level rate limiting on `/api/mcp` caps
   abuse volume without application code.
3. **Operator review** — every request lands as a reservation in status `nueva`; a
   human reviews before it advances. No anonymous request auto-commits a booking.

## WS2 empirical findings that drove the decision

The OAuth spike (WS2) established that a portable, low-cost OAuth integration is not
achievable with a hand-built authorization server:

- ChatGPT **does** run the full OAuth dance (discovery → DCR `/register` →
  `/authorize` → `/token`) when the connector is configured for it.
- A hand-built mock AS's token is **rejected for a server-invisible reason** even when
  the implementation is RFC 8707 (resource indicators), 9068 (JWT access tokens), and
  9207 (`iss` in the authorization response) correct. The failure surfaces no
  actionable signal on our side.
- ChatGPT requires proprietary `securitySchemes` (SEP-1488) plus
  `_meta["mcp/www_authenticate"]`, which is **not portable to Claude** — satisfying one
  client diverges from the other.
- ChatGPT's connection probe expects a **2xx**, not the MCP SDK's strict `406`, so the
  transport's spec-conformant rejection breaks the probe.
- Serving an `openid-configuration` makes ChatGPT **auto-enable OIDC** and then expect
  an `id_token` and a `userinfo` endpoint — escalating scope beyond plain OAuth.
- A production-grade path would require a real broker (e.g. WorkOS AuthKit) federating
  the identity provider. That is the cost we are choosing not to pay now.

If OAuth is ever revisited, start from a real broker — not a hand-built AS.

## Pre-deploy gates

- **Vercel Firewall rule on `/api/mcp`** — hard precondition per security review. The
  endpoint must not go live anonymous without platform rate limiting in place.
- **Runtime QA** — exercise both tools end-to-end (quote issue → verify → `nueva`
  reservation) against a real client before production.
