import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_FILES = [
  "src/sources/eztv.ts",
  "src/sources/nyaa.ts",
  "src/sources/piratebay.ts",
  "src/sources/rss.ts",
  "src/sources/subsplease.ts",
  "src/sources/x1337.ts",
  "src/sources/yts.ts",
];

describe("security invariants", () => {
  it("keeps third-party source body reads behind capped readers", () => {
    const offenders = SOURCE_FILES.filter((file) => {
      const source = readFileSync(path.resolve(file), "utf8");
      return /\.\s*(?:text|json)\s*\(/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
