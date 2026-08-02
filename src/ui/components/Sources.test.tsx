import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "ink-testing-library";
import { Sources } from "./Sources";
import { StoreContext, type Store } from "../store";
import { ACTIVE_SOURCE_IDS } from "../../sources/registry";

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
    section: "sources",
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

describe("Sources", () => {
  it("toggles the focused source off with space", async () => {
    const setConfig = vi.fn();
    const { stdin } = render(
      <StoreContext.Provider value={makeStore({ setConfig })}>
        <Sources />
      </StoreContext.Provider>,
    );

    stdin.write(" ");
    await tick();

    expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ disabledSources: ["fitgirl"] }),
    );
  });

  it("keeps at least one source enabled", async () => {
    const setConfig = vi.fn();
    const setNotice = vi.fn();
    const { stdin } = render(
      <StoreContext.Provider
        value={makeStore({
          setConfig,
          setNotice,
          config: {
            ...makeStore().config,
            disabledSources: ACTIVE_SOURCE_IDS.filter((id) => id !== "fitgirl"),
          },
        })}
      >
        <Sources />
      </StoreContext.Provider>,
    );

    stdin.write(" ");
    await tick();

    expect(setConfig).not.toHaveBeenCalled();
    expect(setNotice).toHaveBeenCalledWith("Keep at least one source enabled.");
  });
});
