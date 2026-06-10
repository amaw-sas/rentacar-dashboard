import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { DateRange } from "@/lib/date-range";

afterEach(cleanup);

// Controlled wrapper: the real component is fully controlled (selected={value}),
// so a single-day selection only emerges if the first onChange is fed back as
// the new `value` before the second click. This mirrors how the reservations
// table wires the picker through URL state.
function Harness({ onChange }: { onChange: (r: DateRange | undefined) => void }) {
  const [value, setValue] = useState<DateRange | undefined>(undefined);
  return (
    <DateRangePicker
      value={value}
      onChange={(r) => {
        setValue(r);
        onChange(r);
      }}
      placeholder="Creación"
    />
  );
}

// Finds the day-cell button whose visible text is exactly `day` inside the open
// calendar grid. RDP v10 hides outside days by default, so a mid-month number
// is unique regardless of which month renders (test runs on the current month).
function dayButton(day: string) {
  const grid = screen.getByRole("grid");
  return within(grid)
    .getAllByRole("button")
    .find((b) => b.textContent?.trim() === day) as HTMLElement;
}

describe("DateRangePicker (issue #116)", () => {
  it("SCEN-116-01 clicking the same day twice yields a single-day range (from === to)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /Creación/ }));

    // First click: incomplete range, no complete-range filter applied yet.
    await user.click(dayButton("15"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: undefined }),
    );

    // Second click on the SAME day completes a single-day range.
    await user.click(dayButton("15"));
    const range = onChange.mock.calls.at(-1)![0] as DateRange;
    expect(range.from).toBeInstanceOf(Date);
    expect(range.to).toBeInstanceOf(Date);
    expect(range.from!.getTime()).toBe(range.to!.getTime());
  });

  it("SCEN-116-02 still supports multi-day ranges (no regression)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /Creación/ }));
    await user.click(dayButton("10"));
    await user.click(dayButton("20"));

    const range = onChange.mock.calls.at(-1)![0] as DateRange;
    expect(range.from!.getDate()).toBe(10);
    expect(range.to!.getDate()).toBe(20);
    expect(range.from!.getTime()).toBeLessThan(range.to!.getTime());
  });
});
