import { constants as fsConstants, promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { transmissionDir } from "../config/paths";

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
}

export interface AddHandlers {
  onMetadata?: (meta: TorrentMeta) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export interface TorrentBackend {
  add(id: string, source: string, dir: string, handlers: AddHandlers): void;
  reconcile?(ids: readonly string[], dir: string): void;
  pause(id: string): void;
  resume(id: string): void;
  remove(id: string): void;
  verify(id: string): void;
  stats(id: string): Promise<TorrentProgress | null>;
  destroy(): void;
}

export const TRANSMISSION_INSTALL_HINT = "Transmission backend missing. Install with: brew install transmission-cli";

const RPC_PATH = "/transmission/rpc";
const TORLINK_SESSION_SETTINGS = {
  "download-queue-enabled": false,
  "queue-stalled-enabled": false,
  "seed-queue-enabled": false,
  "start-added-torrents": true,
  start_paused: false,
};
const RPC_FIELDS = [
  "id",
  "hashString",
  "name",
  "totalSize",
  "leftUntilDone",
  "percentDone",
  "rateDownload",
  "rateUpload",
  "uploadedEver",
  "peersConnected",
  "eta",
  "error",
  "errorString",
] as const;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class TransmissionRpcError extends Error {
  constructor(
    public readonly result: string,
    public readonly method: string,
  ) {
    super(`Transmission ${method} failed: ${result}`);
  }
}

interface RpcEnvelope<T> {
  result?: string;
  arguments?: T;
}

interface TorrentAddResponse {
  "torrent-added"?: TransmissionTorrent;
  "torrent-duplicate"?: TransmissionTorrent;
}

interface TorrentGetResponse {
  torrents?: TransmissionTorrent[];
}

interface TransmissionTorrent {
  id?: number;
  hashString?: string;
  name?: string;
  totalSize?: number;
  leftUntilDone?: number;
  percentDone?: number;
  rateDownload?: number;
  rateUpload?: number;
  uploadedEver?: number;
  peersConnected?: number;
  eta?: number;
  error?: number;
  errorString?: string;
}

type FetchLike = typeof fetch;

export class TransmissionRpcClient {
  private sessionId: string | null = null;

  constructor(
    private readonly url: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async request<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const body = JSON.stringify({ method, arguments: args });
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.sessionId) headers["X-Transmission-Session-Id"] = this.sessionId;
      const res = await this.fetchImpl(this.url, { method: "POST", headers, body });
      if (res.status === 409) {
        this.sessionId = res.headers.get("x-transmission-session-id");
        if (this.sessionId && attempt === 0) continue;
      }
      if (!res.ok) throw new Error(`Transmission RPC HTTP ${res.status}`);
      const json = (await res.json()) as RpcEnvelope<T>;
      const result = json.result ?? "success";
      if (result !== "success") throw new TransmissionRpcError(result, method);
      return (json.arguments ?? {}) as T;
    }
    throw new Error("Transmission RPC session negotiation failed");
  }

  async add(source: string, dir: string): Promise<TransmissionTorrent> {
    const args: Record<string, unknown> = { "download-dir": dir, paused: false };
    if (source.endsWith(".torrent")) {
      args.metainfo = await fs.readFile(source, "base64");
    } else {
      args.filename = source;
    }
    const res = await this.request<TorrentAddResponse>("torrent-add", args);
    const torrent = res["torrent-added"] ?? res["torrent-duplicate"];
    if (!torrent?.hashString) throw new Error("Transmission did not return a torrent hash");
    return torrent;
  }

  async get(ids: string[]): Promise<TransmissionTorrent[]> {
    if (ids.length === 0) return [];
    const res = await this.request<TorrentGetResponse>("torrent-get", { ids, fields: RPC_FIELDS });
    return res.torrents ?? [];
  }

  async getAll(): Promise<TransmissionTorrent[]> {
    const res = await this.request<TorrentGetResponse>("torrent-get", { fields: RPC_FIELDS });
    return res.torrents ?? [];
  }

  async start(ids: string[]): Promise<void> {
    await this.request("torrent-start", { ids });
  }

  async stop(ids: string[]): Promise<void> {
    await this.request("torrent-stop", { ids });
  }

  async remove(ids: string[]): Promise<void> {
    await this.request("torrent-remove", { ids, "delete-local-data": false });
  }

  async verify(ids: string[]): Promise<void> {
    await this.request("torrent-verify", { ids });
  }

  async closeSession(): Promise<void> {
    await this.request("session-close");
  }
}

export interface TransmissionEndpoint {
  url: string;
  destroy(): void;
}

export interface DaemonRunner {
  start(downloadDir: string): Promise<TransmissionEndpoint>;
  destroy?(): void;
}

export function transmissionCandidates(envPath = process.env.PATH ?? ""): string[] {
  const fromPath = envPath
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, "transmission-daemon"));
  return [
    ...fromPath,
    "/opt/homebrew/bin/transmission-daemon",
    "/usr/local/bin/transmission-daemon",
    "/usr/bin/transmission-daemon",
  ];
}

export async function findTransmissionDaemon(candidates = transmissionCandidates()): Promise<string | null> {
  const seen = new Set<string>();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      await fs.access(file, fsConstants.X_OK);
      return file;
    } catch {}
  }
  return null;
}

async function freeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("Could not allocate localhost port"));
      });
    });
  });
}

async function waitForRpc(url: string, fetchImpl: FetchLike, timeoutMs = 8_000): Promise<void> {
  const client = new TransmissionRpcClient(url, fetchImpl);
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await client.request("session-get");
      return;
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Transmission RPC did not become ready");
}

async function configureTorLinkSession(url: string, fetchImpl: FetchLike): Promise<void> {
  const client = new TransmissionRpcClient(url, fetchImpl);
  await client.request("session-set", TORLINK_SESSION_SETTINGS);
}

async function readSavedRpcPort(configDir: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(path.join(configDir, "settings.json"), "utf8");
    const port = Number((JSON.parse(raw) as Record<string, unknown>)["rpc-port"]);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
  } catch {
    return null;
  }
}

async function existingEndpoint(
  configDir: string,
  fetchImpl: FetchLike,
): Promise<TransmissionEndpoint | null> {
  const port = await readSavedRpcPort(configDir);
  if (!port) return null;
  const url = `http://127.0.0.1:${port}${RPC_PATH}`;
  try {
    await waitForRpc(url, fetchImpl, 1_000);
    await configureTorLinkSession(url, fetchImpl);
    return {
      url,
      destroy: () => {
        void new TransmissionRpcClient(url, fetchImpl).closeSession().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}

export interface ManagedTransmissionDaemonOptions {
  binary?: string;
  stateDir?: string;
  rpcPort?: number;
  peerPort?: number;
  fetchImpl?: FetchLike;
  spawnImpl?: typeof spawn;
}

export class ManagedTransmissionDaemon implements DaemonRunner {
  private endpoint: TransmissionEndpoint | null = null;

  constructor(private readonly opts: ManagedTransmissionDaemonOptions = {}) {}

  async start(downloadDir: string): Promise<TransmissionEndpoint> {
    if (this.endpoint) return this.endpoint;
    const binary = this.opts.binary ?? (await findTransmissionDaemon());
    if (!binary) throw new Error(TRANSMISSION_INSTALL_HINT);

    const root = this.opts.stateDir ?? transmissionDir;
    const configDir = path.join(root, "daemon-config");
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(downloadDir, { recursive: true }).catch(() => {});
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    if (this.opts.rpcPort === undefined) {
      const existing = await existingEndpoint(configDir, fetchImpl);
      if (existing) {
        this.endpoint = existing;
        return existing;
      }
    }
    const port = this.opts.rpcPort ?? (await freeLocalPort());
    const peerPort = this.opts.peerPort ?? (await freeLocalPort());
    const url = `http://127.0.0.1:${port}${RPC_PATH}`;
    const args = [
      "--foreground",
      "--config-dir",
      configDir,
      "--download-dir",
      downloadDir,
      "--rpc-bind-address",
      "127.0.0.1",
      "--port",
      String(port),
      "--peerport",
      String(peerPort),
      "--allowed",
      "127.0.0.1",
      "--no-auth",
      "--no-portmap",
    ];
    const child = (this.opts.spawnImpl ?? spawn)(binary, args, {
      stdio: "ignore",
      detached: false,
    }) as ChildProcess;
    child.unref();
    const destroy = (): void => {
      if (child.exitCode !== null || child.signalCode) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
      }, 1_500).unref();
    };
    this.endpoint = { url, destroy };
    try {
      await waitForRpc(url, fetchImpl);
      await configureTorLinkSession(url, fetchImpl);
      return this.endpoint;
    } catch (e) {
      destroy();
      this.endpoint = null;
      throw e;
    }
  }

  destroy(): void {
    this.endpoint?.destroy();
    this.endpoint = null;
  }
}

interface TorrentRecord {
  hash: string;
  source: string;
  dir: string;
  handlers: AddHandlers;
}

function toProgress(t: TransmissionTorrent): TorrentProgress {
  const total = t.totalSize ?? 0;
  const left = t.leftUntilDone ?? Math.max(0, total - Math.round((t.percentDone ?? 0) * total));
  const downloaded = total > 0 ? Math.max(0, total - left) : 0;
  return {
    progress: Math.max(0, Math.min(1, t.percentDone ?? (total ? downloaded / total : 0))),
    downloaded,
    total,
    speed: t.rateDownload ?? 0,
    uploadSpeed: t.rateUpload ?? 0,
    uploaded: t.uploadedEver ?? 0,
    peers: t.peersConnected ?? 0,
    timeRemaining: (t.eta ?? -1) >= 0 ? (t.eta ?? 0) * 1000 : 0,
    name: t.name ?? "",
  };
}

function normalizeHash(id: string | undefined): string | null {
  const clean = id?.trim().toLowerCase();
  return clean && /^[a-f0-9]{40}$/.test(clean) ? clean : null;
}

function isHash(id: string | null): id is string {
  return id !== null;
}

export class TorrentEngine implements TorrentBackend {
  private rpc: TransmissionRpcClient | null = null;
  private endpoint: TransmissionEndpoint | null = null;
  private records = new Map<string, TorrentRecord>();
  private starting: Promise<TransmissionRpcClient> | null = null;

  constructor(private readonly runner: DaemonRunner = new ManagedTransmissionDaemon()) {}

  private hashFor(id: string): string | null {
    return this.records.get(id)?.hash ?? normalizeHash(id);
  }

  private async client(downloadDir: string): Promise<TransmissionRpcClient> {
    if (this.rpc) return this.rpc;
    if (!this.starting) {
      this.starting = this.runner.start(downloadDir).then((endpoint) => {
        this.endpoint = endpoint;
        this.rpc = new TransmissionRpcClient(endpoint.url);
        return this.rpc;
      });
    }
    return this.starting;
  }

  add(id: string, source: string, dir: string, handlers: AddHandlers): void {
    void (async () => {
      try {
        const rpc = await this.client(dir);
        const torrent = await rpc.add(source, dir);
        const hash = (torrent.hashString ?? id).toLowerCase();
        this.records.set(id, { hash, source, dir, handlers });
        handlers.onMetadata?.({
          name: torrent.name ?? "",
          total: torrent.totalSize ?? 0,
          files: 0,
        });
        await rpc.start([hash]);
      } catch (e) {
        handlers.onError?.(message(e));
      }
    })();
  }

  reconcile(ids: readonly string[], dir: string): void {
    void (async () => {
      try {
        const expected = new Set(ids.map((id) => normalizeHash(id)).filter(isHash));
        const rpc = await this.client(dir);
        const stale = (await rpc.getAll())
          .map((torrent) => normalizeHash(torrent.hashString))
          .filter((hash): hash is string => hash !== null && !expected.has(hash));
        if (stale.length > 0) await rpc.remove(stale);
      } catch {
        // Startup reconciliation is a safety net. Active adds/polls still surface
        // actionable Transmission errors through their normal handlers.
      }
    })();
  }

  pause(id: string): void {
    const hash = this.hashFor(id);
    if (!hash) return;
    void this.rpc?.stop([hash]).catch(() => {});
  }

  resume(id: string): void {
    const rec = this.records.get(id);
    if (rec) {
      void this.rpc?.start([rec.hash]).catch((e) => rec.handlers.onError?.(message(e)));
      return;
    }
  }

  remove(id: string): void {
    const hash = this.hashFor(id);
    this.records.delete(id);
    if (!hash) return;
    void this.rpc?.remove([hash]).catch(() => {});
  }

  verify(id: string): void {
    const hash = this.hashFor(id);
    if (!hash) return;
    const rec = this.records.get(id);
    void this.rpc?.verify([hash]).catch((e) => rec?.handlers.onError?.(message(e)));
  }

  async stats(id: string): Promise<TorrentProgress | null> {
    const rec = this.records.get(id);
    const hash = this.hashFor(id);
    if (!hash || !this.rpc) return null;
    const [torrent] = await this.rpc.get([hash]);
    if (!torrent) return null;
    if (torrent.error && torrent.errorString) rec?.handlers.onError?.(torrent.errorString);
    return toProgress(torrent);
  }

  destroy(): void {
    this.records.clear();
    if (this.runner.destroy) this.runner.destroy();
    else this.endpoint?.destroy();
    this.endpoint = null;
    this.rpc = null;
    this.starting = null;
  }
}
