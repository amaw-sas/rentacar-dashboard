import { describe, it, expect, vi } from "vitest";

// Auth actions are server-only (use Supabase + redirect).
// Unit tests validate the contract; integration tests validate the flow.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("auth actions", () => {
  describe("signIn", () => {
    it("returns error message on invalid credentials", async () => {
      const { createClient } = await import("@/lib/supabase/server");
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signInWithPassword: vi
            .fn()
            .mockResolvedValue({ error: { message: "Invalid login credentials" }, data: { user: null, session: null } }),
        },
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const { signIn } = await import("@/lib/actions/auth");
      const formData = new FormData();
      formData.set("email", "bad@example.com");
      formData.set("password", "wrong");

      const result = await signIn(formData);
      expect(result).toEqual({ error: "Invalid login credentials" });
    });

    it("redirects to / on successful login", async () => {
      const { createClient } = await import("@/lib/supabase/server");
      const { redirect } = await import("next/navigation");
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signInWithPassword: vi
            .fn()
            .mockResolvedValue({ error: null, data: { user: {}, session: {} } }),
        },
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const { signIn } = await import("@/lib/actions/auth");
      const formData = new FormData();
      formData.set("email", "admin@example.com");
      formData.set("password", "correct");

      await signIn(formData);
      expect(redirect).toHaveBeenCalledWith("/");
    });
  });

  describe("signOut", () => {
    it("calls supabase signOut and redirects to /login", async () => {
      const signOutFn = vi.fn().mockResolvedValue({});
      const { createClient } = await import("@/lib/supabase/server");
      const { redirect } = await import("next/navigation");
      vi.mocked(createClient).mockResolvedValue({
        auth: { signOut: signOutFn },
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const { signOut } = await import("@/lib/actions/auth");
      await signOut();

      expect(signOutFn).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith("/login");
    });
  });
});
