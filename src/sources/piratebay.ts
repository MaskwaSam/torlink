import { fetchResilient, HttpError, readResponseJson, USER_AGENT } from "../util/net";
import { buildMagnet, parseInfoHash } from "./magnet";
import type { SearchOptions, Source, SourceId, TorrentResult } from "./types";

const API = "https://apibay.org";

const MOVIE_CATS = new Set([201, 202, 207, 209]);
const TV_CATS = new Set([205, 208]);
const BOOK_CATS = new Set([601, 602]);
const AUDIOBOOK_CATS = new Set([102]);
const MUSIC_CATS = new Set([101, 104]);

const TOP_MOVIES = `${API}/precompiled/data_top100_207.json`;
const TOP_TV = `${API}/precompiled/data_top100_208.json`;
const TOP_BOOKS = `${API}/precompiled/data_top100_601.json`;
const TOP_AUDIOBOOKS = `${API}/precompiled/data_top100_102.json`;
const TOP_MUSIC = `${API}/precompiled/data_top100_101.json`;

interface ApibayItem {
  id?: string;
  name?: string;
  info_hash?: string;
  seeders?: string;
  leechers?: string;
  num_files?: string;
  size?: string;
  added?: string;
  category?: string;
}

const ZERO_HASH = "0000000000000000000000000000000000000000";

function toResult(it: ApibayItem, source: SourceId): TorrentResult | null {
  const infoHash = parseInfoHash(it.info_hash ?? "");
  if (!infoHash || infoHash === ZERO_HASH || it.id === "0") return null;
  const name = it.name || "Unknown";
  const numFiles = Number(it.num_files);
  return {
    infoHash,
    name,
    sizeBytes: Number(it.size) || 0,
    seeders: Number(it.seeders) || 0,
    leechers: Number(it.leechers) || 0,
    numFiles: Number.isFinite(numFiles) && numFiles > 0 ? numFiles : undefined,
    source,
    magnet: buildMagnet(infoHash, name),
    added: Number(it.added) || undefined,
  };
}

async function fetchItems(url: string, opts: SearchOptions): Promise<ApibayItem[]> {
  const res = await fetchResilient(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
    retries: 1,
  });
  if (!res.ok) throw new HttpError(res.status, `Pirate Bay returned ${res.status}`);
  const json = await readResponseJson<ApibayItem[]>(res);
  return Array.isArray(json) ? json : [];
}

async function search(
  query: string,
  cats: Set<number>,
  browseUrl: string,
  source: SourceId,
  opts: SearchOptions,
): Promise<TorrentResult[]> {
  const q = query.trim();
  const items = await fetchItems(
    q ? `${API}/q.php?q=${encodeURIComponent(q)}` : browseUrl,
    opts,
  );
  const out: TorrentResult[] = [];
  for (const it of items) {
    if (q && !cats.has(Number(it.category))) continue;
    const r = toResult(it, source);
    if (r) out.push(r);
  }
  return out;
}

export const tpbMovies: Source = {
  id: "tpb-movies",
  label: "TPB",
  group: "Movies",
  homepage: "https://thepiratebay.org",
  search: (query, opts = {}) => search(query, MOVIE_CATS, TOP_MOVIES, "tpb-movies", opts),
};

export const tpbTv: Source = {
  id: "tpb-tv",
  label: "TPB",
  group: "TV",
  homepage: "https://thepiratebay.org",
  search: (query, opts = {}) => search(query, TV_CATS, TOP_TV, "tpb-tv", opts),
};

export const tpbBooks: Source = {
  id: "tpb-books",
  label: "TPB",
  group: "Books",
  homepage: "https://thepiratebay.org",
  search: (query, opts = {}) => search(query, BOOK_CATS, TOP_BOOKS, "tpb-books", opts),
};

export const tpbAudiobooks: Source = {
  id: "tpb-audiobooks",
  label: "TPB",
  group: "Audiobooks",
  homepage: "https://thepiratebay.org",
  search: (query, opts = {}) =>
    search(query, AUDIOBOOK_CATS, TOP_AUDIOBOOKS, "tpb-audiobooks", opts),
};

export const tpbMusic: Source = {
  id: "tpb-music",
  label: "TPB",
  group: "Music",
  homepage: "https://thepiratebay.org",
  search: (query, opts = {}) => search(query, MUSIC_CATS, TOP_MUSIC, "tpb-music", opts),
};
