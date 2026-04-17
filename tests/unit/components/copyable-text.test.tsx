import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { CopyableText } from "@/components/ui/copyable-text";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
  },
}));

describe("CopyableText", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders fallback dash when value is empty", () => {
    const { container } = render(<CopyableText value="" />);
    expect(container.textContent).toBe("—");
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders clickable button when value present", () => {
    render(<CopyableText value="1007489090" />);
    const btn = screen.getByRole("button", { name: /copiar/i });
    expect(btn.textContent).toContain("1007489090");
  });

  it("writes to clipboard on click", async () => {
    render(<CopyableText value="dc005241@gmail.com" />);
    fireEvent.click(screen.getByRole("button", { name: /copiar/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "dc005241@gmail.com",
      );
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("uses custom label for aria-label and toast", async () => {
    render(<CopyableText value="AV6OXGXGP" label="Código" />);
    const btn = screen.getByRole("button", { name: /copiar código/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });
  });

  describe("maxLength truncation", () => {
    it("renders full value when length <= maxLength", () => {
      render(<CopyableText value="short@x.io" maxLength={20} />);
      const btn = screen.getByRole("button");
      expect(btn.textContent).toContain("short@x.io");
      expect(btn.textContent).not.toContain("…");
    });

    it("renders truncated value with ellipsis when length > maxLength", () => {
      render(
        <CopyableText
          value="a-very-long-email-address@example.com"
          maxLength={20}
        />,
      );
      const btn = screen.getByRole("button");
      expect(btn.textContent).toContain("a-very-long-email-a…");
      expect(btn.textContent).not.toContain("example.com");
    });

    it("copies the full untruncated value on click", async () => {
      const full = "a-very-long-email-address@example.com";
      render(<CopyableText value={full} maxLength={20} />);
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(full);
      });
    });
  });
});
