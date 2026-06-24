import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @supabase/ssr so updateSession's client exposes a controllable
// auth.getUser spy — lets us count round-trips (SCEN-D) and simulate a hang
// (SCEN-G) without the Edge runtime or a real Supabase Auth server.
const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { authRedirectPath, updateSession } from "@/lib/supabase/middleware";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

const USER = { id: "u_1" };

function req(pathname: string) {
  return new NextRequest(new URL(`https://dash.test${pathname}`));
}

beforeEach(() => {
  getUser.mockReset();
});

// SCEN-A / SCEN-B / SCEN-C — the pure redirect decision, exhaustively.
describe("authRedirectPath (SCEN-A/B/C)", () => {
  it("SCEN-A: logged-out on a protected path → /login", () => {
    expect(authRedirectPath(null, "/")).toBe("/login");
    expect(authRedirectPath(null, "/reservations")).toBe("/login");
  });

  it("SCEN-B: logged-in on /login → /", () => {
    expect(authRedirectPath(USER, "/login")).toBe("/");
  });

  it("SCEN-C: no redirect when the state already matches the path", () => {
    expect(authRedirectPath(USER, "/")).toBeNull(); // logged-in, protected → proceed
    expect(authRedirectPath(null, "/login")).toBeNull(); // logged-out, login → proceed
  });
});

describe("middleware auth round-trips (SCEN-D)", () => {
  it("SCEN-D: a single non-public request calls getUser exactly once", async () => {
    // Guards the fix: the old middleware ran updateSession's getUser PLUS a
    // second client/getUser here — two sequential auth round-trips per request.
    // Counting through middleware() (the entry point) is what makes this a
    // genuine red-green for the de-duplication.
    getUser.mockResolvedValue({ data: { user: USER } });

    const res = await middleware(req("/"));

    expect(getUser).toHaveBeenCalledTimes(1);
    // Logged-in on a protected path → proceed (not a redirect).
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("updateSession (SCEN-A)", () => {
  it("SCEN-A: logged-out request redirects to /login", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await updateSession(req("/reservations"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});

describe("updateSession fail-closed timeout (SCEN-G)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("SCEN-G: a hung getUser fails closed → redirect to /login, no hang", async () => {
    // getUser never resolves — only the internal timeout can settle the race.
    getUser.mockReturnValue(new Promise(() => {}));

    const pending = updateSession(req("/reservations"));
    await vi.advanceTimersByTimeAsync(8000);
    const res = await pending;

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});

// SCEN-E — public API prefixes bypass session auth entirely (no getUser).
describe("middleware public-prefix bypass (SCEN-E)", () => {
  it("SCEN-E: a public prefix request never touches Supabase Auth", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await middleware(req("/api/mcp/anything"));

    expect(getUser).not.toHaveBeenCalled();
    // Bypass = NextResponse.next(), not a redirect.
    expect(res.headers.get("location")).toBeNull();
  });
});
