import { describe, expect, it } from "vitest";
import { footerHints, HELP_GROUPS } from "./keymap";

describe("search result keymap", () => {
  it("preserves details and sorting keys while adding result filters", () => {
    const search = HELP_GROUPS.find((group) => group.title === "Search");

    expect(search?.hints).toEqual(
      expect.arrayContaining([
        { keys: "s", label: "Details / options" },
        { keys: "t", label: "Sort results" },
        { keys: "f", label: "Filter current list" },
        { keys: "z", label: "Hide known dead" },
        { keys: "d", label: "Download" },
      ]),
    );

    const footer = footerHints("content", "all");
    expect(footer).toEqual(
      expect.arrayContaining([
        { keys: "s", label: "Details" },
        { keys: "t", label: "Sort" },
        { keys: "f", label: "Filter" },
      ]),
    );
  });

  it("advertises enter details for active downloads", () => {
    const downloads = HELP_GROUPS.find((group) => group.title === "Downloads");

    expect(downloads?.hints).toEqual(
      expect.arrayContaining([{ keys: "↵", label: "Details / redownload" }]),
    );

    expect(footerHints("content", "downloads", "downloading")).toEqual(
      expect.arrayContaining([{ keys: "↵", label: "Details" }]),
    );
    expect(footerHints("content", "downloads", "recent")).toEqual(
      expect.arrayContaining([{ keys: "d", label: "Download again" }]),
    );
    expect(footerHints("content", "downloads", "failed")).toEqual(
      expect.arrayContaining([{ keys: "r", label: "Verify" }]),
    );
  });

  it("documents global, paging, transfer, source, and text-field controls", () => {
    const keys = (title: string): string[] =>
      HELP_GROUPS.find((group) => group.title === title)?.hints.map((hint) => hint.keys) ?? [];

    expect(keys("Navigate")).toEqual(
      expect.arrayContaining([
        "↑↓←→ / hjkl",
        "wheel",
        "pgup / pgdn",
        "tab",
        "esc",
        "q, ^c",
        "?",
        "←→ / hl",
      ]),
    );
    expect(keys("Downloads")).toEqual(
      expect.arrayContaining(["↵", "p", "a", "e", "⌫, del, c", "f", "r", "d", "x", "O (shift+o)"]),
    );
    expect(keys("Seeding")).toEqual(
      expect.arrayContaining(["p", "r", "e", "c", "O (shift+o)"]),
    );
    expect(keys("Sources")).toEqual(expect.arrayContaining(["space, ↵", "r"]));
    expect(keys("Text fields")).toEqual(
      expect.arrayContaining([
        "← / →",
        "ctrl/⌥ + ←→",
        "home / end",
        "^a / ^e",
        "⌫ / del",
        "ctrl/⌥ + ⌫/del",
        "^w / ⌥d",
        "^u",
        "^k",
        "↵",
        "tab / ↓",
        "esc",
      ]),
    );
  });
});
