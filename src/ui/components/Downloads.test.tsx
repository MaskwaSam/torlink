import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "ink-testing-library";
import { EventEmitter } from "node:events";
import { Downloads } from "./Downloads";
import { StoreContext, type Store } from "../store";
import type { QueueItem } from "../../download/types";
import type { HistoryItem } from "../../download/history";

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "active-id",
    name: "Active torrent",
    magnet: "magnet:?xt=urn:btih:active",
    dir: "/downloads",
    status: "downloading",
    progress: 12,
    totalBytes: 1000,
    downloadedBytes: 120,
    speed: 20,
    peers: 1,
    addedAt: Date.now(),
    ...overrides,
  };
}

function history(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: "history-id",
    name: "Recent torrent",
    magnet: "magnet:?xt=urn:btih:history",
    dir: "/downloads",
    sizeBytes: 1000,
    completedAt: Date.now(),
    ...overrides,
  };
}

function makeQueue(active: QueueItem[], recent: HistoryItem[]) {
  const events = new EventEmitter();
  return {
    getItems: () => active,
    getHistory: () => recent,
    on: events.on.bind(events),
    off: events.off.bind(events),
    cancel: vi.fn(),
    removeHistory: vi.fn(),
    retryFailed: vi.fn(),
    retry: vi.fn(),
    clearHistory: vi.fn(),
    togglePause: vi.fn(),
    verify: vi.fn(),
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
    vpn: {
      ok: true,
      label: "Surfshark VPN",
      activeInterfaces: [],
      reason: "",
    },
    networkAllowed: true,
    view: "browser",
    setView: noop,
    query: "",
    submitQuery: noop,
    section: "downloads",
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

describe("Downloads", () => {
  it("opens active download details with enter", async () => {
    const queue = makeQueue([item({ files: 3 })], []);
    const setCaptureMode = vi.fn();
    const { stdin, lastFrame } = render(
      <StoreContext.Provider value={makeStore(queue, { setCaptureMode })}>
        <Downloads />
      </StoreContext.Provider>,
    );

    stdin.write("\r");
    await tick();

    expect(lastFrame()).toContain("Status");
    expect(lastFrame()).toContain("Progress");
    expect(lastFrame()).toContain("Folder");
    expect(lastFrame()).toContain("Magnet");
    expect(lastFrame()).toContain("Options");
    expect(queue.cancel).not.toHaveBeenCalled();
    expect(setCaptureMode).toHaveBeenCalledWith("esc");
  });

  it("keeps enter as download-again for recent torrents", async () => {
    const queue = makeQueue([], [history()]);
    const startDownload = vi.fn();
    const { stdin } = render(
      <StoreContext.Provider value={makeStore(queue, { startDownload })}>
        <Downloads />
      </StoreContext.Provider>,
    );

    stdin.write("\r");
    await tick();

    expect(startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "history-id",
        name: "Recent torrent",
        magnet: "magnet:?xt=urn:btih:history",
        sizeBytes: 1000,
      }),
    );
  });

  it("keeps detail actions wired to the highlighted active torrent", async () => {
    const queue = makeQueue([item()], []);
    const { stdin } = render(
      <StoreContext.Provider value={makeStore(queue)}>
        <Downloads />
      </StoreContext.Provider>,
    );

    stdin.write("\r");
    await tick();
    stdin.write("p");
    await tick();
    stdin.write("r");
    await tick();

    expect(queue.togglePause).toHaveBeenCalledWith("active-id");
    expect(queue.verify).toHaveBeenCalledWith("active-id");
  });

  it("deletes the highlighted active torrent with backspace", async () => {
    const queue = makeQueue([item()], []);
    const { stdin } = render(
      <StoreContext.Provider value={makeStore(queue)}>
        <Downloads />
      </StoreContext.Provider>,
    );

    stdin.write("\x7f");
    await tick();

    expect(queue.cancel).toHaveBeenCalledWith("active-id");
  });

  it("deletes the highlighted recent torrent with delete", async () => {
    const queue = makeQueue([], [history()]);
    const { stdin } = render(
      <StoreContext.Provider value={makeStore(queue)}>
        <Downloads />
      </StoreContext.Provider>,
    );

    stdin.write("\u001b[3~");
    await tick();

    expect(queue.removeHistory).toHaveBeenCalledWith("history-id");
  });
});
