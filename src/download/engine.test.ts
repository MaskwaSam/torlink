import { describe, expect, it } from "vitest";
import { webTorrentOptions } from "./engine";

describe("TorrentEngine WebTorrent options", () => {
  it("keeps LAN/NAT discovery disabled while allowing tracker mode to be configured", () => {
    expect(webTorrentOptions(true)).toMatchObject({
      tracker: true,
      lsd: false,
      utPex: false,
      natUpnp: false,
      natPmp: false,
    });
    expect(webTorrentOptions(false)).toMatchObject({
      tracker: false,
      lsd: false,
      utPex: false,
      natUpnp: false,
      natPmp: false,
    });
  });
});
