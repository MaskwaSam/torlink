import { describe, it, expect } from "vitest";
import { DownloadQueue, strayDownload } from "./queue";
import type { HistoryItem } from "./history";
import type { QueueItem } from "./types";

const HASH1 = "1111111111111111111111111111111111111111";
const HASH2 = "2222222222222222222222222222222222222222";
const HASH3 = "3333333333333333333333333333333333333333";
const HASH4 = "4444444444444444444444444444444444444444";

type QueueInternals = {
  complete: (it: QueueItem) => void;
};

function h(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: HASH1,
    name: "Some Download",
    magnet: `magnet:?xt=urn:btih:${HASH1}`,
    dir: "/downloads",
    sizeBytes: 100,
    completedAt: 1,
    ...over,
  };
}

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: HASH1,
    name: "Some Download",
    magnet: `magnet:?xt=urn:btih:${HASH1}`,
    dir: "/downloads",
    status: "paused",
    progress: 100,
    totalBytes: 100,
    downloadedBytes: 100,
    speed: 0,
    peers: 0,
    addedAt: 1,
    ...over,
  };
}

describe("DownloadQueue seeding", () => {
  it("refuses to seed an entry with no magnet (the only synchronous guard)", () => {
    const q = new DownloadQueue();
    q.startSeeding(h({ id: HASH2, magnet: "" }));
    expect(q.getSeed(HASH2)?.status).toBe("missing");
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });

  it("refuses path-like ids before they can reach the metadata cache", () => {
    const q = new DownloadQueue();
    q.startSeeding(h({ id: "../../escape" }));
    expect(q.getSeeds()).toEqual([]);
    q.add({ id: "../../escape", name: "bad", magnet: "magnet:?xt=urn:btih:bad" }, "/downloads");
    expect(q.getItems()).toEqual([]);
    q.suspend();
  });

  it("persistSync flushes every state file without touching the engine", () => {
    const q = new DownloadQueue();
    q.restoreHistory([h({ id: HASH3 })]);
    // No engine work, so this never spins up webtorrent and never throws even
    // with a populated history.
    expect(() => q.persistSync()).not.toThrow();
  });

  it("restores a paused seed as paused and does not auto-start it", () => {
    const q = new DownloadQueue();
    q.restoreHistory([h({ id: HASH4 })]);
    // A deliberately paused seed must come back paused (visible), not seeding,
    // and without spinning up the engine.
    q.restoreSeeds([{ id: HASH4, status: "paused" }]);
    expect(q.getSeed(HASH4)?.status).toBe("paused");
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });

  it("keeps seeding completed downloads by default", () => {
    const q = new DownloadQueue();
    const done = item();
    q.restore([done]);
    (q as unknown as QueueInternals).complete(done);
    expect(q.getItems()).toEqual([]);
    expect(q.getHistory()[0]).toMatchObject({ id: HASH1, name: "Some Download" });
    expect(q.getSeed(HASH1)?.status).toBe("seeding");
    expect(q.seedingCount).toBe(1);
    q.suspend();
  });

  it("does not seed newly completed downloads when auto-stop seeding is enabled", () => {
    const q = new DownloadQueue();
    const done = item({ id: HASH2, magnet: `magnet:?xt=urn:btih:${HASH2}` });
    q.setAutoStopSeeding(true);
    q.restore([done]);
    (q as unknown as QueueInternals).complete(done);
    expect(q.getItems()).toEqual([]);
    expect(q.getHistory()[0]).toMatchObject({ id: HASH2, name: "Some Download" });
    expect(q.getSeed(HASH2)).toBeUndefined();
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });

  it("pauses currently active seeds when auto-stop seeding is enabled", () => {
    const q = new DownloadQueue();
    const done = item({ id: HASH3, magnet: `magnet:?xt=urn:btih:${HASH3}` });
    q.restore([done]);
    (q as unknown as QueueInternals).complete(done);
    expect(q.getSeed(HASH3)?.status).toBe("seeding");
    q.setAutoStopSeeding(true);
    expect(q.getSeed(HASH3)?.status).toBe("paused");
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });
});

describe("DownloadQueue network gate", () => {
  it("adds new downloads as paused while network activity is blocked", () => {
    const q = new DownloadQueue();
    q.setNetworkAllowed(false);
    q.add(
      { id: HASH1, name: "Blocked", magnet: `magnet:?xt=urn:btih:${HASH1}` },
      "/downloads",
    );
    expect(q.getItems()[0]?.status).toBe("paused");
    expect(q.activeCount).toBe(0);
    q.suspend();
  });

  it("does not auto-start restored downloads while network activity is blocked", () => {
    const q = new DownloadQueue();
    const item: QueueItem = {
      id: HASH2,
      name: "Restored",
      magnet: `magnet:?xt=urn:btih:${HASH2}`,
      dir: "/downloads",
      status: "downloading",
      progress: 20,
      totalBytes: 1000,
      downloadedBytes: 200,
      speed: 123,
      peers: 4,
      addedAt: 1,
    };
    q.setNetworkAllowed(false);
    q.restore([item]);
    expect(q.getItems()[0]?.status).toBe("paused");
    expect(q.getItems()[0]?.speed).toBe(0);
    expect(q.activeCount).toBe(0);
    q.suspend();
  });

  it("keeps restored downloads paused when auto-resume is disabled", () => {
    const q = new DownloadQueue();
    const item: QueueItem = {
      id: HASH2,
      name: "Restored",
      magnet: `magnet:?xt=urn:btih:${HASH2}`,
      dir: "/downloads",
      status: "downloading",
      progress: 20,
      totalBytes: 1000,
      downloadedBytes: 200,
      speed: 123,
      peers: 4,
      addedAt: 1,
    };
    q.setAutoResumeTorrents(false);
    q.restore([item]);
    expect(q.getItems()[0]?.status).toBe("paused");
    expect(q.getItems()[0]?.pauseReason).toBeUndefined();
    expect(q.activeCount).toBe(0);
    q.suspend();
  });

  it("does not resume network-paused downloads when auto-resume is disabled", () => {
    const q = new DownloadQueue();
    const item: QueueItem = {
      id: HASH2,
      name: "Restored",
      magnet: `magnet:?xt=urn:btih:${HASH2}`,
      dir: "/downloads",
      status: "downloading",
      progress: 20,
      totalBytes: 1000,
      downloadedBytes: 200,
      speed: 123,
      peers: 4,
      addedAt: 1,
    };
    q.setAutoResumeTorrents(false);
    q.setNetworkAllowed(false);
    q.restore([item]);
    q.setNetworkAllowed(true);
    expect(q.getItems()[0]?.status).toBe("paused");
    expect(q.getItems()[0]?.pauseReason).toBe("network");
    expect(q.activeCount).toBe(0);
    q.suspend();
  });

  it("restores would-be seeders as paused while network activity is blocked", () => {
    const q = new DownloadQueue();
    q.restoreHistory([h({ id: HASH3 })]);
    q.setNetworkAllowed(false);
    q.restoreSeeds([{ id: HASH3, status: "seeding" }]);
    expect(q.getSeed(HASH3)?.status).toBe("paused");
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });

  it("keeps restored seeders paused when auto-resume is disabled", () => {
    const q = new DownloadQueue();
    q.restoreHistory([h({ id: HASH3 })]);
    q.setAutoResumeTorrents(false);
    q.restoreSeeds([{ id: HASH3, status: "seeding" }]);
    expect(q.getSeed(HASH3)?.status).toBe("paused");
    expect(q.getSeed(HASH3)?.pauseReason).toBeUndefined();
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });
});

describe("strayDownload (missing-file safety-net)", () => {
  it("ignores a present file being verified (disk read, no network speed)", () => {
    // Large file mid-verify: progress < 1 but network speed is 0.
    expect(strayDownload({ total: 50e9, progress: 0.4, speed: 0 })).toBe(false);
  });

  it("ignores a complete, healthy seed", () => {
    expect(strayDownload({ total: 8e9, progress: 1, speed: 0 })).toBe(false);
  });

  it("flags a seed that is actually pulling missing data off the network", () => {
    expect(strayDownload({ total: 8e9, progress: 0.2, speed: 2e6 })).toBe(true);
  });

  it("ignores a seed before metadata has arrived (total unknown)", () => {
    expect(strayDownload({ total: 0, progress: 0, speed: 0 })).toBe(false);
  });
});
