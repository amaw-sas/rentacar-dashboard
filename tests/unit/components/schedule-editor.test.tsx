import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ScheduleEditor } from "@/components/forms/schedule-editor";
import { type LocationSchedule } from "@/lib/schemas/location";

function optionValues(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map((o) => (o as HTMLOptionElement).value);
}

describe("ScheduleEditor", () => {
  it("SCEN-001: time selectors only offer the :00/:30 grid (no :15)", () => {
    const value: LocationSchedule = { mon: ["08:00-18:00"] };
    render(<ScheduleEditor value={value} onChange={vi.fn()} />);

    const start = screen.getByLabelText("Inicio Lunes");
    const end = screen.getByLabelText("Fin Lunes");
    const startOpts = optionValues(start);
    const endOpts = optionValues(end);

    expect(startOpts).toContain("08:00");
    expect(startOpts).toContain("08:30");
    expect(startOpts).not.toContain("08:15");
    expect(startOpts[0]).toBe("00:00");
    expect(startOpts[startOpts.length - 1]).toBe("23:30");
    expect(endOpts[0]).toBe("00:30");
    expect(endOpts[endOpts.length - 1]).toBe("24:00");
    expect(endOpts).not.toContain("08:15");
  });

  it("SCEN-002: choosing 'Cerrado' omits the day key", () => {
    const onChange = vi.fn();
    render(<ScheduleEditor value={{ mon: ["08:00-18:00"] }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Modo Lunes"), {
      target: { value: "closed" },
    });

    const last = onChange.mock.calls.at(-1)![0] as LocationSchedule;
    expect(last).not.toHaveProperty("mon");
  });

  it("SCEN-003: choosing '24 h' persists the sentinel range", () => {
    const onChange = vi.fn();
    render(<ScheduleEditor value={{}} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Modo Lunes"), {
      target: { value: "24h" },
    });

    const last = onChange.mock.calls.at(-1)![0] as LocationSchedule;
    expect(last.mon).toEqual(["00:00-24:00"]);
  });

  it("SCEN-004a (editor): an inverted range shows an inline error", () => {
    render(<ScheduleEditor value={{ mon: ["08:00-18:00"] }} onChange={vi.fn()} />);

    // start == end is invalid (must be strictly before).
    fireEvent.change(screen.getByLabelText("Inicio Lunes"), {
      target: { value: "18:00" },
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent).toMatch(/Lunes/i);
  });

  it("SCEN-005: editing a migrated branch preloads modes and ranges", () => {
    const value: LocationSchedule = {
      mon: ["08:00-18:00"],
      sat: ["08:00-13:00"],
      // sun absent (closed), hol absent (closed)
    };
    render(<ScheduleEditor value={value} onChange={vi.fn()} />);

    expect((screen.getByLabelText("Modo Lunes") as HTMLSelectElement).value).toBe("range");
    expect((screen.getByLabelText("Inicio Lunes") as HTMLSelectElement).value).toBe("08:00");
    expect((screen.getByLabelText("Fin Lunes") as HTMLSelectElement).value).toBe("18:00");

    expect((screen.getByLabelText("Modo Sábado") as HTMLSelectElement).value).toBe("range");
    expect((screen.getByLabelText("Fin Sábado") as HTMLSelectElement).value).toBe("13:00");

    expect((screen.getByLabelText("Modo Domingo") as HTMLSelectElement).value).toBe("closed");
    expect((screen.getByLabelText("Modo Festivos") as HTMLSelectElement).value).toBe("closed");
  });

  it("preloads a 24 h day into the 24h mode", () => {
    render(<ScheduleEditor value={{ mon: ["00:00-24:00"] }} onChange={vi.fn()} />);
    expect((screen.getByLabelText("Modo Lunes") as HTMLSelectElement).value).toBe("24h");
  });
});
