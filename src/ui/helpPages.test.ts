import { describe, expect, it } from "vitest";
import { HELP_GROUPS } from "./keymap";
import { buildHelpPages, helpHintsPerPage } from "./helpPages";

describe("help pages", () => {
  it("keeps every command exactly once when groups must split", () => {
    const pages = buildHelpPages(HELP_GROUPS, 3);
    const expected = HELP_GROUPS.flatMap((group) =>
      group.hints.map((hint) => `${group.title}:${hint.keys}:${hint.label}`),
    );
    const actual = pages.flatMap((page) =>
      page.hints.map((hint) => `${page.title}:${hint.keys}:${hint.label}`),
    );

    expect(actual).toEqual(expected);
    expect(pages.every((page) => page.hints.length <= 3)).toBe(true);
  });

  it("fits the largest group on one page at 80 by 24", () => {
    const capacity = helpHintsPerPage(24);
    const pages = buildHelpPages(HELP_GROUPS, capacity);

    expect(capacity).toBeGreaterThanOrEqual(
      Math.max(...HELP_GROUPS.map((group) => group.hints.length)),
    );
    expect(pages).toHaveLength(HELP_GROUPS.length);
  });

  it("always leaves at least one command visible", () => {
    expect(helpHintsPerPage(1)).toBe(1);
  });
});
