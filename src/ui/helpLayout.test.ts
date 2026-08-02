import { describe, expect, it } from "vitest";
import { HELP_GROUPS } from "./keymap";
import {
  COL_GAP,
  FRAME,
  FULL_HELP_CHROME_ROWS,
  MEASURED,
  fitColumnWidths,
  pickLayout,
} from "./helpLayout";

describe("help layout", () => {
  it("includes every help group exactly once in every packing", () => {
    const expected = HELP_GROUPS.map((_, index) => index);
    for (const measured of MEASURED) {
      expect(measured.layout.flat().sort((a, b) => a - b)).toEqual(expected);
    }
  });

  it("uses progressively narrower layouts and selects the widest one that fits", () => {
    for (let index = 1; index < MEASURED.length; index++) {
      expect(MEASURED[index - 1]!.width).toBeGreaterThan(MEASURED[index]!.width);
    }
    for (const measured of MEASURED) {
      expect(pickLayout(measured.width + 2)).toBe(measured);
    }
    expect(pickLayout(20)).toBe(MEASURED.at(-1));
  });

  it("uses a compact, height-safe packing at 80 by 24", () => {
    const measured = pickLayout(80, 15);
    const widths = fitColumnWidths(measured, 78);

    expect(measured.gridH).toBeLessThanOrEqual(15);
    expect(measured.minWidth).toBeLessThanOrEqual(78);
    expect(
      widths.reduce((sum, width) => sum + width, 0) +
        (widths.length - 1) * COL_GAP +
        FRAME,
    ).toBeLessThanOrEqual(78);
    expect(widths.every((width, index) => width >= measured.minColWidths[index]!)).toBe(true);
    expect(24).toBeLessThan(measured.gridH + FULL_HELP_CHROME_ROWS);
  });
});
