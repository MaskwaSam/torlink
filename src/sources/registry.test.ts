import { describe, expect, it } from "vitest";
import { activeSources, SOURCES, sourceDisplayName, sourcesByGroup } from "./registry";

describe("source registry", () => {
  it("exposes book and audiobook categories with real sources", () => {
    const groups = sourcesByGroup();
    expect(groups.find((g) => g.group === "Books")?.sources.map((s) => s.id)).toEqual([
      "tpb-books",
      "x1337-books",
    ]);
    expect(groups.find((g) => g.group === "Audiobooks")?.sources.map((s) => s.id)).toEqual([
      "tpb-audiobooks",
      "x1337-audiobooks",
    ]);
    expect(groups.find((g) => g.group === "Music")?.sources.map((s) => s.id)).toEqual([
      "tpb-music",
      "x1337-music",
    ]);
  });

  it("keeps every source id unique", () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
  });

  it("hides anime-only sources from the active registry", () => {
    expect(sourcesByGroup().map((g) => g.group)).not.toContain("Anime");
    expect(SOURCES.map((s) => s.id)).not.toContain("nyaa");
    expect(SOURCES.map((s) => s.id)).not.toContain("subsplease");
  });

  it("filters disabled sources without mutating the registry", () => {
    expect(activeSources(["fitgirl", "x1337-books"]).map((s) => s.id)).not.toContain("fitgirl");
    expect(SOURCES.map((s) => s.id)).toContain("fitgirl");
  });

  it("uses category suffixes for repeated provider labels", () => {
    expect(sourceDisplayName(SOURCES.find((s) => s.id === "tpb-movies")!)).toBe("TPB Movies");
    expect(sourceDisplayName(SOURCES.find((s) => s.id === "x1337-books")!)).toBe("1337x Books");
    expect(sourceDisplayName(SOURCES.find((s) => s.id === "tpb-music")!)).toBe("TPB Music");
    expect(sourceDisplayName(SOURCES.find((s) => s.id === "fitgirl")!)).toBe("FitGirl");
  });
});
