import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/reminders/pickup-sender", () => ({
  sendPickupReminders: vi.fn(),
}));

import { sendPickupReminders } from "@/lib/reminders/pickup-sender";
import { handlePickupReminderCron } from "@/lib/reminders/cron-handler";
import { GET as getWeek } from "@/app/api/cron/pickup-reminders/week/route";
import { GET as getThreeDays } from "@/app/api/cron/pickup-reminders/three-days/route";
import { GET as getSameDayMorning } from "@/app/api/cron/pickup-reminders/same-day-morning/route";
import { GET as getSameDayLate } from "@/app/api/cron/pickup-reminders/same-day-late/route";
import { GET as getPostMorning } from "@/app/api/cron/pickup-reminders/post-morning/route";
import { GET as getPostLate } from "@/app/api/cron/pickup-reminders/post-late/route";

const mockSend = vi.mocked(sendPickupReminders);
const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
});

afterAll(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
});

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("https://example.com/api/cron/pickup-reminders/week", {
    method: "GET",
    headers,
  });
}

describe("handlePickupReminderCron", () => {
  it("returns 401 when authorization header is missing", async () => {
    const res = await handlePickupReminderCron(makeRequest(), "week");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns 401 when bearer token does not match CRON_SECRET", async () => {
    const res = await handlePickupReminderCron(
      makeRequest("Bearer wrong-secret"),
      "week"
    );
    expect(res.status).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns 200 with results when authorized and sender resolves", async () => {
    mockSend.mockResolvedValue({ sent: 3, errors: 1, total: 4 });
    const res = await handlePickupReminderCron(
      makeRequest("Bearer test-secret"),
      "post-morning"
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      type: "post-morning",
      sent: 3,
      errors: 1,
      total: 4,
    });
    expect(mockSend).toHaveBeenCalledWith("post-morning");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when sender throws and logs the error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockRejectedValue(new Error("boom"));
    const res = await handlePickupReminderCron(
      makeRequest("Bearer test-secret"),
      "week"
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("pickup-reminders route → helper type wiring", () => {
  const cases = [
    { name: "week", handler: getWeek, expected: "week" },
    { name: "three-days", handler: getThreeDays, expected: "three-days" },
    {
      name: "same-day-morning",
      handler: getSameDayMorning,
      expected: "same-day-morning",
    },
    {
      name: "same-day-late",
      handler: getSameDayLate,
      expected: "same-day-late",
    },
    { name: "post-morning", handler: getPostMorning, expected: "post-morning" },
    { name: "post-late", handler: getPostLate, expected: "post-late" },
  ] as const;

  for (const { name, handler, expected } of cases) {
    it(`route ${name} forwards literal "${expected}" to sender`, async () => {
      mockSend.mockResolvedValue({ sent: 0, errors: 0, total: 0 });
      const res = await handler(makeRequest("Bearer test-secret"));
      expect(res.status).toBe(200);
      expect(mockSend).toHaveBeenCalledWith(expected);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  }
});
