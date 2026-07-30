import { eztv } from "./eztv";
import { fitgirl } from "./fitgirl";
import { tpbAudiobooks, tpbBooks, tpbMovies, tpbMusic, tpbTv } from "./piratebay";
import { x1337Audiobooks, x1337Books, x1337Movies, x1337Music, x1337Tv } from "./x1337";
import { yts } from "./yts";
import type { Source, SourceGroup, SourceId } from "./types";

export const SOURCES: readonly Source[] = [
  fitgirl,
  yts,
  tpbMovies,
  x1337Movies,
  eztv,
  tpbTv,
  x1337Tv,
  tpbBooks,
  x1337Books,
  tpbAudiobooks,
  x1337Audiobooks,
  tpbMusic,
  x1337Music,
];

export const DEFAULT_SOURCE: Source = SOURCES[0]!;
export const ACTIVE_SOURCE_IDS = SOURCES.map((s) => s.id) as readonly SourceId[];

export function getSource(id: SourceId): Source {
  return SOURCES.find((s) => s.id === id) ?? DEFAULT_SOURCE;
}

export function sourceDisplayName(source: Source): string {
  const duplicate = SOURCES.some((s) => s.id !== source.id && s.label === source.label);
  return duplicate ? `${source.label} ${source.group}` : source.label;
}

export function activeSources(disabledSources: readonly SourceId[] = []): Source[] {
  const disabled = new Set(disabledSources);
  return SOURCES.filter((s) => !disabled.has(s.id));
}

const GROUP_ORDER: readonly SourceGroup[] = [
  "Games",
  "Movies",
  "TV",
  "Books",
  "Audiobooks",
  "Music",
];

export function sourcesByGroup(): { group: SourceGroup; sources: Source[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    sources: SOURCES.filter((s) => s.group === group),
  })).filter((g) => g.sources.length > 0);
}
