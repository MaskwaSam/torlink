import { describe, expect, it } from "vitest";
import { filterResults } from "./filter";
import type { SourceId, TorrentResult } from "../sources/types";

function result(
  infoHash: string,
  name: string,
  seeders = 0,
  source: SourceId = "yts",
): TorrentResult {
  return {
    infoHash,
    name,
    sizeBytes: 0,
    seeders,
    leechers: 0,
    source,
    magnet: `magnet:?xt=urn:btih:${infoHash}`,
  };
}

describe("filterResults", () => {
  it("hides known dead swarms but preserves sources without health data", () => {
    const list = [
      result("dead", "Known dead", 0, "yts"),
      result("unknown", "Unknown health", 0, "fitgirl"),
      result("live", "Known live", 4, "yts"),
    ];

    expect(filterResults(list, true).map((item) => item.infoHash)).toEqual([
      "unknown",
      "live",
    ]);
  });

  it("matches every token case-insensitively and ranks the closest names first", () => {
    const list = [
      result("exact", "Ubuntu 24 desktop"),
      result("ordered", "Ubuntu desktop release 24"),
      result("scattered", "24 hour archive of Ubuntu builds"),
      result("miss", "Debian 12 desktop"),
    ];

    expect(filterResults(list, false, "ubuntu 24").map((item) => item.infoHash)).toEqual([
      "exact",
      "ordered",
      "scattered",
    ]);
  });

  it("does not mutate the input list", () => {
    const list = [result("a", "A"), result("b", "B", 2)];
    filterResults(list, true, "b");
    expect(list.map((item) => item.infoHash)).toEqual(["a", "b"]);
  });
});
