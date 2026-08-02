import { HELP_GROUPS } from "./keymap";

export const KEY_GAP = 2;
export const COL_GAP = 2;
export const FRAME = 4;
// Five rows of app header/rule/margin plus nine non-grid rows in the full card.
export const FULL_HELP_CHROME_ROWS = 14;

export const KEY_W = HELP_GROUPS.map(
  (group) => Math.max(...group.hints.map((hint) => hint.keys.length)) + KEY_GAP,
);
const COL_W = HELP_GROUPS.map(
  (group, index) =>
    KEY_W[index]! + Math.max(...group.hints.map((hint) => hint.label.length)),
);
const ROWS_PER_GROUP = HELP_GROUPS.map((group) => group.hints.length + 1);

// Group-index packings, widest/shortest first. These retain all five local
// groups while giving ordinary 80-column terminals a compact multi-column card.
const LAYOUTS: number[][][] = [
  [[0], [1], [2], [3], [4]],
  [[0], [1], [2], [3, 4]],
  [[0], [1, 4], [2, 3]],
  [[0, 1], [2, 3, 4]],
  [[0, 1, 2, 3, 4]],
];

export const MEASURED = LAYOUTS.map((layout) => {
  const colWidths = layout.map((column) =>
    Math.max(...column.map((groupIndex) => COL_W[groupIndex]!)),
  );
  const minColWidths = layout.map((column) =>
    Math.max(...column.map((groupIndex) => KEY_W[groupIndex]!)),
  );
  const width =
    colWidths.reduce((sum, value) => sum + value, 0) +
    (layout.length - 1) * COL_GAP +
    FRAME;
  const minWidth =
    minColWidths.reduce((sum, value) => sum + value, 0) +
    (layout.length - 1) * COL_GAP +
    FRAME;
  const gridH = Math.max(
    ...layout.map(
      (column) =>
        column.reduce((sum, groupIndex) => sum + ROWS_PER_GROUP[groupIndex]!, 0) +
        column.length -
        1,
    ),
  );
  return { layout, colWidths, minColWidths, width, minWidth, gridH };
});

export type MeasuredHelpLayout = (typeof MEASURED)[number];

export function pickLayout(cols: number, maxGridH = Number.POSITIVE_INFINITY) {
  const available = Math.max(1, cols - 2);
  const full = MEASURED.find(
    (measured) => measured.gridH <= maxGridH && measured.width <= available,
  );
  if (full) return full;

  // If full labels cannot fit in both dimensions, keep every key visible and
  // truncate labels. Prefer the narrowest packing at the shortest valid height.
  const compact = MEASURED
    .filter(
      (measured) => measured.gridH <= maxGridH && measured.minWidth <= available,
    )
    .sort((a, b) => a.width - b.width)[0];
  if (compact) return compact;

  // Very small terminals may make both constraints impossible. Minimize the
  // vertical overflow among layouts whose keys still fit before stacking all
  // groups into a much taller single column.
  return (
    MEASURED
      .filter((measured) => measured.minWidth <= available)
      .sort(
        (a, b) =>
          Math.max(0, a.gridH - maxGridH) - Math.max(0, b.gridH - maxGridH) ||
          a.width - b.width,
      )[0] ?? MEASURED.at(-1)!
  );
}

export function fitColumnWidths(
  measured: MeasuredHelpLayout,
  outerWidth: number,
): number[] {
  const count = measured.layout.length;
  const available = Math.max(
    count,
    outerWidth - FRAME - (count - 1) * COL_GAP,
  );
  const widths = Array<number>(count).fill(1);
  let remaining = available - count;

  const growToward = (targets: readonly number[]): void => {
    while (remaining > 0) {
      let grew = false;
      for (let index = 0; index < count && remaining > 0; index++) {
        if (widths[index]! >= targets[index]!) continue;
        widths[index]! += 1;
        remaining -= 1;
        grew = true;
      }
      if (!grew) break;
    }
  };

  growToward(measured.minColWidths);
  growToward(measured.colWidths);
  return widths;
}
