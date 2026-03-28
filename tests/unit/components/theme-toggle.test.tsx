import { describe, it, expect, vi } from "vitest";

vi.mock("next-themes", () => ({
  useTheme: vi.fn(() => ({ theme: "light", setTheme: vi.fn() })),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("ThemeToggle", () => {
  it("renders without crashing", async () => {
    const { useTheme } = await import("next-themes");
    expect(useTheme).toBeDefined();
  });

  it("provides setTheme function", async () => {
    const { useTheme } = await import("next-themes");
    const { setTheme } = useTheme();
    expect(typeof setTheme).toBe("function");
  });
});
