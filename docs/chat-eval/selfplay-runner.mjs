// Self-play eval runner: replays FUTURE-DATED persona scripts against the live preview bot.
// No _now needed — the personas use genuinely-future dates, so Localiza accepts them (clean).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const URL = "https://rentacar-dashboard-git-preview-c-5e09c0-info-42181061s-projects.vercel.app/api/chat";
const PERSONAS = JSON.parse(readFileSync("personas.json", "utf8"));
const OUT = process.env.OUT ?? "selfplay-results";
mkdirSync(OUT, { recursive: true });
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);
const TURN_DELAY = Number(process.env.TURN_DELAY ?? 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// 100s hard cap (route maxDuration 90s); AbortController covers fetch AND the stream read.
async function streamOnce(messages, convId, brand) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 100000);
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand, conversationId: convId, messages }),
      signal: ctrl.signal,
    });
    const cid = res.headers.get("x-conversation-id") ?? convId;
    if (!res.ok) { clearTimeout(to); return { cid, acc: `[HTTP ${res.status}]`, parts: [], status: res.status }; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", acc = "";
    const parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const p = line.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        let ev; try { ev = JSON.parse(p); } catch { continue; }
        if (ev.type === "text-delta") acc += ev.delta ?? ev.text ?? "";
        if (ev.type === "data-quoteTable" && ev.data) parts.push("TABLA: " + ev.data.filas.map((f) => `${f.categoria} $${f.precioTotal}`).join(" | "));
        if (ev.type === "data-gamaCards" && ev.data) parts.push("FOTOS gama " + ev.data.gama);
        if (ev.type === "data-buttons" && ev.data) parts.push("BOTONES " + JSON.stringify(ev.data));
      }
    }
    clearTimeout(to);
    return { cid, acc, parts, status: 200 };
  } catch (e) {
    clearTimeout(to);
    return { cid: convId, acc: `[fetch-error ${e.message}]`, parts: [], status: 0 };
  }
}

async function sendWithBackoff(messages, convId, brand) {
  const backoffs = [30000, 60000, 120000];
  const MAX_ATTEMPTS = 4;
  let attempt = 0;
  for (;;) {
    const r = await streamOnce(messages, convId, brand);
    if (r.status === 200) return r;
    if (r.status === 429 || r.status >= 500 || r.status === 0) {
      if (attempt >= MAX_ATTEMPTS) return r;
      const wait = backoffs[Math.min(attempt, backoffs.length - 1)];
      log(`  ${convId ?? "?"} backoff (${r.status}) ${wait / 1000}s [${attempt + 1}/${MAX_ATTEMPTS}]`);
      await sleep(wait);
      attempt++;
    } else return r;
  }
}

async function runPersona(p) {
  const file = `${OUT}/${p.id}.json`;
  if (existsSync(file)) { log(`skip ${p.id} (done)`); return; }
  let convId;
  const turns = [];
  let endReason = "completed";
  for (let i = 0; i < p.messages.length; i++) {
    const r = await sendWithBackoff([{ role: "user", parts: [{ type: "text", text: p.messages[i] }] }], convId, p.brand);
    if (r.status !== 200) { endReason = `error:${r.status}`; break; }
    convId = r.cid;
    turns.push({ user: p.messages[i], bot: r.acc, parts: r.parts });
    await sleep(TURN_DELAY);
  }
  writeFileSync(file, JSON.stringify({ id: p.id, brand: p.brand, profile: p.profile, buySignal: p.buySignal, convId, endReason, turns }, null, 1));
  log(`✓ ${p.id} (${turns.length}/${p.messages.length} turns, ${endReason})`);
}

// simple concurrency pool
log(`personas: ${PERSONAS.length} | concurrency ${CONCURRENCY}`);
let idx = 0;
async function worker() {
  for (;;) {
    const p = PERSONAS[idx++];
    if (!p) return;
    try { await runPersona(p); } catch (e) { log(`✗ ${p.id} ${e.message}`); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
log("ALL DONE");
writeFileSync("selfplay-COMPLETE", new Date().toISOString());
