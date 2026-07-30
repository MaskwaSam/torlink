import { describe, expect, it } from "vitest";
import { footerHints, HELP_GROUPS } from "./keymap";

describe("search result keymap", () => {
  it("uses s for torrent details/options and t for sorting", () => {
    const search = HELP_GROUPS.find((group) => group.title === "Search");

    expect(search?.hints).toEqual(
      expect.arrayContaining([
        { keys: "s, ↵", label: "Torrent details/options" },
        { keys: "t", label: "Sort results" },
      ]),
    );

    const footer = footerHints("content", "all");
    expect(footer).toEqual(
      expect.arrayContaining([
        { keys: "s", label: "Details" },
        { keys: "t", label: "Sort" },
      ]),
    );
  });

  it("advertises enter details for active downloads", () => {
    const downloads = HELP_GROUPS.find((group) => group.title === "Downloads");

    expect(downloads?.hints).toEqual(
      expect.arrayContaining([{ keys: "↵", label: "Download details" }]),
    );

    expect(footerHints("content", "downloads", "downloading")).toEqual(
      expect.arrayContaining([{ keys: "↵", label: "Details" }]),
    );
    expect(footerHints("content", "downloads", "recent")).toEqual(
      expect.arrayContaining([{ keys: "d", label: "Download again" }]),
    );
  });
});
