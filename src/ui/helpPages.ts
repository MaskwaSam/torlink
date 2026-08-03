import type { HelpGroup, Hint } from "./keymap";

// At ordinary browser sizes the app uses five rows above Help (logo, rule,
// margin) and the compact card uses five non-command rows (border, header,
// gap, footer). Smaller layouts use less chrome, so this remains conservative.
export const HELP_NON_HINT_ROWS = 10;

export interface HelpPage {
  title: string;
  hints: Hint[];
  part: number;
  parts: number;
}

export function helpHintsPerPage(rows: number): number {
  return Math.max(1, Math.floor(rows) - HELP_NON_HINT_ROWS);
}

export function buildHelpPages(
  groups: readonly HelpGroup[],
  hintsPerPage: number,
): HelpPage[] {
  const size = Math.max(1, Math.floor(hintsPerPage));
  const pages: HelpPage[] = [];

  for (const group of groups) {
    const parts = Math.max(1, Math.ceil(group.hints.length / size));
    for (let index = 0; index < parts; index++) {
      pages.push({
        title: group.title,
        hints: group.hints.slice(index * size, (index + 1) * size),
        part: index + 1,
        parts,
      });
    }
  }

  return pages;
}
