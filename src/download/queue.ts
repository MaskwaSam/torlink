import { EventEmitter } from "node:events";
import {
  TorrentEngine,
  type AddHandlers,
  type TorrentBackend,
} from "./engine";
import {
  saveQueue,
  saveQueueSync,
  saveSeeds,
  saveSeedsSync,
  deleteTorrentMeta,
  type SeedRecord,
} from "./persist";
import { saveHistory, saveHistorySync, type HistoryItem } from "./history";
import type { PauseReason, QueueItem, SeedItem } from "./types";
import { parseInfoHash } from "../sources/magnet";
import type { SourceId } from "../sources/types";

/**
 * A real seed never pulls data off the network: verifying on-disk files reads
 * the disk (network speed stays 0), only fetching *missing* data raises it. So
 * sustained network download on a "seed" means its files are gone or partial.
 * Size-agnostic (a 50 GB verify never trips it) and cross-platform: we never
 * guess the on-disk path from a torrent name.
 */
export function strayDownload(s: { total: number; progress: number; speed: number }): boolean {
  return s.total > 0 && s.progress < 1 && s.speed > 0;
}

const STRAY_TICKS = 2; // consecutive stray polls before flagging missing (~1s)

// How long (ms) to let Transmission verify on-disk pieces before the
// stray-download detector starts watching.
const SEED_GRACE_MS = 10_000;

const POLL_MS = 3_000;
const HISTORY_MAX = 500;

export interface AddInput {
  id: string;
  name: string;
  magnet: string;
  source?: SourceId;
  sizeBytes?: number;
}

export class DownloadQueue extends EventEmitter {
  private items = new Map<string, QueueItem>();
  private poll: ReturnType<typeof setInterval> | null = null;
  private history: HistoryItem[] = [];
  private seeds = new Map<string, SeedItem>();
  private strayHits = new Map<string, number>();
  private seedStartedAt = new Map<string, number>();
  private networkAllowed = true;
  private autoResumeTorrents = true;
  private autoStopSeeding = false;
  private networkPausedDownloads = new Set<string>();
  private networkPausedSeeds = new Set<string>();

  constructor(private readonly engine: TorrentBackend = new TorrentEngine()) {
    super();
  }

  // Kept as no-ops so older config plumbing can be read without changing
  // persisted settings; Transmission owns tracker handling internally.
  setTrackers(_trackers: string[]): void {}

  setTrackerDiscoveryEnabled(_enabled: boolean): void {}

  setNetworkAllowed(allowed: boolean): void {
    if (this.networkAllowed === allowed) return;
    this.networkAllowed = allowed;
    if (!allowed) this.pauseNetworkActivity();
    else if (this.autoResumeTorrents) this.resumeNetworkPaused();
  }

  setAutoResumeTorrents(enabled: boolean): void {
    if (this.autoResumeTorrents === enabled) return;
    this.autoResumeTorrents = enabled;
    if (enabled && this.networkAllowed) this.resumeNetworkPaused();
  }

  setAutoStopSeeding(enabled: boolean): void {
    if (this.autoStopSeeding === enabled) return;
    this.autoStopSeeding = enabled;
    if (enabled) this.stopActiveSeeds();
  }

  private stopActiveSeeds(): void {
    let changed = false;
    for (const sd of this.seeds.values()) {
      if (sd.status !== "seeding") continue;
      this.engine.pause(sd.id);
      this.strayHits.delete(sd.id);
      this.seedStartedAt.delete(sd.id);
      this.networkPausedSeeds.delete(sd.id);
      sd.status = "paused";
      sd.pauseReason = undefined;
      sd.uploadSpeed = 0;
      sd.peers = 0;
      changed = true;
    }
    if (!changed) return;
    this.changed();
    void this.persistSeeds();
    this.maybeStopPoll();
  }

  private pauseNetworkActivity(): void {
    let downloadsChanged = false;
    let seedsChanged = false;

    for (const it of this.items.values()) {
      if (it.status !== "downloading") continue;
      this.engine.pause(it.id);
      it.status = "paused";
      it.pauseReason = "network";
      it.speed = 0;
      it.peers = 0;
      it.eta = undefined;
      this.networkPausedDownloads.add(it.id);
      downloadsChanged = true;
    }

    for (const sd of this.seeds.values()) {
      if (sd.status !== "seeding") continue;
      this.engine.pause(sd.id);
      this.strayHits.delete(sd.id);
      this.seedStartedAt.delete(sd.id);
      sd.status = "paused";
      sd.pauseReason = "network";
      sd.uploadSpeed = 0;
      sd.peers = 0;
      this.networkPausedSeeds.add(sd.id);
      seedsChanged = true;
    }

    if (!downloadsChanged && !seedsChanged) return;
    this.changed();
    if (downloadsChanged) void this.persist();
    if (seedsChanged) void this.persistSeeds();
    this.maybeStopPoll();
  }

  private resumeNetworkPaused(): void {
    for (const id of [...this.networkPausedDownloads]) {
      const it = this.items.get(id);
      if (it?.status === "paused" && it.pauseReason === "network") this.resume(id);
      else this.networkPausedDownloads.delete(id);
    }

    for (const id of [...this.networkPausedSeeds]) {
      const sd = this.seeds.get(id);
      if (sd?.status === "paused" && sd.pauseReason === "network") {
        const h = this.history.find((x) => x.id === id);
        if (h) this.startSeeding(h);
        else this.networkPausedSeeds.delete(id);
      } else {
        this.networkPausedSeeds.delete(id);
      }
    }
  }

  getItems(): QueueItem[] {
    return [...this.items.values()].sort((a, b) => b.addedAt - a.addedAt);
  }

  get activeCount(): number {
    let n = 0;
    for (const it of this.items.values()) if (it.status === "downloading") n++;
    return n;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  add(input: AddInput, dir: string): void {
    const id = parseInfoHash(input.id);
    if (!id) return;
    const safeInput = { ...input, id };
    if (this.seeds.has(id)) {
      this.engine.remove(id);
      this.seeds.delete(id);
      this.strayHits.delete(id);
      this.seedStartedAt.delete(id);
      void this.persistSeeds();
    }
    const existing = this.items.get(id);
    if (existing && existing.status !== "failed") return;
    const item: QueueItem = existing
      ? {
          ...existing,
          backend: "transmission",
          status: this.networkAllowed ? "downloading" : "paused",
          error: undefined,
          speed: 0,
          pauseReason: this.networkAllowed ? undefined : "network",
        }
      : {
          id: safeInput.id,
          backend: "transmission",
          name: safeInput.name,
          source: safeInput.source,
          magnet: safeInput.magnet,
          dir,
          status: this.networkAllowed ? "downloading" : "paused",
          pauseReason: this.networkAllowed ? undefined : "network",
          progress: 0,
          totalBytes: safeInput.sizeBytes ?? 0,
          downloadedBytes: 0,
          speed: 0,
          peers: 0,
          addedAt: Date.now(),
        };
    this.items.set(item.id, item);
    if (this.networkAllowed) {
      this.startEngine(item);
      this.ensurePoll();
    } else {
      this.networkPausedDownloads.add(item.id);
    }
    this.reconcileEngine(dir);
    this.changed();
    void this.persist();
  }

  private startEngine(item: QueueItem): void {
    this.engine.add(item.id, item.magnet, item.dir, this.engineHandlers(item.id));
  }

  private trackedTorrentIds(): string[] {
    return [...new Set([...this.items.keys(), ...this.seeds.keys()])];
  }

  private reconcileEngine(downloadDir: string): void {
    this.engine.reconcile?.(this.trackedTorrentIds(), downloadDir);
  }

  // One torrent serves an item across its whole life (download -> seed ->
  // missing), so the engine handlers are phase-aware: they look up the id in
  // `items` (still downloading) or `seeds` (finished, now seeding) and act on
  // whichever it currently is.
  private engineHandlers(id: string): AddHandlers {
    return {
      onMetadata: (meta) => {
        const it = this.items.get(id);
        if (!it) return; // the rest only matters while still downloading
        if (meta.name) it.name = meta.name;
        if (meta.total) it.totalBytes = meta.total;
        it.files = meta.files;
        this.changed();
        void this.persist();
      },
      onDone: () => {
        const it = this.items.get(id);
        if (it) {
          // Download finished: record it, then either seed or stop according to
          // the user's auto-stop seeding preference.
          if (it.totalBytes) it.downloadedBytes = it.totalBytes;
          this.complete(it);
          return;
        }
        // A re-seed (restart / manual resume) passed verification: the file is
        // confirmed on disk, so clear stray-detection state and end its grace.
        if (this.seeds.has(id)) {
          this.strayHits.set(id, 0);
          this.seedStartedAt.delete(id);
        }
      },
      onError: (msg) => {
        const it = this.items.get(id);
        if (it) {
          it.status = "failed";
          it.error = msg;
          it.speed = 0;
          it.peers = 0;
          this.emit("notice", msg);
          this.changed();
          void this.persist();
          this.maybeStopPoll();
          return;
        }
        const sd = this.seeds.get(id);
        if (sd) {
          sd.status = "missing";
          sd.uploadSpeed = 0;
          sd.peers = 0;
          this.seedStartedAt.delete(id);
          this.emit("notice", msg);
          this.changed();
          void this.persistSeeds();
          this.maybeStopPoll();
        }
      },
    };
  }

  private complete(it: QueueItem): void {
    this.recordHistory(it);
    this.items.delete(it.id);
    if (this.autoStopSeeding) {
      this.engine.remove(it.id);
      this.strayHits.delete(it.id);
      this.seedStartedAt.delete(it.id);
      this.networkPausedDownloads.delete(it.id);
      this.networkPausedSeeds.delete(it.id);
    } else {
      // Opt-out seeding: a finished download is already a complete, verified
      // torrent, so keep it alive and seeding instead of tearing it down.
      this.beginSeed(it);
    }
    this.emit("completed", it.name);
    this.changed();
    void this.persist();
    this.maybeStopPoll();
  }

  // Adopt the just-finished download's live torrent as a seed in place: no
  // re-add, no re-verify (progress is already 1, so stray detection never
  // trips). Restart / manual resume go through startSeeding instead.
  private beginSeed(it: QueueItem): void {
    if (!it.magnet) return;
    this.seeds.set(it.id, {
      id: it.id,
      backend: "transmission",
      name: it.name,
      source: it.source,
      magnet: it.magnet,
      dir: it.dir,
      sizeBytes: it.totalBytes,
      status: "seeding",
      uploadSpeed: 0,
      uploaded: 0,
      peers: 0,
    });
    this.strayHits.set(it.id, 0);
    this.seedStartedAt.set(it.id, Date.now());
    this.ensurePoll();
    void this.persistSeeds();
  }

  private async tick(): Promise<void> {
    let any = false;
    const completed: QueueItem[] = [];
    for (const it of this.items.values()) {
      if (it.status !== "downloading") continue;
      const s = await this.engine.stats(it.id).catch((e) => {
        it.status = "failed";
        it.error = e instanceof Error ? e.message : String(e);
        it.speed = 0;
        it.peers = 0;
        this.emit("notice", it.error);
        void this.persist();
        return null;
      });
      if (!s) continue;
      it.progress = Math.min(100, Math.round(s.progress * 100));
      it.downloadedBytes = s.downloaded;
      if (s.total) it.totalBytes = s.total;
      it.speed = s.speed;
      it.peers = s.peers;
      it.eta =
        s.timeRemaining > 0 && Number.isFinite(s.timeRemaining)
          ? s.timeRemaining / 1000
          : undefined;
      if (s.name) it.name = s.name;
      if (s.total > 0 && s.progress >= 1) completed.push(it);
      any = true;
    }
    for (const it of completed) this.complete(it);
    const now = Date.now();
    for (const sd of this.seeds.values()) {
      if (sd.status !== "seeding") continue;
      const s = await this.engine.stats(sd.id).catch((e) => {
        sd.status = "missing";
        sd.uploadSpeed = 0;
        sd.peers = 0;
        this.seedStartedAt.delete(sd.id);
        this.emit("notice", e instanceof Error ? e.message : String(e));
        void this.persistSeeds();
        return null;
      });
      if (!s) continue;
      // Safety-net: a seed that's pulling data has lost its files on disk. Give
      // it a couple of ticks (ignore a one-piece repair blip), then stop it and
      // flag missing, never re-download the whole thing.
      //
      // Skip seeds still inside the grace period: Transmission needs time to
      // hash-verify on-disk pieces, and during that window progress < 1 with
      // downloadSpeed > 0 is perfectly normal.
      const age = now - (this.seedStartedAt.get(sd.id) ?? 0);
      if (age > SEED_GRACE_MS && strayDownload(s)) {
        const hits = (this.strayHits.get(sd.id) ?? 0) + 1;
        this.strayHits.set(sd.id, hits);
        if (hits >= STRAY_TICKS) {
          this.engine.pause(sd.id);
          this.strayHits.delete(sd.id);
          this.seedStartedAt.delete(sd.id);
          sd.status = "missing";
          sd.uploadSpeed = 0;
          sd.peers = 0;
          void this.persistSeeds();
        }
        any = true;
        continue;
      }
      this.strayHits.set(sd.id, 0);
      sd.uploadSpeed = s.uploadSpeed;
      sd.uploaded = s.uploaded;
      sd.peers = s.peers;
      any = true;
    }
    if (any) this.changed();
  }

  private ensurePoll(): void {
    if (this.poll) return;
    this.poll = setInterval(() => void this.tick(), POLL_MS);
    this.poll.unref();
  }

  private maybeStopPoll(): void {
    if (this.activeCount === 0 && this.seedingCount === 0 && this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  pause(id: string): void {
    const it = this.items.get(id);
    if (!it || it.status !== "downloading") return;
    it.status = "paused";
    it.pauseReason = undefined;
    it.speed = 0;
    it.peers = 0;
    it.eta = undefined;
    this.networkPausedDownloads.delete(id);
    this.engine.pause(id);
    this.changed();
    void this.persist();
    this.maybeStopPoll();
  }

  resume(id: string): void {
    const it = this.items.get(id);
    if (!it || it.status !== "paused") return;
    if (!this.networkAllowed) return;
    it.status = "downloading";
    it.pauseReason = undefined;
    this.networkPausedDownloads.delete(id);
    this.startEngine(it);
    this.ensurePoll();
    this.changed();
    void this.persist();
  }

  togglePause(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.status === "downloading") this.pause(id);
    else if (it.status === "paused") this.resume(id);
  }

  cancel(id: string): void {
    if (!this.items.has(id)) return;
    this.engine.remove(id);
    this.items.delete(id);
    this.networkPausedDownloads.delete(id);
    deleteTorrentMeta(id);
    this.changed();
    void this.persist();
    this.maybeStopPoll();
  }

  retry(id: string): void {
    const it = this.items.get(id);
    if (!it || it.status !== "failed") return;
    if (!this.networkAllowed) return;
    it.status = "downloading";
    it.pauseReason = undefined;
    this.networkPausedDownloads.delete(id);
    it.error = undefined;
    this.startEngine(it);
    this.ensurePoll();
    this.changed();
    void this.persist();
  }

  retryFailed(): void {
    for (const it of [...this.items.values()]) {
      if (it.status === "failed") this.retry(it.id);
    }
  }

  verify(id: string): void {
    const known = this.items.has(id) || this.seeds.has(id);
    if (!known) return;
    this.engine.verify(id);
    this.emit("notice", "Transmission verify/rescan started.");
  }

  getSeed(id: string): SeedItem | undefined {
    return this.seeds.get(id);
  }

  getSeeds(): SeedItem[] {
    return [...this.seeds.values()];
  }

  get seedingCount(): number {
    let n = 0;
    for (const s of this.seeds.values()) if (s.status === "seeding") n++;
    return n;
  }

  startSeeding(h: HistoryItem): void {
    const id = parseInfoHash(h.id);
    if (!id) return;
    const safeHistory = { ...h, id };
    if (this.seeds.get(id)?.status === "seeding") return;
    if (this.items.has(id)) return; // don't seed a file that's downloading

    if (!this.networkAllowed) {
      this.restorePaused(safeHistory, "network");
      this.networkPausedSeeds.add(id);
      void this.persistSeeds();
      return;
    }

    const base: SeedItem = {
      id: safeHistory.id,
      backend: "transmission",
      name: safeHistory.name,
      source: safeHistory.source,
      magnet: safeHistory.magnet,
      dir: safeHistory.dir,
      sizeBytes: safeHistory.sizeBytes,
      status: "seeding",
      uploadSpeed: 0,
      uploaded: 0,
      peers: 0,
      pauseReason: undefined,
    };

    // Only hard guard we can make synchronously and portably: no magnet, no seed.
    // We do NOT guess the on-disk path; we let Transmission verify the real
    // files and the poll safety-net flags a missing one.
    if (!safeHistory.magnet) {
      this.seeds.set(id, { ...base, status: "missing" });
      this.changed();
      void this.persistSeeds();
      return;
    }

    this.seeds.set(id, base);
    this.networkPausedSeeds.delete(id);
    this.strayHits.set(id, 0);
    this.seedStartedAt.set(id, Date.now());
    this.engine.add(id, safeHistory.magnet, safeHistory.dir, this.engineHandlers(id));
    this.ensurePoll();
    this.changed();
    void this.persistSeeds();
  }

  stopSeeding(id: string): void {
    const s = this.seeds.get(id);
    if (!s) return;
    this.engine.remove(id);
    this.strayHits.delete(id);
    this.seedStartedAt.delete(id);
    this.networkPausedSeeds.delete(id);
    if (s.status === "seeding") {
      s.status = "paused";
      s.pauseReason = undefined;
      s.uploadSpeed = 0;
      s.peers = 0;
    }
    this.changed();
    void this.persistSeeds();
    this.maybeStopPoll();
  }

  toggleSeeding(h: HistoryItem): void {
    if (this.seeds.get(h.id)?.status === "seeding") this.stopSeeding(h.id);
    else this.startSeeding(h);
  }

  restoreSeeds(records: SeedRecord[]): void {
    for (const r of records) {
      const h = this.history.find((x) => x.id === r.id);
      if (!h) continue;
      // Respect the persisted choice: resume seeders, but leave a paused seed
      // paused (and visibly so) instead of auto-starting it.
      if (
        (r.status === "seeding" || r.pauseReason === "network") &&
        this.networkAllowed &&
        this.autoResumeTorrents &&
        !this.autoStopSeeding
      ) {
        this.startSeeding(h);
      } else {
        const pauseReason =
          r.status === "seeding" && !this.networkAllowed ? "network" : r.pauseReason;
        this.restorePaused(h, pauseReason);
      }
    }
  }

  reconcileBackend(downloadDir: string): void {
    this.reconcileEngine(downloadDir);
  }

  // Rebuild a paused seed from history without touching the engine, so it shows
  // as paused and stays off until the user presses p to resume it.
  private restorePaused(h: HistoryItem, pauseReason?: PauseReason): void {
    if (this.seeds.has(h.id)) return;
    this.seeds.set(h.id, {
      id: h.id,
      name: h.name,
      source: h.source,
      magnet: h.magnet,
      dir: h.dir,
      sizeBytes: h.sizeBytes,
      status: "paused",
      uploadSpeed: 0,
      uploaded: 0,
      peers: 0,
      pauseReason,
    });
    if (pauseReason === "network") this.networkPausedSeeds.add(h.id);
    this.changed();
  }

  private seedRecords(): SeedRecord[] {
    const out: SeedRecord[] = [];
    for (const s of this.seeds.values()) {
      // "missing" is a runtime detection (file gone); persist it as paused so we
      // remember the user had it without auto-seeding a file that isn't there.
      if (s.status === "seeding" && this.autoResumeTorrents && !this.autoStopSeeding) {
        out.push({ id: s.id, status: "seeding" });
      } else {
        out.push({
          id: s.id,
          status: "paused",
          pauseReason: s.pauseReason === "network" ? "network" : undefined,
        });
      }
    }
    return out;
  }

  private queueRecords(): QueueItem[] {
    return this.getItems().map((it) =>
      it.status === "downloading" && !this.autoResumeTorrents
        ? {
            ...it,
            status: "paused",
            speed: 0,
            peers: 0,
            eta: undefined,
            pauseReason: undefined,
          }
        : it,
    );
  }

  private persistSeeds(): Promise<void> {
    return saveSeeds(this.seedRecords()).catch(() => {});
  }

  restore(items: QueueItem[]): void {
    for (const raw of items) {
      if (raw.backend !== "transmission") {
        this.items.set(raw.id, {
          ...raw,
          status: "paused",
          speed: 0,
          peers: 0,
          eta: undefined,
          pauseReason: undefined,
        });
        continue;
      }
      const shouldAutoResumeNetworkPause =
        raw.status === "paused" &&
        raw.pauseReason === "network" &&
        this.networkAllowed &&
        this.autoResumeTorrents;
      const shouldStartDownloading =
        raw.status === "downloading" && this.networkAllowed && this.autoResumeTorrents;
      const shouldNetworkPause =
        raw.status === "downloading" && (!this.networkAllowed || !this.autoResumeTorrents);
      const item =
        shouldAutoResumeNetworkPause || shouldStartDownloading
          ? { ...raw, status: "downloading" as const, pauseReason: undefined }
          : shouldNetworkPause
            ? {
                ...raw,
                status: "paused" as const,
                speed: 0,
                peers: 0,
                eta: undefined,
                pauseReason: !this.networkAllowed ? ("network" as const) : undefined,
              }
            : raw;
      this.items.set(item.id, item);
      if (item.status === "downloading") this.startEngine(item);
      else if (item.pauseReason === "network") this.networkPausedDownloads.add(item.id);
    }
    if (this.activeCount > 0) this.ensurePoll();
    this.changed();
  }

  restoreHistory(items: HistoryItem[]): void {
    this.history = items.slice(0, HISTORY_MAX);
  }

  getHistory(): HistoryItem[] {
    return this.history;
  }

  private recordHistory(it: QueueItem): void {
    const rec: HistoryItem = {
      id: it.id,
      name: it.name,
      source: it.source,
      sizeBytes: it.totalBytes,
      magnet: it.magnet,
      dir: it.dir,
      completedAt: Date.now(),
    };
    this.history = [rec, ...this.history.filter((h) => h.id !== it.id)].slice(0, HISTORY_MAX);
    void saveHistory(this.history).catch(() => {});
  }

  removeHistory(id: string): void {
    const next = this.history.filter((h) => h.id !== id);
    if (next.length === this.history.length) return;
    this.history = next;
    if (this.seeds.has(id)) {
      this.engine.remove(id);
      this.seeds.delete(id);
      this.strayHits.delete(id);
      this.seedStartedAt.delete(id);
      void this.persistSeeds();
      this.maybeStopPoll();
    }
    deleteTorrentMeta(id);
    void saveHistory(this.history).catch(() => {});
    this.changed();
  }

  clearHistory(): void {
    if (this.history.length === 0) return;
    for (const h of this.history) deleteTorrentMeta(h.id);
    this.history = [];
    if (this.seeds.size > 0) {
      for (const id of this.seeds.keys()) this.engine.remove(id);
      this.seeds.clear();
      this.strayHits.clear();
      this.seedStartedAt.clear();
      void this.persistSeeds();
      this.maybeStopPoll();
    }
    void saveHistory(this.history).catch(() => {});
    this.changed();
  }

  private changed(): void {
    this.emit("update");
  }

  private async persist(): Promise<void> {
    await saveQueue(this.queueRecords()).catch(() => {});
  }

  // Synchronously flush every state file from current memory. Used on quit so
  // nothing depends on in-flight async writes surviving the hard exit, and so
  // history / seeds can never be lost mid-write. Touches no engine state, so it
  // can never block shutdown.
  persistSync(): void {
    saveQueueSync(this.queueRecords());
    saveHistorySync(this.history);
    saveSeedsSync(this.seedRecords());
  }

  suspend(): void {
    // Keep active downloads as "downloading" so restore() resumes them on the
    // next launch (mirroring how seeds auto-restore); just zero the live stats.
    for (const it of this.items.values()) {
      if (it.status === "downloading") {
        it.speed = 0;
        it.peers = 0;
        it.eta = undefined;
      }
    }
    this.persistSync();
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
    this.engine.destroy();
  }
}
