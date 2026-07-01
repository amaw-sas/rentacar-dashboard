import { describe, it, expect } from "vitest";
import { parseFechas } from "@/lib/chat/orchestrator/dates";

const TODAY = "2026-06-30"; // martes 30 de junio de 2026

describe("parseFechas — deterministic booking-date parser", () => {
  it("parses an absolute date with a named month, several shapes", () => {
    expect(parseFechas("2 de julio", TODAY)).toEqual(["2026-07-02"]);
    expect(parseFechas("el 2 de julio", TODAY)).toEqual(["2026-07-02"]);
    expect(parseFechas("2 jul", TODAY)).toEqual(["2026-07-02"]);
    expect(parseFechas("julio 2", TODAY)).toEqual(["2026-07-02"]);
    expect(parseFechas("5 de agosto", TODAY)).toEqual(["2026-08-05"]);
  });

  it("parses a same-month range (day1 inherits the month)", () => {
    expect(parseFechas("del 2 al 5 de julio", TODAY)).toEqual(["2026-07-02", "2026-07-05"]);
    expect(parseFechas("2 al 5 de julio", TODAY)).toEqual(["2026-07-02", "2026-07-05"]);
  });

  it("parses a cross-month range", () => {
    expect(parseFechas("del 2 de julio al 5 de agosto", TODAY)).toEqual([
      "2026-07-02",
      "2026-08-05",
    ]);
  });

  it("parses simple relatives against today", () => {
    expect(parseFechas("hoy", TODAY)).toEqual(["2026-06-30"]);
    expect(parseFechas("mañana", TODAY)).toEqual(["2026-07-01"]);
    expect(parseFechas("pasado mañana", TODAY)).toEqual(["2026-07-02"]);
    expect(parseFechas("lo recojo mañana", TODAY)).toEqual(["2026-07-01"]);
  });

  it("uses the nearest future year for the implicit year", () => {
    expect(parseFechas("30 de junio", TODAY)).toEqual(["2026-06-30"]); // today, not next year
    expect(parseFechas("2 de junio", TODAY)).toEqual(["2027-06-02"]); // already passed → next year
    expect(parseFechas("29 de junio", TODAY)).toEqual(["2027-06-29"]); // yesterday → next year
    expect(parseFechas("1 de enero", TODAY)).toEqual(["2027-01-01"]); // jan already passed
  });

  it("does NOT parse bare numbers, ambiguous numeric dates, or non-dates", () => {
    expect(parseFechas("tengo 5 personas", TODAY)).toEqual([]);
    expect(parseFechas("quiero 2 carros", TODAY)).toEqual([]);
    expect(parseFechas("el 2", TODAY)).toEqual([]); // no month
    expect(parseFechas("2/7", TODAY)).toEqual([]); // ambiguous numeric → LLM
    expect(parseFechas("02-07-2026", TODAY)).toEqual([]); // ambiguous numeric → LLM
    expect(parseFechas("en julio", TODAY)).toEqual([]); // month without a day
    expect(parseFechas("hola buenas", TODAY)).toEqual([]);
  });

  it("rejects an invalid day for the month", () => {
    expect(parseFechas("31 de febrero", TODAY)).toEqual([]);
    expect(parseFechas("45 de julio", TODAY)).toEqual([]);
  });
});
