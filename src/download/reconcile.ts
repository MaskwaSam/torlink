import type { QueueItem } from "./types";

export function reconcileQueue(items: QueueItem[]): QueueItem[] {
  const seen = new Set<string>();
  const out: QueueItem[] = [];
  for (const it of items) {
    if (!it?.id || seen.has(it.id)) continue;
    seen.add(it.id);
    if (it.status === "completed") continue;
    const legacy = it.backend !== "transmission";
    const status = legacy
      ? "paused"
      : it.status === "failed"
        ? "failed"
        : it.status === "paused"
          ? "paused"
          : "downloading";
    out.push({
      ...it,
      status,
      speed: 0,
      peers: 0,
      eta: undefined,
      pauseReason: legacy ? undefined : it.pauseReason,
    });
  }
  return out;
}
