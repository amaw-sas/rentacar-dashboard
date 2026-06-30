import { describe, it, expect } from "vitest";
import { parseHoras } from "@/lib/chat/orchestrator/hours";

describe("parseHoras — deterministic booking-hour parser", () => {
  it("parses the reported case: two hours in order", () => {
    expect(parseHoras("9am y lo regreso 9am")).toEqual(["09:00", "09:00"]);
    expect(parseHoras("A las 9am y lo regreso a las 9am")).toEqual(["09:00", "09:00"]);
    expect(parseHoras("recoger 8am, devolver 6pm")).toEqual(["08:00", "18:00"]);
  });

  it("accepts am/pm in every shape", () => {
    expect(parseHoras("9am")).toEqual(["09:00"]);
    expect(parseHoras("9 am")).toEqual(["09:00"]);
    expect(parseHoras("9AM")).toEqual(["09:00"]);
    expect(parseHoras("9 a.m.")).toEqual(["09:00"]);
    expect(parseHoras("9pm")).toEqual(["21:00"]);
    expect(parseHoras("2pm")).toEqual(["14:00"]);
  });

  it("handles the 12am/12pm edge", () => {
    expect(parseHoras("12am")).toEqual(["00:00"]);
    expect(parseHoras("12pm")).toEqual(["12:00"]);
  });

  it("accepts minutes and 24h colon form", () => {
    expect(parseHoras("9:30am")).toEqual(["09:30"]);
    expect(parseHoras("9:00")).toEqual(["09:00"]);
    expect(parseHoras("09:00")).toEqual(["09:00"]);
    expect(parseHoras("21:30")).toEqual(["21:30"]);
  });

  it("accepts the 'h' suffix", () => {
    expect(parseHoras("21h")).toEqual(["21:00"]);
    expect(parseHoras("9 hrs")).toEqual(["09:00"]);
  });

  it("accepts mediodía / medianoche and spelled-out hours", () => {
    expect(parseHoras("a mediodía")).toEqual(["12:00"]);
    expect(parseHoras("a medianoche")).toEqual(["00:00"]);
    expect(parseHoras("nueve de la mañana")).toEqual(["09:00"]);
    expect(parseHoras("nueve de la noche")).toEqual(["21:00"]);
    expect(parseHoras("dos de la tarde")).toEqual(["14:00"]);
  });

  it("does NOT capture bare numbers — dates, seats, ids stay out", () => {
    expect(parseHoras("del 5 al 9 de julio")).toEqual([]);
    expect(parseHoras("9 puestos")).toEqual([]);
    expect(parseHoras("CC 1018456722")).toEqual([]);
    expect(parseHoras("quiero 2 carros")).toEqual([]);
    expect(parseHoras("")).toEqual([]);
  });

  it("rejects out-of-range values", () => {
    expect(parseHoras("25:00")).toEqual([]);
    expect(parseHoras("13pm")).toEqual([]);
    expect(parseHoras("9:75")).toEqual([]);
  });
});
