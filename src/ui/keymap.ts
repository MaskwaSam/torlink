import type { DownloadFocus, Region, Section, SeedFocus } from "./store";

export interface Hint {
  keys: string;
  label: string;
}

interface HelpGroup {
  title: string;
  hints: Hint[];
}

export const HELP_GROUPS: HelpGroup[] = [
  {
    title: "Navigate",
    hints: [
      { keys: "↑ ↓ ← →, h j k l", label: "Navigate content and panes" },
      { keys: "↵", label: "Open" },
      { keys: "tab", label: "Switch pane" },
      { keys: "esc", label: "Back" },
      { keys: "o", label: "Download folder" },
      { keys: "v", label: "Toggle Surfshark requirement" },
      { keys: "q", label: "Quit" },
    ],
  },
  {
    title: "Search",
    hints: [
      { keys: "/", label: "Edit search" },
      { keys: "↵", label: "Run search" },
      { keys: "s", label: "Sort results" },
      { keys: "y", label: "Copy magnet" },
      { keys: "m", label: "Paste magnet" },
    ],
  },
  {
    title: "Downloads",
    hints: [
      { keys: "p", label: "Pause/resume" },
      { keys: "a", label: "Toggle auto-resume" },
      { keys: "e", label: "Toggle auto-stop seeding" },
      { keys: "del, c", label: "Delete/cancel highlighted item" },
      { keys: "f", label: "Retry failed" },
      { keys: "r", label: "Verify/rescan highlighted torrent" },
      { keys: "d", label: "Download again" },
      { keys: "x", label: "Clear recent" },
    ],
  },
  {
    title: "Seeding",
    hints: [
      { keys: "p", label: "Pause/resume" },
      { keys: "r", label: "Verify/rescan" },
      { keys: "e", label: "Toggle auto-stop seeding" },
      { keys: "c", label: "Remove from list" },
    ],
  },
  {
    title: "Sources",
    hints: [
      { keys: "space, ↵", label: "Toggle source" },
      { keys: "r", label: "Enable all sources" },
    ],
  },
];

// Footer labels stay terse so the contextual hint row never wraps; the `?`
// overlay (HELP_GROUPS) carries the full, descriptive list.
const NAVIGATE: Hint = { keys: "↑↓←→", label: "Move" };

const ALWAYS: Hint = { keys: "?", label: "Keys" };

const SWITCH: Hint = { keys: "tab", label: "Switch" };

export function footerHints(
  region: Region,
  section: Section,
  downloadFocus?: DownloadFocus | null,
  seedFocus?: SeedFocus | null,
): Hint[] {
  if (region === "sidebar") {
    return [
      NAVIGATE,
      { keys: "↵", label: "Open" },
      SWITCH,
      ALWAYS,
      { keys: "q", label: "Quit" },
    ];
  }
  if (section === "seeding") {
    const label =
      seedFocus === "seeding" ? "Pause" : seedFocus === "missing" ? "Retry" : "Resume";
    return [{ keys: "p", label }, { keys: "r", label: "Verify" }, { keys: "c", label: "Remove" }, SWITCH, ALWAYS];
  }
  if (section === "sources") {
    return [
      NAVIGATE,
      { keys: "space", label: "Toggle" },
      { keys: "r", label: "All on" },
      SWITCH,
      ALWAYS,
    ];
  }
  if (section === "downloads") {
    if (downloadFocus === "paused") {
      return [{ keys: "p", label: "Resume" }, { keys: "r", label: "Verify" }, { keys: "del", label: "Delete" }, SWITCH, ALWAYS];
    }
    if (downloadFocus === "failed") {
      return [{ keys: "f", label: "Retry" }, { keys: "del", label: "Delete" }, SWITCH, ALWAYS];
    }
    if (downloadFocus === "recent") {
      return [
        NAVIGATE,
        { keys: "d", label: "Download again" },
        { keys: "del", label: "Delete" },
        { keys: "x", label: "Clear" },
        SWITCH,
        ALWAYS,
      ];
    }
    return [{ keys: "p", label: "Pause" }, { keys: "r", label: "Verify" }, { keys: "del", label: "Delete" }, SWITCH, ALWAYS];
  }
  return [
    NAVIGATE,
    { keys: "d", label: "Download" },
    { keys: "y", label: "Copy" },
    { keys: "s", label: "Sort" },
    { keys: "/", label: "Search" },
    SWITCH,
    ALWAYS,
  ];
}
