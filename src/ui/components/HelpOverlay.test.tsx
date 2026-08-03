import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "ink-testing-library";
import { HelpOverlay } from "./HelpOverlay";
import { HELP_GROUPS } from "../keymap";
import { StoreContext, type Store } from "../store";

function makeStore(): Store {
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
    region: "help",
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
    cols: 80,
    rows: 24,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

afterEach(() => cleanup());

describe("HelpOverlay", () => {
  it("shows every complete command page at 80 by 24", async () => {
    const { stdin, lastFrame } = render(
      <StoreContext.Provider value={makeStore()}>
        <HelpOverlay />
      </StoreContext.Provider>,
    );

    for (let index = 0; index < HELP_GROUPS.length; index++) {
      const group = HELP_GROUPS[index]!;
      const frame = lastFrame() ?? "";
      expect(frame).toContain(group.title);
      for (const hint of group.hints) {
        expect(frame).toContain(hint.keys);
        expect(frame).toContain(hint.label);
      }
      expect(Math.max(...frame.split("\n").map((line) => [...line].length))).toBeLessThanOrEqual(80);

      if (index < HELP_GROUPS.length - 1) {
        stdin.write("\u001b[C");
        await tick();
      }
    }
  }, 15_000);

  it("wraps from the last page back to the first", async () => {
    const { stdin, lastFrame } = render(
      <StoreContext.Provider value={makeStore()}>
        <HelpOverlay />
      </StoreContext.Provider>,
    );

    stdin.write("\u001b[D");
    await tick();
    expect(lastFrame()).toContain("Text fields");

    stdin.write("\u001b[C");
    await tick();
    expect(lastFrame()).toContain("Navigate");
  }, 15_000);
});
