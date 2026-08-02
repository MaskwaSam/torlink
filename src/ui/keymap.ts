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
      { keys: "↑↓←→ / hjkl", label: "Move" },
      { keys: "↵", label: "Open" },
      { keys: "tab", label: "Switch pane" },
      { keys: "esc", label: "Back" },
      { keys: "o", label: "Set download folder" },
      { keys: "v", label: "Surfshark gate" },
      { keys: "q", label: "Quit" },
    ],
  },
  {
    title: "Search",
    hints: [
      { keys: "/", label: "Edit search" },
      { keys: "↵", label: "Run search" },
      { keys: "s, ↵", label: "Details/options" },
      { keys: "t", label: "Sort" },
      { keys: "f", label: "Filter" },
      { keys: "z", label: "Hide known dead" },
      { keys: "y", label: "Copy magnet" },
      { keys: "m", label: "Paste magnet" },
    ],
  },
  {
    title: "Downloads",
    hints: [
      { keys: "↵", label: "Details" },
      { keys: "p", label: "Pause/resume" },
      { keys: "a", label: "Auto-resume" },
      { keys: "e", label: "Auto-stop seeding" },
      { keys: "del, c", label: "Delete/cancel" },
      { keys: "f", label: "Retry failed" },
      { keys: "r", label: "Verify/rescan" },
      { keys: "d", label: "Download again" },
      { keys: "x", label: "Clear recent" },
      { keys: "shift+o", label: "Open folder" },
    ],
  },
  {
    title: "Seeding",
    hints: [
      { keys: "p", label: "Pause/resume" },
      { keys: "r", label: "Verify/rescan" },
      { keys: "e", label: "Auto-stop seeding" },
      { keys: "c", label: "Remove from list" },
      { keys: "shift+o", label: "Open folder" },
    ],
  },
  {
    title: "Sources",
    hints: [
      { keys: "space, ↵", label: "Toggle" },
      { keys: "r", label: "Enable all" },
    ],
  },
];

// Footer labels stay terse so the contextual hint row never wraps; the `?`
// overlay (HELP_GROUPS) carries the full, descriptive list.
const NAVIGATE: Hint = { keys: "↑↓←→", label: "Move" };

const ALWAYS: Hint = { keys: "?", label: "Keys" };

const SWITCH: Hint = { keys: "tab", label: "Switch" };
const FOLDER: Hint = { keys: "O", label: "Folder" };

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
    return [{ keys: "p", label }, { keys: "r", label: "Verify" }, FOLDER, { keys: "c", label: "Remove" }, SWITCH, ALWAYS];
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
      return [{ keys: "↵", label: "Details" }, { keys: "p", label: "Resume" }, { keys: "r", label: "Verify" }, FOLDER, { keys: "del", label: "Delete" }, SWITCH, ALWAYS];
    }
    if (downloadFocus === "failed") {
      return [{ keys: "↵", label: "Details" }, { keys: "f", label: "Retry" }, FOLDER, { keys: "del", label: "Delete" }, SWITCH, ALWAYS];
    }
    if (downloadFocus === "recent") {
      return [
        NAVIGATE,
        { keys: "d", label: "Download again" },
        FOLDER,
        { keys: "del", label: "Delete" },
        { keys: "x", label: "Clear" },
        SWITCH,
        ALWAYS,
      ];
    }
    return [{ keys: "↵", label: "Details" }, { keys: "p", label: "Pause" }, { keys: "r", label: "Verify" }, FOLDER, { keys: "del", label: "Delete" }, SWITCH, ALWAYS];
  }
  return [
    NAVIGATE,
    { keys: "s", label: "Details" },
    { keys: "d", label: "Download" },
    { keys: "y", label: "Copy" },
    { keys: "t", label: "Sort" },
    { keys: "f", label: "Filter" },
    { keys: "/", label: "Search" },
    SWITCH,
    ALWAYS,
  ];
}
