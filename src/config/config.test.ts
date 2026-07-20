import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let stateDir: string | null = null;

async function loadWithStateDir() {
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-config-test-"));
  vi.resetModules();
  vi.stubEnv("TORLINK_STATE_DIR", stateDir);
  const config = await import("./config");
  const paths = await import("./paths");
  return { config, paths };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (stateDir) await fs.rm(stateDir, { recursive: true, force: true });
  stateDir = null;
});

describe("loadConfig", () => {
  it("defaults tracker discovery on, torrent auto-resume on, and auto-stop seeding off", async () => {
    const { config } = await loadWithStateDir();
    expect(await config.loadConfig()).toMatchObject({
      enableTrackers: true,
      autoResumeTorrents: true,
      requireSurfsharkVpn: true,
      autoStopSeeding: false,
      disabledSources: [],
    });
  });

  it("preserves saved torrent safety preferences", async () => {
    const { config, paths } = await loadWithStateDir();
    await fs.mkdir(path.dirname(paths.configFile), { recursive: true });
    await fs.writeFile(
      paths.configFile,
      JSON.stringify({
        downloadDir: "/tmp/downloads",
        trackers: [],
        enableTrackers: false,
        autoResumeTorrents: false,
        requireSurfsharkVpn: false,
        autoStopSeeding: true,
        disabledSources: ["fitgirl", "tpb-movies"],
      }),
      "utf8",
    );
    expect(await config.loadConfig()).toMatchObject({
      enableTrackers: false,
      autoResumeTorrents: false,
      requireSurfsharkVpn: false,
      autoStopSeeding: true,
      disabledSources: ["fitgirl", "tpb-movies"],
    });
  });

  it("drops invalid source preferences and refuses to disable every source", async () => {
    const { config, paths } = await loadWithStateDir();
    await fs.mkdir(path.dirname(paths.configFile), { recursive: true });
    await fs.writeFile(
      paths.configFile,
      JSON.stringify({
        disabledSources: [
          "fitgirl",
          "fitgirl",
          "not-real",
          "yts",
          "eztv",
          "nyaa",
          "subsplease",
          "tpb-movies",
          "tpb-tv",
          "tpb-books",
          "tpb-audiobooks",
          "tpb-music",
          "x1337-movies",
          "x1337-tv",
          "x1337-books",
          "x1337-audiobooks",
          "x1337-music",
        ],
      }),
      "utf8",
    );
    expect(await config.loadConfig()).toMatchObject({
      disabledSources: [],
    });
  });
});
