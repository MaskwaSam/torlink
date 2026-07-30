import { describe, it, expect } from "vitest";
import { DownloadQueue, strayDownload } from "./queue";
import type { HistoryItem } from "./history";
import type { QueueItem } from "./types";
import type { AddHandlers, TorrentBackend, TorrentProgress } from "./engine";

const HASH1 = "1111111111111111111111111111111111111111";
const HASH2 = "2222222222222222222222222222222222222222";
const HASH3 = "3333333333333333333333333333333333333333";
const HASH4 = "4444444444444444444444444444444444444444";

type QueueInternals = {
  complete: (it: QueueItem) => void;
  tick: () => Promise<void>;
};

class FakeBackend implements TorrentBackend {
  adds: string[] = [];
  pauses: string[] = [];
  resumes: string[] = [];
  removes: string[] = [];
  verifies: string[] = [];
  reconciles: { ids: string[]; dir: string }[] = [];
  statsById = new Map<string, TorrentProgress>();
  handlers = new Map<string, AddHandlers>();

  add(id: string, _source: string, _dir: string, handlers: AddHandlers): void {
    this.adds.push(id);
    this.handlers.set(id, handlers);
  }

  reconcile(ids: readonly string[], dir: string): void {
    this.reconciles.push({ ids: [...ids], dir });
  }

  pause(id: string): void {
    this.pauses.push(id);
  }

  resume(id: string): void {
    this.resumes.push(id);
  }

  remove(id: string): void {
    this.removes.push(id);
  }

  verify(id: string): void {
    this.verifies.push(id);
  }

  async stats(id: string): Promise<TorrentProgress | null> {
    return this.statsById.get(id) ?? null;
  }

  destroy(): void {}
}

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
    backend: "transmission",
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
    // No engine work, so this never starts Transmission and never throws even
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
      backend: "transmission",
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
      backend: "transmission",
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
      backend: "transmission",
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

describe("DownloadQueue Transmission backend", () => {
  it("adds, pauses, resumes, verifies, and deletes through the backend", () => {
    const backend = new FakeBackend();
    const q = new DownloadQueue(backend);
    q.add({ id: HASH1, name: "One", magnet: `magnet:?xt=urn:btih:${HASH1}` }, "/downloads");
    expect(q.getItems()[0]).toMatchObject({ id: HASH1, backend: "transmission", status: "downloading" });
    expect(backend.adds).toEqual([HASH1]);
    expect(backend.reconciles).toEqual([{ ids: [HASH1], dir: "/downloads" }]);

    q.pause(HASH1);
    expect(q.getItems()[0]?.status).toBe("paused");
    expect(backend.pauses).toEqual([HASH1]);

    q.resume(HASH1);
    expect(q.getItems()[0]?.status).toBe("downloading");
    expect(backend.adds).toEqual([HASH1, HASH1]);

    q.verify(HASH1);
    expect(backend.verifies).toEqual([HASH1]);

    q.cancel(HASH1);
    expect(q.getItems()).toEqual([]);
    expect(backend.removes).toEqual([HASH1]);
    q.suspend();
  });

  it("reconciles the backend against restored visible queue and seed records", () => {
    const backend = new FakeBackend();
    const q = new DownloadQueue(backend);
    q.restore([
      item({
        id: HASH2,
        status: "downloading",
        magnet: `magnet:?xt=urn:btih:${HASH2}`,
        dir: "/downloads",
      }),
    ]);
    q.restoreHistory([h({ id: HASH3, magnet: `magnet:?xt=urn:btih:${HASH3}` })]);
    q.restoreSeeds([{ id: HASH3, status: "paused" }]);

    q.reconcileBackend("/downloads");

    expect(backend.reconciles.at(-1)).toEqual({ ids: [HASH2, HASH3], dir: "/downloads" });
    q.suspend();
  });

  it("moves a completed Transmission download to history and seeding on the poll tick", async () => {
    const backend = new FakeBackend();
    const q = new DownloadQueue(backend);
    q.add({ id: HASH2, name: "Two", magnet: `magnet:?xt=urn:btih:${HASH2}` }, "/downloads");
    backend.statsById.set(HASH2, {
      progress: 1,
      downloaded: 100,
      total: 100,
      speed: 0,
      uploadSpeed: 5,
      uploaded: 10,
      peers: 2,
      timeRemaining: 0,
      name: "Two",
    });

    await (q as unknown as QueueInternals).tick();
    expect(q.getItems()).toEqual([]);
    expect(q.getHistory()[0]).toMatchObject({ id: HASH2, name: "Two", sizeBytes: 100 });
    expect(q.getSeed(HASH2)?.status).toBe("seeding");
    q.suspend();
  });

  it("stops active torrents while the Surfshark gate is closed and resumes only when allowed", () => {
    const backend = new FakeBackend();
    const q = new DownloadQueue(backend);
    q.add({ id: HASH3, name: "Three", magnet: `magnet:?xt=urn:btih:${HASH3}` }, "/downloads");

    q.setNetworkAllowed(false);
    expect(q.getItems()[0]).toMatchObject({ status: "paused", pauseReason: "network" });
    expect(backend.pauses).toEqual([HASH3]);

    q.setNetworkAllowed(true);
    expect(q.getItems()[0]).toMatchObject({ status: "downloading", pauseReason: undefined });
    expect(backend.adds).toEqual([HASH3, HASH3]);
    q.suspend();
  });

  it("restores legacy WebTorrent queue entries as paused without auto-starting them", () => {
    const backend = new FakeBackend();
    const q = new DownloadQueue(backend);
    q.restore([
      {
        ...item({ id: HASH4, status: "downloading", speed: 100, peers: 4 }),
        backend: undefined,
      },
    ]);

    expect(q.getItems()[0]).toMatchObject({
      id: HASH4,
      status: "paused",
      pauseReason: undefined,
      speed: 0,
      peers: 0,
    });
    expect(backend.adds).toEqual([]);
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
