import type { SourceId } from "../sources/types";

export type DownloadStatus = "downloading" | "paused" | "completed" | "failed";

export type SeedStatus = "seeding" | "paused" | "missing";

export type PauseReason = "network";

export type DownloadBackend = "transmission";

export interface SeedItem {
  id: string;
  backend?: DownloadBackend;
  name: string;
  source?: SourceId;
  magnet: string;
  dir: string;
  sizeBytes: number;
  status: SeedStatus;
  uploadSpeed: number;
  uploaded: number;
  peers: number;
  pauseReason?: PauseReason;
}

export interface QueueItem {
  id: string;
  backend?: DownloadBackend;
  name: string;
  source?: SourceId;
  magnet: string;
  dir: string;
  status: DownloadStatus;
  progress: number;
  totalBytes: number;
  downloadedBytes: number;
  speed: number;
  peers: number;
  eta?: number;
  files?: number;
  error?: string;
  addedAt: number;
  pauseReason?: PauseReason;
}
