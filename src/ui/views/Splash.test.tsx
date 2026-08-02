import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "ink-testing-library";
import { Splash } from "./Splash";
import { StoreContext, type Store } from "../store";

function makeStore(submitQuery: Store["submitQuery"]): Store {
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
    view: "splash",
    setView: noop,
    query: "",
    submitQuery,
    section: "all",
    setSection: noop,
    region: "content",
    setRegion: noop,
    captureMode: "text",
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
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

afterEach(() => cleanup());

describe("Splash", () => {
  it.each([
    ["tab", "\t"],
    ["down arrow", "\u001b[B"],
  ])("enters browse mode with %s", async (_label, input) => {
    const submitQuery = vi.fn();
    const { stdin } = render(
      <StoreContext.Provider value={makeStore(submitQuery)}>
        <Splash />
      </StoreContext.Provider>,
    );

    stdin.write(input);
    await tick();

    expect(submitQuery).toHaveBeenCalledWith("");
  });
});
