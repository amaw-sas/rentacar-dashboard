import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  extractLatestQuotes,
  resolveBookingQuote,
  type LatestQuotes,
} from "@/lib/chat/agent";
import type { PersistedMessage } from "@/lib/chat/persistence";

// The booking flow no longer round-trips the opaque quote through the LLM (gpt-5-mini
// corrupts the long base64url blob → decodeQuote rejected every booking). Instead the
// server extracts the last cotizar result from history and resolves categoria → quote.
// These tests pin that extraction + resolution, including the freshness guard.

function cotizarMsg(
  categorias: Array<{ categoria: string; descripcion?: string; quote: string }>,
  created_at?: string,
): PersistedMessage {
  return {
    role: "assistant",
    content: "",
    created_at: created_at ?? null,
    parts: [
      {
        type: "tool-cotizar",
        toolCallId: "call_1",
        state: "output-available",
        input: { ciudad: "cartagena" },
        output: { disponibilidad: { sede: "CTG", dias: 3, categorias } },
      },
    ],
  };
}

describe("extractLatestQuotes", () => {
  it("pulls categoria → quote (+ descripcion + quotedAt) from the cotizar part", () => {
    const history: PersistedMessage[] = [
      { role: "user", content: "cotiza", parts: [{ type: "text", text: "cotiza" }] },
      cotizarMsg(
        [
          { categoria: "C", descripcion: "económico", quote: "QC" },
          { categoria: "F", descripcion: "SUV", quote: "QF" },
        ],
        "2026-06-22T10:00:00.000Z",
      ),
    ];
    const latest = extractLatestQuotes(history);
    expect(latest.entries).toEqual([
      { categoria: "C", descripcion: "económico", quote: "QC" },
      { categoria: "F", descripcion: "SUV", quote: "QF" },
    ]);
    expect(latest.quotedAtMs).toBe(Date.parse("2026-06-22T10:00:00.000Z"));
  });

  it("takes the MOST RECENT cotizar when there are several (re-quote)", () => {
    const history: PersistedMessage[] = [
      cotizarMsg([{ categoria: "C", quote: "OLD" }], "2026-06-22T10:00:00.000Z"),
      { role: "user", content: "y más barato?", parts: [] },
      cotizarMsg([{ categoria: "C", quote: "NEW" }], "2026-06-22T11:00:00.000Z"),
    ];
    const latest = extractLatestQuotes(history);
    expect(latest.entries).toEqual([{ categoria: "C", descripcion: undefined, quote: "NEW" }]);
    expect(latest.quotedAtMs).toBe(Date.parse("2026-06-22T11:00:00.000Z"));
  });

  it("returns empty when there is no cotizar in history", () => {
    const history: PersistedMessage[] = [
      { role: "user", content: "hola", parts: [{ type: "text", text: "hola" }] },
    ];
    expect(extractLatestQuotes(history)).toEqual({ quotedAtMs: null, entries: [] });
  });

  it("quotedAtMs is null for legacy rows without created_at (no age-check)", () => {
    const latest = extractLatestQuotes([cotizarMsg([{ categoria: "C", quote: "QC" }])]);
    expect(latest.quotedAtMs).toBeNull();
    expect(latest.entries).toHaveLength(1);
  });
});

describe("resolveBookingQuote", () => {
  const now = Date.parse("2026-06-22T12:00:00.000Z");
  const fresh: LatestQuotes = {
    quotedAtMs: Date.parse("2026-06-22T11:30:00.000Z"), // 30 min ago
    entries: [
      { categoria: "C", descripcion: "económico", quote: "QC" },
      { categoria: "F", descripcion: "SUV familiar", quote: "QF" },
    ],
  };

  beforeEach(() => {
    delete process.env.CHAT_QUOTE_MAX_AGE_HOURS;
  });
  afterEach(() => {
    delete process.env.CHAT_QUOTE_MAX_AGE_HOURS;
  });

  it("resolves the quote by exact gama code", () => {
    expect(resolveBookingQuote(fresh, "C", now)).toEqual({ ok: true, quote: "QC" });
  });

  it("resolves tolerantly by descripcion when the code does not match", () => {
    expect(resolveBookingQuote(fresh, "familiar", now)).toEqual({ ok: true, quote: "QF" });
  });

  it("errors (re-cotizar) when the gama is not in the latest quote", () => {
    const r = resolveBookingQuote(fresh, "Z", now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cotizar de nuevo/i);
  });

  it("errors (refresh price) when the quote is older than the 1h default", () => {
    const stale: LatestQuotes = {
      quotedAtMs: Date.parse("2026-06-22T10:30:00.000Z"), // 90 min ago > 1h
      entries: fresh.entries,
    };
    const r = resolveBookingQuote(stale, "C", now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/actualizar el precio/i);
  });

  it("honors CHAT_QUOTE_MAX_AGE_HOURS override", () => {
    process.env.CHAT_QUOTE_MAX_AGE_HOURS = "3";
    const stale90min: LatestQuotes = {
      quotedAtMs: Date.parse("2026-06-22T10:30:00.000Z"), // 90 min ago < 3h
      entries: fresh.entries,
    };
    expect(resolveBookingQuote(stale90min, "C", now)).toEqual({ ok: true, quote: "QC" });
  });

  it("skips the age-check when quotedAtMs is null (legacy)", () => {
    const legacy: LatestQuotes = { quotedAtMs: null, entries: fresh.entries };
    expect(resolveBookingQuote(legacy, "C", now)).toEqual({ ok: true, quote: "QC" });
  });
});
