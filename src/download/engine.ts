import WebTorrent, { type Torrent } from "webtorrent";

export interface TorrentProgress {
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
  uploadSpeed: number;
  uploaded: number;
  peers: number;
  timeRemaining: number;
  name: string;
}

export interface TorrentMeta {
  name: string;
  total: number;
  files: number;
  // The .torrent metadata (piece hashes), available once metadata arrives. We
  // persist it so a later re-seed can verify the on-disk file without having to
  // re-fetch metadata from the swarm (which a bare magnet would require).
  torrentFile?: Uint8Array;
}

export interface AddHandlers {
  onMetadata?: (meta: TorrentMeta) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const BASE_WEBTORRENT_OPTIONS = {
  lsd: false,
  utPex: false,
  natUpnp: false,
  natPmp: false,
} as const;

export function webTorrentOptions(tracker: boolean) {
  return { ...BASE_WEBTORRENT_OPTIONS, tracker };
}

export class TorrentEngine {
  private clients = new Map<boolean, WebTorrent>();
  private torrents = new Map<string, { torrent: Torrent; tracker: boolean }>();
  private trackerDiscovery = true;

  setTrackerDiscoveryEnabled(enabled: boolean): void {
    this.trackerDiscovery = enabled;
  }

  private ensureClient(tracker: boolean): WebTorrent {
    let client = this.clients.get(tracker);
    if (!client) {
      client = new WebTorrent(webTorrentOptions(tracker));
      client.on("error", () => {});
      this.clients.set(tracker, client);
    }
    return client;
  }

  private destroyIdleClient(tracker: boolean): void {
    for (const record of this.torrents.values()) {
      if (record.tracker === tracker) return;
    }
    const client = this.clients.get(tracker);
    if (!client) return;
    this.clients.delete(tracker);
    setImmediate(() => {
      try {
        client.destroy();
      } catch {}
    });
  }

  // `source` is a magnet URI, an infoHash, or a path to a .torrent file. Seeding
  // an existing file passes the stored .torrent path so webtorrent can verify it
  // locally instead of re-fetching metadata from the swarm.
  // `announce` supplements whatever trackers are already in the source URI;
  // webtorrent dedupes internally.
  add(
    id: string,
    source: string,
    dir: string,
    handlers: AddHandlers,
    announce?: string[],
  ): void {
    const tracker = this.trackerDiscovery;
    const existing = this.torrents.get(id);
    if (existing) {
      this.torrents.delete(id);
      try {
        existing.torrent.destroy();
      } catch {}
      this.destroyIdleClient(existing.tracker);
    }
    const client = this.ensureClient(tracker);

    const opts = announce && announce.length > 0 ? { path: dir, announce } : { path: dir };
    let torrent: Torrent;
    try {
      torrent = client.add(source, opts);
    } catch (e) {
      handlers.onError?.(message(e));
      return;
    }
    this.torrents.set(id, { torrent, tracker });

    torrent.on("metadata", () => {
      handlers.onMetadata?.({
        name: torrent.name,
        total: torrent.length,
        files: torrent.files?.length ?? 0,
        torrentFile: torrent.torrentFile,
      });
    });
    torrent.on("done", () => {
      // A finished torrent is a complete, verified torrent: keep it alive so it
      // can seed. The queue owns its lifetime from here (remove/destroy).
      handlers.onDone?.();
    });
    torrent.on("error", (err: unknown) => {
      handlers.onError?.(message(err));
      this.torrents.delete(id);
      try {
        torrent.destroy();
      } catch {}
      this.destroyIdleClient(tracker);
    });
  }

  // The TCP port the client accepts incoming peers on (diagnostics / tests).
  listenPort(): number | null {
    for (const client of this.clients.values()) {
      if (client.torrentPort) return client.torrentPort;
    }
    return null;
  }

  stats(id: string): TorrentProgress | null {
    const record = this.torrents.get(id);
    if (!record) return null;
    const t = record.torrent;
    return {
      progress: t.progress,
      downloaded: t.downloaded,
      total: t.length,
      speed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      uploaded: t.uploaded,
      peers: t.numPeers,
      timeRemaining: t.timeRemaining,
      name: t.name,
    };
  }

  remove(id: string): void {
    const record = this.torrents.get(id);
    this.torrents.delete(id);
    if (record) {
      try {
        record.torrent.destroy();
      } catch {}
      this.destroyIdleClient(record.tracker);
    }
  }

  destroy(): void {
    this.torrents.clear();
    // Never block shutdown on webtorrent's async teardown: hand off the client
    // destroy to a later tick and let the OS reclaim sockets if we exit first.
    const clients = [...this.clients.values()];
    this.clients.clear();
    for (const client of clients) {
      setImmediate(() => {
        try {
          client.destroy();
        } catch {}
      });
    }
  }
}
