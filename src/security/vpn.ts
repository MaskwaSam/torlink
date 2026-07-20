import { execFileSync } from "node:child_process";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export const VPN_LABEL = "Surfshark VPN";
export const VPN_POLL_MS = 2000;

export const DEFAULT_SURFSHARK_INTERFACE_PATTERN = "surfshark";
const SURFSHARK_SERVICE_RE = /com\.surfshark\.vpnclient\.macos\.direct|Surfshark/i;

export interface VpnStatus {
  ok: boolean;
  label: string;
  activeInterfaces: string[];
  reason: string;
}

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface VpnStatusOptions {
  platform?: NodeJS.Platform;
  interfacePattern?: RegExp;
  scutilList?: () => string | null;
}

function surfsharkPattern(): RegExp {
  const raw =
    process.env.TORLINK_SURFSHARK_INTERFACE_RE?.trim() || DEFAULT_SURFSHARK_INTERFACE_PATTERN;
  try {
    return new RegExp(raw, "i");
  } catch {
    return new RegExp(DEFAULT_SURFSHARK_INTERFACE_PATTERN, "i");
  }
}

function usableAddress(addr: NetworkInterfaceInfo): boolean {
  if (addr.internal) return false;
  if (addr.family !== "IPv4" && addr.family !== "IPv6") return false;
  if (addr.address.startsWith("169.254.")) return false;
  if (/^fe80:/i.test(addr.address)) return false;
  return true;
}

function readScutilList(): string | null {
  try {
    return execFileSync("scutil", ["--nc", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    });
  } catch {
    return null;
  }
}

function quotedServiceName(line: string): string | null {
  return line.match(/"([^"]+)"/)?.[1] ?? null;
}

function surfsharkServiceEvidence(output: string | null): { connected: string[]; seen: string[] } {
  const connected: string[] = [];
  const seen: string[] = [];
  for (const line of (output ?? "").split(/\r?\n/)) {
    if (!SURFSHARK_SERVICE_RE.test(line)) continue;
    const name = quotedServiceName(line) ?? "Surfshark";
    const state = line.match(/\(([^)]+)\)/)?.[1]?.trim().toLowerCase();
    seen.push(`${name}: ${state ?? "unknown"}`);
    if (state === "connected") connected.push(name);
  }
  return { connected, seen };
}

function activeMatchingInterfaces(interfaces: Interfaces, pattern: RegExp): string[] {
  return Object.entries(interfaces)
    .filter(([name, addrs]) => pattern.test(name) && (addrs ?? []).some(usableAddress))
    .map(([name]) => name)
    .sort();
}

export function vpnStatus(
  interfaces: Interfaces = networkInterfaces(),
  options: VpnStatusOptions = {},
): VpnStatus {
  const platform = options.platform ?? process.platform;
  const interfacePattern = options.interfacePattern ?? surfsharkPattern();
  const activeInterfaces = activeMatchingInterfaces(interfaces, interfacePattern);

  if (platform === "darwin") {
    const evidence = surfsharkServiceEvidence((options.scutilList ?? readScutilList)());
    if (evidence.connected.length > 0) {
      return {
        ok: true,
        label: VPN_LABEL,
        activeInterfaces: evidence.connected,
        reason: `${VPN_LABEL} detected via ${evidence.connected.join(", ")}.`,
      };
    }

    if (activeInterfaces.length > 0) {
      return {
        ok: true,
        label: VPN_LABEL,
        activeInterfaces,
        reason: `${VPN_LABEL} detected on ${activeInterfaces.join(", ")}.`,
      };
    }

    const detail = evidence.seen.length ? ` macOS reports ${evidence.seen.join(", ")}.` : "";
    return {
      ok: false,
      label: VPN_LABEL,
      activeInterfaces: [],
      reason: `${VPN_LABEL} required.${detail} Connect it before searching, downloading, or seeding.`,
    };
  }

  const ok = activeInterfaces.length > 0;
  const reason = ok
    ? `${VPN_LABEL} detected on ${activeInterfaces.join(", ")}.`
    : `${VPN_LABEL} required. Connect it before searching, downloading, or seeding.`;

  return { ok, label: VPN_LABEL, activeInterfaces, reason };
}
