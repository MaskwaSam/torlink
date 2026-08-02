import React from "react";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "ink-testing-library";
import { Seeding } from "./Seeding";
import { StoreContext, type Store } from "../store";
import type { HistoryItem } from "../../download/history";
import type { SeedItem } from "../../download/types";

function makeHistory(): HistoryItem {
  return {
    id: "history-id",
    name: "Finished torrent",
    magnet: "magnet:?xt=urn:btih:history",
    dir: "/finished-folder",
    sizeBytes: 1_000,
    completedAt: Date.now(),
  };
}

function makeQueue(history: HistoryItem[], seeds: SeedItem[] = []) {
  const events = new EventEmitter();
  const byId = new Map(seeds.map((seed) => [seed.id, seed]));
  return {
    getHistory: () => history,
    getSeeds: () => seeds,
    getSeed: (id: string) => byId.get(id),
    on: events.on.bind(events),
    off: events.off.bind(events),
    toggleSeeding: vi.fn(),
    removeHistory: vi.fn(),
    verify: vi.fn(),
    seedingCount: seeds.filter((seed) => seed.status === "seeding").length,
  };
}

function makeStore(queue: ReturnType<typeof makeQueue>, overrides: Partial<Store> = {}): Store {
  const noop = (): void => {};
  return {
    config: {
      downloadDir: "/downloads",
      trackers: [],
      enableTrackers: true,
      autoResumeTorrents: true,
      requireSurfsharkVpn: true,
      autoStopSeeding: false,
      disabledSources: [],
    },
    setConfig: noop,
    queue: queue as unknown as Store["queue"],
    vpn: { ok: true, label: "Surfshark VPN", activeInterfaces: [], reason: "" },
    networkAllowed: true,
    view: "browser",
    setView: noop,
    query: "",
    submitQuery: noop,
    section: "seeding",
    setSection: noop,
    region: "content",
    setRegion: noop,
    captureMode: "none",
    setCaptureMode: noop,
    downloadFocus: null,
    setDownloadFocus: noop,
    seedFocus: null,
    setSeedFocus: noop,
    startDownload: noop,
    copyMagnet: noop,
    openDownloadFolder: noop,
    notice: null,
    setNotice: noop,
    quitAll: noop,
    listRows: 10,
    compact: false,
    contentWidth: 80,
    cols: 100,
    rows: 24,
    ...overrides,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

afterEach(() => cleanup());

describe("Seeding", () => {
  it("opens the highlighted completed download folder with uppercase O", async () => {
    const queue = makeQueue([makeHistory()]);
    const openDownloadFolder = vi.fn();
    const { stdin } = render(
      <StoreContext.Provider value={makeStore(queue, { openDownloadFolder })}>
        <Seeding />
      </StoreContext.Provider>,
    );

    stdin.write("O");
    await tick();

    expect(openDownloadFolder).toHaveBeenCalledWith("/finished-folder");
  });
});
