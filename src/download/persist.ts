import { promises as fs, mkdirSync, writeFileSync, renameSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { queueFile, seedsFile, torrentsDir } from "../config/paths";
import { parseInfoHash } from "../sources/magnet";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";
import type { PauseReason, QueueItem } from "./types";

const write = serializeWrites();

export function saveQueue(items: QueueItem[]): Promise<void> {
  return write(() => writeJsonAtomic(queueFile, items));
}

export function saveQueueSync(items: QueueItem[]): void {
  try {
    mkdirSync(path.dirname(queueFile), { recursive: true });
    const tmp = `${queueFile}.sync.tmp`;
    writeFileSync(tmp, JSON.stringify(items, null, 2), "utf8");
    renameSync(tmp, queueFile);
  } catch {}
}

function toQueueItem(v: unknown): QueueItem | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.magnet !== "string") return null;
  const id = parseInfoHash(r.id);
  if (!id) return null;
  return {
    ...r,
    id,
    pauseReason: r.pauseReason === "network" ? "network" : undefined,
  } as QueueItem;
}

export async function loadQueue(): Promise<QueueItem[]> {
  let raw: string;
  try {
    raw = await fs.readFile(queueFile, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.map(toQueueItem).filter((item): item is QueueItem => item !== null)
      : [];
  } catch {
    return [];
  }
}

// We persist the user-meaningful seed states so a deliberate pause survives a
// restart (and stays paused), not just the seeding ids. Missing is runtime-only
// and gets folded to paused on the way out so a gone file is never auto-seeded.
export type PersistedSeedStatus = "seeding" | "paused";

export interface SeedRecord {
  id: string;
  status: PersistedSeedStatus;
  pauseReason?: PauseReason;
}

export function saveSeeds(records: SeedRecord[]): Promise<void> {
  return write(() => writeJsonAtomic(seedsFile, records));
}

export function saveSeedsSync(records: SeedRecord[]): void {
  try {
    mkdirSync(path.dirname(seedsFile), { recursive: true });
    const tmp = `${seedsFile}.sync.tmp`;
    writeFileSync(tmp, JSON.stringify(records, null, 2), "utf8");
    renameSync(tmp, seedsFile);
  } catch {}
}

// --- per-torrent .torrent metadata cache ------------------------------------

export function torrentMetaPath(id: string): string {
  const infoHash = parseInfoHash(id);
  if (!infoHash) throw new Error("invalid torrent metadata id");
  const root = path.resolve(torrentsDir);
  const file = path.resolve(root, `${infoHash}.torrent`);
  if (path.dirname(file) !== root) throw new Error("invalid torrent metadata path");
  return file;
}

export function torrentMetaExists(id: string): boolean {
  try {
    return existsSync(torrentMetaPath(id));
  } catch {
    return false;
  }
}

export async function saveTorrentMeta(id: string, data: Uint8Array): Promise<void> {
  try {
    await fs.mkdir(torrentsDir, { recursive: true });
    const file = torrentMetaPath(id);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch {}
}

export function deleteTorrentMeta(id: string): void {
  try {
    rmSync(torrentMetaPath(id), { force: true });
  } catch {}
}

export async function loadSeeds(): Promise<SeedRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(seedsFile, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SeedRecord[] = [];
    for (const el of parsed) {
      // Legacy format was a bare id array; treat each as a seeding entry.
      if (typeof el === "string") {
        const id = parseInfoHash(el);
        if (id) out.push({ id, status: "seeding" });
      } else if (el && typeof el === "object") {
        const r = el as Record<string, unknown>;
        const id = typeof r.id === "string" ? parseInfoHash(r.id) : null;
        if (id && (r.status === "seeding" || r.status === "paused")) {
          out.push({
            id,
            status: r.status,
            pauseReason: r.pauseReason === "network" ? "network" : undefined,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
