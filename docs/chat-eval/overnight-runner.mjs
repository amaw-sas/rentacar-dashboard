// Overnight cohort replay — robust, self-resuming, never-abort. Scans COHORT_DIR for all
// WhatsApp chat exports, replays each customer side against the preview bot, logs to the DB
// (→ dashboard), and writes a per-chat result file. Stops a chat at the final confirmation
// so NO real Localiza booking is created. Backs off (never aborts) on the abuse-shield 429.
//
// Pacing defaults respect the EXISTING caps (≤8 new convs/hr, ≤18 turns/conv) so it works
// even WITHOUT raising the Vercel env limits. Override via env for a faster run when raised:
//   FAST=1  → TURN_CAP=25, CHAT_SPACING_MS=20000
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseChat } from "./parse-cohort.mjs";

const COHORT_DIR = process.env.COHORT_DIR ?? "cohorte";
const RESULTS_DIR = process.env.RESULTS_DIR ?? "overnight-results";
const DONE_FILE = process.env.DONE_FILE ?? "overnight-done.json";
const STOP_FILE = "overnight-STOP";
const URL = "https://rentacar-dashboard-git-preview-c-5e09c0-info-42181061s-projects.vercel.app/api/chat";

/** Brand is encoded in the cohort folder name ("cohorte-alquicarros-…"). Each chat must be
 *  replayed against ITS brand (different sedes/pricing/KB), not a single hardcoded one. */
function brandFromPath(p) {
  if (/alquicarros/i.test(p)) return "alquicarros";
  if (/alquilame|alqu[ií]lame/i.test(p)) return "alquilame";
  return "alquilatucarro";
}
const FAST = process.env.FAST === "1";
const TURN_CAP = Number(process.env.TURN_CAP ?? (FAST ? 25 : 18));
const TURN_DELAY = Number(process.env.TURN_DELAY ?? 3000);
const CHAT_SPACING_MS = Number(process.env.CHAT_SPACING_MS ?? (FAST ? 20000 : 600000)); // 10 min default
// Budget guard: if N responses in a row come back COMPLETELY empty (no text, no parts),
// the LLM/credit is likely dead (last night's exhaustion signature) → stop to protect the
// $23 Gateway balance instead of blasting the rest into a dead model.
const EMPTY_STOP = Number(process.env.EMPTY_STOP ?? 6);
let emptyStreak = 0;
let abortRun = false;
const CONFIRM_RE = /¿confirmo (tu|la) reserva\?/i;
const MEDIA = /multimedia omitido|imagen omitida|video omitido|audio omitido|sticker omitido|‎?<adjunto|<Media omitted>/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

process.on("unhandledRejection", (e) => log(`unhandledRejection: ${e?.message ?? e}`));
process.on("uncaughtException", (e) => log(`uncaughtException: ${e?.message ?? e}`));

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
const loadDone = () => { try { return new Set(JSON.parse(readFileSync(DONE_FILE, "utf8"))); } catch { return new Set(); } };
const saveDone = (set) => writeFileSync(DONE_FILE, JSON.stringify([...set], null, 2));

/** Recursively find every "Chat de WhatsApp con <phone>.txt" under COHORT_DIR. */
function findChats(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...findChats(p));
    else if (/^Chat de WhatsApp con .+\.txt$/.test(e)) {
      const phone = e.replace(/^Chat de WhatsApp con /, "").replace(/\.txt$/, "").trim();
      out.push({ phone, path: p, brand: brandFromPath(p) });
    }
  }
  return out;
}

/** The original chat's start datetime (Bogota) as ISO, to replay with the RIGHT "now" so past
 *  WhatsApp chats stop hitting phantom "fecha ya pasó" gates. Honored only when the preview has
 *  CHAT_ALLOW_TEST_NOW=1. null when unparseable. */
function originalNow(path) {
  const t = parseChat(readFileSync(path, "utf8"))[0];
  if (!t || !t.date || !t.time) return null;
  const [d, m, y] = t.date.split("/");
  if (!d || !m || !y) return null;
  const yyyy = y.length === 2 ? "20" + y : y;
  const [hh = "12", mm = "00"] = t.time.split(":");
  return `${yyyy}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:00-05:00`;
}

function customerTurns(path) {
  return parseChat(readFileSync(path, "utf8"))
    .filter((t) => /^\+?\d[\d\s]*$/.test(t.sender.trim()))
    .map((t) => t.text.trim())
    .filter((t) => t && !MEDIA.test(t))
    .slice(0, TURN_CAP);
}

// 100s hard cap per request (the route's maxDuration is 90s). AbortController covers BOTH the
// fetch AND the streaming read, so a hung stream aborts instead of waiting ~forever.
async function streamOnce(messages, convId, brand, testNow) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 100000);
  try {
    const res = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand, conversationId: convId, messages, ...(testNow ? { _now: testNow } : {}) }), signal: ctrl.signal });
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

/** Send one turn with infinite-but-bounded backoff on 429/5xx. Never throws. */
async function sendWithBackoff(messages, convId, brand, testNow) {
  const backoffs = [30000, 60000, 120000]; // 30s,1m,2m — shorter; the 100s timeout caps hangs
  const MAX_ATTEMPTS = 4;
  let attempt = 0;
  for (;;) {
    if (existsSync(STOP_FILE)) return { cid: convId, acc: "[STOP]", parts: [], status: -1 };
    const r = await streamOnce(messages, convId, brand, testNow);
    if (r.status === 200) return r;
    if (r.status === 429 || r.status >= 500 || r.status === 0) {
      if (attempt >= MAX_ATTEMPTS) return r; // give up on a poison turn instead of looping
      const wait = backoffs[Math.min(attempt, backoffs.length - 1)];
      log(`  backoff (${r.status}) ${wait / 1000}s [attempt ${attempt + 1}/${MAX_ATTEMPTS}]`);
      await sleep(wait);
      attempt++;
      continue;
    }
    return r; // other 4xx → don't loop forever
  }
}

async function replayChat(chat) {
  const turns = customerTurns(chat.path);
  const testNow = originalNow(chat.path); // replay with the chat's real date (preview gate)
  const history = [];
  let convId, endReason = "completed";
  const tlog = [];
  for (let i = 0; i < turns.length; i++) {
    if (existsSync(STOP_FILE)) { endReason = "stopped"; break; }
    const msgs = [...history, { role: "user", parts: [{ type: "text", text: turns[i] }] }];
    const r = await sendWithBackoff(msgs, convId, chat.brand, testNow);
    convId = r.cid;
    if (r.status === -1) { endReason = "stopped"; break; }
    tlog.push({ user: turns[i], bot: r.acc, parts: r.parts });
    history.push({ role: "user", parts: [{ type: "text", text: turns[i] }] });
    history.push({ role: "assistant", parts: [{ type: "text", text: r.acc }] });
    // Budget guard: a 200 with no text AND no data parts = the LLM produced nothing
    // (credit/quota dead). Count the streak across chats; trip → abort the whole run.
    const dead = r.status === 200 && r.acc.trim() === "" && r.parts.length === 0;
    emptyStreak = dead ? emptyStreak + 1 : 0;
    if (emptyStreak >= EMPTY_STOP) { abortRun = true; endReason = "llm-dead"; break; }
    if (CONFIRM_RE.test(r.acc)) { endReason = "stopped-at-confirmation"; break; }
    await sleep(TURN_DELAY);
  }
  return { phone: chat.phone, brand: chat.brand, convId, endReason, turns: tlog };
}

// Single pass over all not-yet-done chats. The wrapper re-runs us to pick up new files.
log(`overnight runner start (FAST=${FAST}, TURN_CAP=${TURN_CAP}, spacing=${CHAT_SPACING_MS / 1000}s)`);
const done = loadDone();
const key = (c) => `${c.brand}:${c.phone}`;
const chats = findChats(COHORT_DIR).filter((c) => !done.has(key(c)));
// Priority: alquilatucarro first (the focus), then other brands.
chats.sort((a, b) => (a.brand === "alquilatucarro" ? 0 : 1) - (b.brand === "alquilatucarro" ? 0 : 1));
const byBrand = chats.reduce((m, c) => ((m[c.brand] = (m[c.brand] || 0) + 1), m), {});
log(`found ${chats.length} pending chats ${JSON.stringify(byBrand)} (already done: ${done.size})`);
if (chats.length === 0) {
  writeFileSync("overnight-COMPLETE", new Date().toISOString());
  log("all chats done — wrote COMPLETE sentinel; exiting.");
  process.exit(0);
}
for (const chat of chats) {
  if (existsSync(STOP_FILE)) { log("STOP file present — exiting."); break; }
  let res;
  try { res = await replayChat(chat); }
  catch (e) { res = { phone: chat.phone, brand: chat.brand, convId: null, endReason: `error:${e.message}`, turns: [] }; }
  writeFileSync(join(RESULTS_DIR, `${chat.brand}_${chat.phone}.json`), JSON.stringify(res, null, 2));
  // Only mark DONE when the chat produced real content — so empty/dead results retry once
  // the Gateway credit is back (the auto-renewal), instead of being skipped forever.
  const usable =
    res.endReason !== "llm-dead" &&
    res.turns.some((t) => (t.bot || "").trim() !== "" || (t.parts || []).length);
  if (usable) { done.add(key(chat)); saveDone(done); }
  log(`✓ [${chat.brand}] ${chat.phone} → ${res.convId} (${res.turns.length} turns, ${res.endReason})${usable ? "" : " [no marcado, reintenta]"}`);
  if (abortRun) {
    writeFileSync("overnight-STOP", "llm-dead " + new Date().toISOString());
    log("⛑️ Respuestas vacías seguidas — el crédito del Gateway parece agotado. Paro y escribo overnight-STOP para no gastar más.");
    break;
  }
  await sleep(CHAT_SPACING_MS);
}
log(`pass complete. done total: ${done.size}`);
