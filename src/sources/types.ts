export const SOURCE_IDS = [
  "fitgirl",
  "yts",
  "eztv",
  "nyaa",
  "subsplease",
  "tpb-movies",
  "tpb-tv",
  "tpb-books",
  "tpb-audiobooks",
  "tpb-music",
  "x1337-movies",
  "x1337-tv",
  "x1337-books",
  "x1337-audiobooks",
  "x1337-music",
] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

export type SourceGroup = "Games" | "Movies" | "TV" | "Anime" | "Books" | "Audiobooks" | "Music";

export interface TorrentResult {
  infoHash: string;
  name: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  numFiles?: number;
  source: SourceId;
  magnet: string;
  added?: number;
}

export interface SearchOptions {
  signal?: AbortSignal;
}

export interface Source {
  id: SourceId;
  label: string;
  group: SourceGroup;
  homepage: string;
  search(query: string, opts?: SearchOptions): Promise<TorrentResult[]>;
}
