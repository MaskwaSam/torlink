import { describe, expect, it } from "vitest";
import { WEBTORRENT_OPTIONS } from "./engine";

describe("TorrentEngine WebTorrent options", () => {
  it("does not enable the vulnerable tracker discovery stack", () => {
    expect(WEBTORRENT_OPTIONS).toMatchObject({
      tracker: false,
      lsd: false,
      utPex: false,
      natUpnp: false,
      natPmp: false,
    });
  });
});
