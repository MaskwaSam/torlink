import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { vpnStatus } from "./vpn";

function addr(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    mac: "00:00:00:00:00:00",
    family: "IPv4",
    internal,
    cidr: `${address}/24`,
  };
}

describe("vpnStatus", () => {
  it("fails closed when Surfshark is disconnected on macOS", () => {
    const status = vpnStatus(
      { en0: [addr("192.168.1.20")] },
      {
        platform: "darwin",
        scutilList: () =>
          '* (Disconnected) ABC VPN (com.surfshark.vpnclient.macos.direct) "Surfshark. WireGuard"',
      },
    );
    expect(status.ok).toBe(false);
    expect(status.activeInterfaces).toEqual([]);
    expect(status.reason).toContain("Surfshark VPN required");
    expect(status.reason).toContain("disconnected");
  });

  it("detects a connected macOS Surfshark service", () => {
    const status = vpnStatus(
      { en0: [addr("192.168.1.20")] },
      {
        platform: "darwin",
        scutilList: () =>
          '* (Connected) ABC VPN (com.surfshark.vpnclient.macos.direct) "Surfshark. WireGuard"',
      },
    );
    expect(status.ok).toBe(true);
    expect(status.activeInterfaces).toEqual(["Surfshark. WireGuard"]);
  });

  it("does not allow a connected non-Surfshark tunnel to satisfy the macOS gate", () => {
    const status = vpnStatus(
      {
        utun4: [addr("100.65.101.31")],
      },
      {
        platform: "darwin",
        scutilList: () =>
          [
            '* (Disconnected) ABC VPN (com.surfshark.vpnclient.macos.direct) "Surfshark. WireGuard"',
            '* (Connected) DEF VPN (io.tailscale.ipn.macsys) "Tailscale"',
          ].join("\n"),
      },
    );
    expect(status.ok).toBe(false);
    expect(status.activeInterfaces).toEqual([]);
  });

  it("ignores internal or link-local Surfshark-looking interfaces", () => {
    const status = vpnStatus(
      {
        surfshark0: [addr("127.0.0.1", true), addr("169.254.2.10")],
      },
      { platform: "linux" },
    );
    expect(status.ok).toBe(false);
  });

  it("allows the recognized interface pattern to be set for non-macOS Surfshark adapters", () => {
    const status = vpnStatus(
      { utun4: [addr("10.8.0.2")], surfshark0: [addr("10.9.0.2")] },
      { platform: "linux", interfacePattern: /^surfshark/i },
    );
    expect(status.ok).toBe(true);
    expect(status.activeInterfaces).toEqual(["surfshark0"]);
  });
});
