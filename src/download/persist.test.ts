import path from "node:path";
import { describe, expect, it } from "vitest";
import { torrentMetaExists, torrentMetaPath } from "./persist";
import { torrentsDir } from "../config/paths";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";

describe("torrent metadata paths", () => {
  it("keeps cache files directly under the torrents directory", () => {
    expect(torrentMetaPath(HASH)).toBe(path.resolve(torrentsDir, `${HASH}.torrent`));
  });

  it("rejects path-like ids", () => {
    expect(() => torrentMetaPath("../../escape")).toThrow("invalid torrent metadata id");
    expect(torrentMetaExists("../../escape")).toBe(false);
  });
});
