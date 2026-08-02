import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "ink-testing-library";
import { Results } from "./Results";
import { StoreContext, type Store } from "../store";

const searchState = vi.hoisted(() => ({
  results: [
    {
      infoHash: "dead-yts",
      name: "Alpha Documentary",
      sizeBytes: 1_000,
      seeders: 0,
      leechers: 0,
      source: "yts" as const,
      magnet: "magnet:?xt=urn:btih:dead-yts",
    },
    {
      infoHash: "unknown-fitgirl",
      name: "Beta Collection",
      sizeBytes: 2_000,
      seeders: 0,
      leechers: 0,
      source: "fitgirl" as const,
      magnet: "magnet:?xt=urn:btih:unknown-fitgirl",
    },
    {
      infoHash: "live-yts",
      name: "Alpha Live Movie",
      sizeBytes: 3_000,
      seeders: 5,
      leechers: 1,
      source: "yts" as const,
      magnet: "magnet:?xt=urn:btih:live-yts",
    },
  ],
  perSource: {},
  loading: false,
  done: 13,
  total: 13,
}));

vi.mock("../hooks/useConcurrentSearch", () => ({
  useConcurrentSearch: () => searchState,
}));

function makeStore(overrides: Partial<Store> = {}): Store {
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
    queue: {} as Store["queue"],
    vpn: { ok: true, label: "Surfshark VPN", activeInterfaces: [], reason: "" },
    networkAllowed: true,
    view: "browser",
    setView: noop,
    query: "",
    submitQuery: noop,
    section: "all",
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
    listRows: 14,
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

describe("Results", () => {
  it("filters the current results with all typed tokens", async () => {
    const { stdin, lastFrame } = render(
      <StoreContext.Provider value={makeStore()}>
        <Results />
      </StoreContext.Provider>,
    );

    stdin.write("f");
    await tick();
    stdin.write("alpha live");
    await tick();

    expect(lastFrame()).toContain("Alpha Live Movie");
    expect(lastFrame()).not.toContain("Alpha Documentary");
    expect(lastFrame()).not.toContain("Beta Collection");
  });

  it("hides known dead swarms without hiding sources that omit health", async () => {
    const { stdin, lastFrame } = render(
      <StoreContext.Provider value={makeStore()}>
        <Results />
      </StoreContext.Provider>,
    );

    stdin.write("z");
    await tick();

    expect(lastFrame()).not.toContain("Alpha Documentary");
    expect(lastFrame()).toContain("Beta Collection");
    expect(lastFrame()).toContain("Alpha Live Movie");
  });

  it("keeps sort and details shortcuts available", async () => {
    const { stdin, lastFrame } = render(
      <StoreContext.Provider value={makeStore()}>
        <Results />
      </StoreContext.Provider>,
    );

    stdin.write("t");
    await tick();
    stdin.write("s");
    await tick();

    expect(lastFrame()).toContain("Torrent");
    expect(lastFrame()).toContain("Options");
  });

  it("moves to the sidebar when left exits an empty filter", async () => {
    const setRegion = vi.fn();
    const { stdin } = render(
      <StoreContext.Provider value={makeStore({ setRegion })}>
        <Results />
      </StoreContext.Provider>,
    );

    stdin.write("f");
    await tick();
    stdin.write("\u001b[D");
    await tick();

    expect(setRegion).toHaveBeenCalledWith("sidebar");
  });
});
