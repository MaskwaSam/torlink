import { promises as fs } from "node:fs";
import { configFile, defaultDownloadDir } from "./paths";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";
import { ACTIVE_SOURCE_IDS } from "../sources/registry";
import type { SourceId } from "../sources/types";

export interface Config {
  downloadDir: string;
  trackers: string[];
  enableTrackers: boolean;
  autoResumeTorrents: boolean;
  requireSurfsharkVpn: boolean;
  autoStopSeeding: boolean;
  disabledSources: SourceId[];
}

export const defaultConfig: Config = {
  downloadDir: defaultDownloadDir,
  trackers: [],
  enableTrackers: true,
  autoResumeTorrents: true,
  requireSurfsharkVpn: true,
  autoStopSeeding: false,
  disabledSources: [],
};

const ACTIVE_SOURCE_ID_SET = new Set<string>(ACTIVE_SOURCE_IDS);

function configCopy(config: Config = defaultConfig): Config {
  return {
    ...config,
    trackers: [...config.trackers],
    disabledSources: [...config.disabledSources],
  };
}

function cleanDisabledSources(
  value: unknown,
  fallback: readonly SourceId[] = defaultConfig.disabledSources,
): SourceId[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<SourceId>();
  for (const raw of value) {
    if (typeof raw !== "string" || !ACTIVE_SOURCE_ID_SET.has(raw)) continue;
    seen.add(raw as SourceId);
  }
  if (seen.size >= ACTIVE_SOURCE_IDS.length) return [...fallback];
  return ACTIVE_SOURCE_IDS.filter((id) => seen.has(id));
}

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await fs.readFile(configFile, "utf8");
  } catch {
    return configCopy();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Config>;
    const cfg: Config = {
      downloadDir:
        typeof parsed.downloadDir === "string" && parsed.downloadDir
          ? parsed.downloadDir
          : defaultDownloadDir,
      trackers: Array.isArray(parsed.trackers)
        ? parsed.trackers.filter((t): t is string => typeof t === "string" && t.length > 0)
        : [],
      enableTrackers:
        typeof parsed.enableTrackers === "boolean"
          ? parsed.enableTrackers
          : defaultConfig.enableTrackers,
      autoResumeTorrents:
        typeof parsed.autoResumeTorrents === "boolean"
          ? parsed.autoResumeTorrents
          : defaultConfig.autoResumeTorrents,
      requireSurfsharkVpn:
        typeof parsed.requireSurfsharkVpn === "boolean"
          ? parsed.requireSurfsharkVpn
          : defaultConfig.requireSurfsharkVpn,
      autoStopSeeding:
        typeof parsed.autoStopSeeding === "boolean"
          ? parsed.autoStopSeeding
          : defaultConfig.autoStopSeeding,
      disabledSources: cleanDisabledSources(parsed.disabledSources),
    };
    return cfg;
  } catch {
    return configCopy();
  }
}

const write = serializeWrites();

export function saveConfig(config: Config): Promise<void> {
  return write(() => writeJsonAtomic(configFile, config));
}
