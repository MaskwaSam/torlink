import { getSource } from "../sources/registry";
import type { TorrentResult } from "../sources/types";

export function filterResults(
  list: readonly TorrentResult[],
  hideDead: boolean,
  textFilter = "",
): TorrentResult[] {
  let filtered = [...list];

  if (hideDead) {
    filtered = filtered.filter(
      (result) => result.seeders > 0 || !getSource(result.source).reportsHealth,
    );
  }

  const tokens = textFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return filtered;

  const phrase = tokens.join(" ");
  return filtered
    .map((result) => {
      const name = result.name.toLowerCase();
      if (!tokens.every((token) => name.includes(token))) return null;

      let score = 10;
      if (name.includes(phrase)) {
        score += 50;
      } else {
        let lastIndex = -1;
        let inOrder = true;
        for (const token of tokens) {
          const index = name.indexOf(token, lastIndex + 1);
          if (index < 0) {
            inOrder = false;
            break;
          }
          lastIndex = index;
        }
        if (inOrder) score += 20;
      }
      return { result, score };
    })
    .filter((entry): entry is { result: TorrentResult; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.result);
}
