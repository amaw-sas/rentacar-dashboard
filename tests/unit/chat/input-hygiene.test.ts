import { describe, it, expect } from "vitest";
import {
  isDuplicateUserMessage,
  normalizeForDedup,
} from "@/lib/chat/input-hygiene";
import type { PersistedMessage } from "@/lib/chat/persistence";

/** Pure tests for the dedup decision — no LLM, no DB, history is a fixture. */

const NOW = Date.parse("2026-06-29T12:00:00Z");
const at = (secondsAgo: number) =>
  new Date(NOW - secondsAgo * 1000).toISOString();

const msg = (
  role: PersistedMessage["role"],
  content: string,
  createdAt: string | null = at(2),
): PersistedMessage => ({ role, content, created_at: createdAt });

const dup = (history: PersistedMessage[], text: string) =>
  isDuplicateUserMessage(history, text, { nowMs: NOW });

describe("isDuplicateUserMessage", () => {
  it("is a duplicate when the last message is an identical, recent user turn", () => {
    expect(dup([msg("user", "Hola")], "Hola")).toBe(true);
  });

  it("is NOT a duplicate when the bot already replied (last message is assistant)", () => {
    // A repeated "sí" after a bot reply is a legitimate new turn, not a duplicate.
    expect(dup([msg("user", "sí"), msg("assistant", "¿Confirmo?")], "sí")).toBe(
      false,
    );
  });

  it("is NOT a duplicate when the text differs", () => {
    expect(dup([msg("user", "Hola")], "Bogotá")).toBe(false);
  });

  it("ignores surrounding/internal whitespace differences", () => {
    expect(dup([msg("user", "del 1 al 4")], "  del   1  al 4 ")).toBe(true);
  });

  it("is NOT a duplicate when the prior message is outside the time window", () => {
    expect(
      isDuplicateUserMessage([msg("user", "Hola", at(600))], "Hola", {
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("treats a missing created_at as in-window (best-effort)", () => {
    expect(dup([msg("user", "Hola", null)], "Hola")).toBe(true);
  });

  it("never dedups an empty message or empty history", () => {
    expect(dup([msg("user", "")], "")).toBe(false);
    expect(dup([], "Hola")).toBe(false);
  });

  it("only compares against the LAST message, not earlier ones", () => {
    const history = [msg("user", "Hola", at(5)), msg("user", "Bogotá", at(2))];
    expect(dup(history, "Hola")).toBe(false); // matches an earlier turn, not the last
    expect(dup(history, "Bogotá")).toBe(true);
  });
});

describe("normalizeForDedup", () => {
  it("trims and collapses whitespace without lowercasing", () => {
    expect(normalizeForDedup("  Sí   señor ")).toBe("Sí señor");
  });
});
