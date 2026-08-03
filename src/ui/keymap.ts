import type { DownloadFocus, Region, Section, SeedFocus } from "./store";

export interface Hint {
  keys: string;
  label: string;
}

export interface HelpGroup {
  title: string;
  hints: Hint[];
}

export const HELP_GROUPS: HelpGroup[] = [
  {
    title: "Navigate",
    hints: [
      { keys: "↑↓←→ / hjkl", label: "Move in panes/lists" },
      { keys: "wheel", label: "Scroll lists" },
      { keys: "pgup / pgdn", label: "Jump through results" },
      { keys: "↵", label: "Open / choose" },
      { keys: "tab", label: "Switch pane" },
      { keys: "esc", label: "Back/cancel (start: quit)" },
      { keys: "o", label: "Set download folder" },
      { keys: "v", label: "Surfshark gate" },
      { keys: "q, ^c", label: "Quit" },
      { keys: "?", label: "Open / close help" },
      { keys: "←→ / hl", label: "Change help page" },
    ],
  },
  {
    title: "Search",
    hints: [
      { keys: "/", label: "Edit search" },
      { keys: "↵", label: "Search / open details" },
      { keys: "s", label: "Details / options" },
      { keys: "t", label: "Sort results" },
      { keys: "f", label: "Filter current list" },
      { keys: "z", label: "Hide known dead" },
      { keys: "d", label: "Download" },
      { keys: "y", label: "Copy magnet" },
      { keys: "m", label: "Paste magnet" },
      { keys: "tab / ↓", label: "Browse / leave field" },
      { keys: "↑ / k at top", label: "Focus search field" },
    ],
  },
  {
    title: "Downloads",
    hints: [
      { keys: "↵", label: "Details / redownload" },
      { keys: "p", label: "Pause/resume" },
      { keys: "a", label: "Toggle auto-resume" },
      { keys: "e", label: "Toggle auto-stop seed" },
      { keys: "⌫, del, c", label: "Cancel / remove" },
      { keys: "f", label: "Retry failed" },
      { keys: "r", label: "Verify/rescan" },
      { keys: "d", label: "Download again" },
      { keys: "x", label: "Clear recent list" },
      { keys: "O (shift+o)", label: "Open folder" },
    ],
  },
  {
    title: "Seeding",
    hints: [
      { keys: "p", label: "Pause/resume" },
      { keys: "r", label: "Verify/rescan" },
      { keys: "e", label: "Toggle auto-stop seed" },
      { keys: "c", label: "Remove from list" },
      { keys: "O (shift+o)", label: "Open folder" },
    ],
  },
  {
    title: "Sources",
    hints: [
      { keys: "space, ↵", label: "Toggle" },
      { keys: "r", label: "Enable all" },
    ],
  },
  {
    title: "Text fields",
    hints: [
      { keys: "← / →", label: "Move cursor; ← exits edge" },
      { keys: "ctrl/⌥ + ←→", label: "Move by word" },
      { keys: "home / end", label: "Line start / end" },
      { keys: "^a / ^e", label: "Line start / end" },
      { keys: "⌫ / del", label: "Delete character" },
      { keys: "ctrl/⌥ + ⌫/del", label: "Delete word" },
      { keys: "^w / ⌥d", label: "Delete word" },
      { keys: "^u", label: "Clear field" },
      { keys: "^k", label: "Delete to end" },
      { keys: "↵", label: "Submit" },
      { keys: "tab / ↓", label: "Leave field" },
      { keys: "esc", label: "Cancel" },
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
      ALWAYS,
      NAVIGATE,
      { keys: "↵", label: "Open" },
      SWITCH,
      { keys: "q", label: "Quit" },
    ];
  }
  if (section === "seeding") {
    const label =
      seedFocus === "seeding" ? "Pause" : seedFocus === "missing" ? "Retry" : "Resume";
    return [ALWAYS, { keys: "p", label }, { keys: "r", label: "Verify" }, FOLDER, { keys: "c", label: "Remove" }, SWITCH];
  }
  if (section === "sources") {
    return [
      ALWAYS,
      NAVIGATE,
      { keys: "space", label: "Toggle" },
      { keys: "r", label: "All on" },
      SWITCH,
    ];
  }
  if (section === "downloads") {
    if (downloadFocus === "paused") {
      return [ALWAYS, { keys: "↵", label: "Details" }, { keys: "p", label: "Resume" }, { keys: "r", label: "Verify" }, FOLDER, { keys: "del", label: "Delete" }, SWITCH];
    }
    if (downloadFocus === "failed") {
      return [ALWAYS, { keys: "↵", label: "Details" }, { keys: "f", label: "Retry" }, { keys: "r", label: "Verify" }, FOLDER, { keys: "del", label: "Delete" }, SWITCH];
    }
    if (downloadFocus === "recent") {
      return [
        ALWAYS,
        NAVIGATE,
        { keys: "d", label: "Download again" },
        FOLDER,
        { keys: "del", label: "Delete" },
        { keys: "x", label: "Clear" },
        SWITCH,
      ];
    }
    return [ALWAYS, { keys: "↵", label: "Details" }, { keys: "p", label: "Pause" }, { keys: "r", label: "Verify" }, FOLDER, { keys: "del", label: "Delete" }, SWITCH];
  }
  return [
    ALWAYS,
    NAVIGATE,
    { keys: "s", label: "Details" },
    { keys: "d", label: "Download" },
    { keys: "y", label: "Copy" },
    { keys: "t", label: "Sort" },
    { keys: "f", label: "Filter" },
    { keys: "/", label: "Search" },
    SWITCH,
  ];
}
