import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout, useStdin } from "ink";
import { promises as fs } from "node:fs";
import { loadConfig, saveConfig, type Config } from "../config/config";
import { normalizeDownloadDir } from "../config/folder";
import { DownloadQueue } from "../download/queue";
import { loadQueue, loadSeeds } from "../download/persist";
import { loadHistory } from "../download/history";
import { reconcileQueue } from "../download/reconcile";
import { parseInput } from "../sources/magnet";
import { magnetFromTorrentFile } from "../sources/torrentFile";
import { readClipboard, writeClipboard } from "../util/clipboard";
import { cleanText, terminalSafeText, truncate } from "../util/format";
import {
  StoreContext,
  type CaptureMode,
  type DownloadFocus,
  type Region,
  type Section,
  type SeedFocus,
  type Store,
  type View,
} from "./store";
import { Logo } from "./components/Logo";
import { Sidebar, RAIL_WIDTH } from "./components/Sidebar";
import { Rule } from "./components/Rule";
import { Footer } from "./components/Footer";
import { HelpOverlay } from "./components/HelpOverlay";
import { Results } from "./components/Results";
import { Downloads } from "./components/Downloads";
import { Seeding } from "./components/Seeding";
import { Sources } from "./components/Sources";
import { Spinner } from "./components/Spinner";
import { TabTitle } from "./components/TabTitle";
import { Splash } from "./views/Splash";
import { FolderPrompt } from "./components/FolderPrompt";
import { footerHints } from "./keymap";
import { COLOR, ICON } from "./theme";
import { useMouseWheel } from "./hooks/useMouseWheel";
import { useVpnStatus } from "./hooks/useVpnStatus";
import type { SourceId } from "../sources/types";

export function App({
  initialMagnet,
  initialTorrent,
  onQuit,
}: { initialMagnet?: string; initialTorrent?: string; onQuit?: () => void } = {}) {
  useMouseWheel();
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const vpn = useVpnStatus();

  const [size, setSize] = useState({
    rows: stdout?.rows ?? 24,
    cols: stdout?.columns ?? 80,
  });
  useEffect(() => {
    if (!stdout) return;
    let last = { rows: stdout.rows ?? 24, cols: stdout.columns ?? 80 };
    const onResize = (): void => {
      const next = { rows: stdout.rows ?? 24, cols: stdout.columns ?? 80 };
      if (next.rows === last.rows && next.cols === last.cols) return;
      if (next.rows < last.rows || next.cols < last.cols) {
        stdout.write("\x1b[2J\x1b[H");
      }
      last = next;
      setSize(next);
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  const rows = size.rows;
  const cols = size.cols;

  const [queue, setQueue] = useState<DownloadQueue | null>(null);
  const [config, setConfigState] = useState<Config | null>(null);
  const [view, setView] = useState<View>("splash");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<Section>("all");
  const [region, setRegion] = useState<Region>("content");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("none");
  const [downloadFocus, setDownloadFocus] = useState<DownloadFocus | null>(null);
  const [seedFocus, setSeedFocus] = useState<SeedFocus | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [editingFolder, setEditingFolder] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const booting = useRef(false);
  const networkAllowed = config ? !config.requireSurfsharkVpn || vpn.ok : vpn.ok;

  const requireVpn = useCallback((): boolean => {
    if (!config?.requireSurfsharkVpn || vpn.ok) return true;
    setNotice(vpn.reason);
    return false;
  }, [config?.requireSurfsharkVpn, vpn.ok, vpn.reason]);

  useEffect(() => {
    if (booting.current) return;
    booting.current = true;
    let alive = true;
    void (async () => {
      const cfg = await loadConfig();
      const q = new DownloadQueue();
      q.setTrackers(cfg.trackers);
      q.setAutoResumeTorrents(cfg.autoResumeTorrents);
      q.setAutoStopSeeding(cfg.autoStopSeeding);
      q.setNetworkAllowed(!cfg.requireSurfsharkVpn || vpn.ok);
      q.restore(reconcileQueue(await loadQueue()));
      q.restoreHistory(await loadHistory());
      q.restoreSeeds(await loadSeeds());
      if (!alive) {
        q.suspend();
        return;
      }
      setConfigState(cfg);
      setQueue(q);
      if (cfg.requireSurfsharkVpn && !vpn.ok) setNotice(vpn.reason);
      const launch = initialMagnet
        ? parseInput(initialMagnet)
        : initialTorrent
          ? await magnetFromTorrentFile(initialTorrent)
          : null;
      if (launch) {
        if (cfg.requireSurfsharkVpn && !vpn.ok) {
          setNotice(vpn.reason);
          setView("browser");
          setSection("downloads");
          setRegion("content");
          return;
        }
        await fs.mkdir(cfg.downloadDir, { recursive: true }).catch(() => {});
        q.add(
          { id: launch.infoHash, name: launch.name, magnet: launch.magnet },
          cfg.downloadDir,
        );
        setView("browser");
        setSection("downloads");
        setRegion("content");
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialMagnet, initialTorrent, vpn.ok, vpn.reason]);

  useEffect(() => {
    if (!queue || !config) return;
    const allowed = !config.requireSurfsharkVpn || vpn.ok;
    queue.setNetworkAllowed(allowed);
    if (config.requireSurfsharkVpn && !vpn.ok) setNotice(vpn.reason);
  }, [queue, config, vpn.ok, vpn.reason]);

  useEffect(() => {
    if (!queue) return;
    const onCompleted = (name: string): void =>
      setNotice(`${ICON.done} ${truncate(cleanText(name), 40)}`);
    queue.on("completed", onCompleted);
    return () => {
      queue.off("completed", onCompleted);
    };
  }, [queue]);

  useEffect(
    () => () => {
      queue?.suspend();
    },
    [queue],
  );

  const quitAll = useCallback(() => {
    // Flush all state synchronously up front so nothing is lost to the hard
    // exit; the unmount effect still runs suspend() for the engine teardown.
    queue?.persistSync();
    if (onQuit) onQuit();
    else exit();
  }, [queue, onQuit, exit]);

  const setConfig = useCallback(
    (c: Config) => {
      setConfigState(c);
      queue?.setTrackers(c.trackers);
      queue?.setAutoResumeTorrents(c.autoResumeTorrents);
      queue?.setAutoStopSeeding(c.autoStopSeeding);
      queue?.setNetworkAllowed(!c.requireSurfsharkVpn || vpn.ok);
      void saveConfig(c);
    },
    [queue, vpn.ok],
  );

  const toggleAutoResume = useCallback(() => {
    if (!config) return;
    const autoResumeTorrents = !config.autoResumeTorrents;
    setConfig({ ...config, autoResumeTorrents });
    setNotice(`Torrent auto-resume ${autoResumeTorrents ? "on" : "off"}.`);
  }, [config, setConfig]);

  const toggleSurfsharkRequirement = useCallback(() => {
    if (!config) return;
    const requireSurfsharkVpn = !config.requireSurfsharkVpn;
    setConfig({ ...config, requireSurfsharkVpn });
    setNotice(`Surfshark requirement ${requireSurfsharkVpn ? "on" : "off"}.`);
  }, [config, setConfig]);

  const toggleAutoStopSeeding = useCallback(() => {
    if (!config) return;
    const autoStopSeeding = !config.autoStopSeeding;
    setConfig({ ...config, autoStopSeeding });
    setNotice(`Auto-stop seeding ${autoStopSeeding ? "on" : "off"}.`);
  }, [config, setConfig]);

  const closeFolderPrompt = useCallback(() => {
    setEditingFolder(false);
  }, []);

  const setDownloadDir = useCallback(
    (raw: string) => {
      closeFolderPrompt();
      const dir = normalizeDownloadDir(raw);
      if (!config || !dir || dir === config.downloadDir) {
        if (config && dir && dir === config.downloadDir) setNotice("Download folder unchanged.");
        return;
      }
      void (async () => {
        try {
          await fs.mkdir(dir, { recursive: true });
        } catch {
          setNotice(`Couldn't use folder: ${truncate(dir, 48)}`);
          return;
        }
        setConfig({ ...config, downloadDir: dir });
        setNotice(`Download folder: ${truncate(dir, 48)}`);
      })();
    },
    [config, setConfig, closeFolderPrompt],
  );

  const startDownload = useCallback(
    (input: {
      id: string;
      name: string;
      magnet: string;
      source?: SourceId;
      sizeBytes?: number;
    }) => {
      if (!config || !queue) return;
      if (!requireVpn()) return;
      void fs.mkdir(config.downloadDir, { recursive: true }).catch(() => {});
      queue.add(input, config.downloadDir);
      setNotice(`Added: ${truncate(cleanText(input.name), 40)}`);
      setSection("downloads");
      setRegion("content");
    },
    [config, queue, requireVpn],
  );

  const copyMagnet = useCallback((input: { name: string; magnet: string }) => {
    void (async () => {
      const ok = await writeClipboard(input.magnet);
      if (ok) {
        setNotice(`Copied magnet: ${truncate(cleanText(input.magnet), 60)}`);
        return;
      }
      setNotice(`Couldn't copy magnet for ${truncate(cleanText(input.name), 32)}.`);
    })();
  }, []);

  const submitQuery = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (q) {
        const magnet = parseInput(q);
        if (magnet) {
          startDownload({
            id: magnet.infoHash,
            name: magnet.name,
            magnet: magnet.magnet,
          });
          setView("browser");
          return;
        }
      }
      if (!requireVpn()) {
        setView("browser");
        setRegion("content");
        return;
      }
      setQuery(q);
      setView("browser");
      if (section === "downloads") setSection("all");
      setRegion("content");
    },
    [section, startDownload, requireVpn],
  );

  const pasteFromClipboard = useCallback(async () => {
    const text = (await readClipboard()).trim();
    if (!text) {
      setNotice("Clipboard is empty.");
      return;
    }
    const found = text.match(/magnet:\?xt=urn:btih:[^\s"'<>]+/i)?.[0];
    const magnet = parseInput(found ?? text);
    if (magnet) {
      startDownload({ id: magnet.infoHash, name: magnet.name, magnet: magnet.magnet });
      setView("browser");
      return;
    }
    setNotice("No magnet link on the clipboard.");
  }, [startDownload]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const compact = rows < 18;
  const showTopRule = !compact;
  const showFooter = rows >= 12;
  const chrome =
    3 +
    (showTopRule ? 1 : 0) +
    (compact ? 0 : 1) +
    (showFooter ? 1 : 0);
  const bodyH = Math.max(6, rows - 1 - chrome);
  const listRows = Math.max(4, bodyH);
  const contentWidth = Math.max(24, cols - RAIL_WIDTH - 3);
  const ruleWidth = Math.max(10, cols - 2);
  const safeNotice = notice ? terminalSafeText(notice) : null;
  const noticeColor = networkAllowed ? COLOR.good : COLOR.warn;

  const store: Store | null = useMemo(() => {
    if (!queue || !config) return null;
    return {
      config,
      setConfig,
      queue,
      vpn,
      networkAllowed,
      view,
      setView,
      query,
      submitQuery,
      section,
      setSection,
      region: showHelp || editingFolder ? "help" : region,
      setRegion,
      captureMode,
      setCaptureMode,
      downloadFocus,
      setDownloadFocus,
      seedFocus,
      setSeedFocus,
      startDownload,
      copyMagnet,
      notice,
      setNotice,
      quitAll,
      listRows,
      compact,
      contentWidth,
      cols,
      rows,
    };
  }, [
    queue,
    config,
    vpn,
    networkAllowed,
    view,
    query,
    submitQuery,
    section,
    region,
    showHelp,
    editingFolder,
    captureMode,
    downloadFocus,
    seedFocus,
    startDownload,
    copyMagnet,
    notice,
    listRows,
    compact,
    contentWidth,
    cols,
    rows,
    setConfig,
    toggleAutoResume,
    toggleAutoStopSeeding,
    toggleSurfsharkRequirement,
    quitAll,
  ]);

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        quitAll();
        return;
      }
      if (editingFolder) return; // the prompt owns input (its own esc + enter)
      if (captureMode === "text") return;
      if (showHelp) {
        setShowHelp(false);
        return;
      }
      if (input === "?") {
        setShowHelp(true);
        return;
      }
      if (input === "o") {
        setShowHelp(false);
        setEditingFolder(true);
        return;
      }
      if (input === "m") {
        void pasteFromClipboard();
        return;
      }
      if (input === "a") {
        toggleAutoResume();
        return;
      }
      if (input === "v") {
        toggleSurfsharkRequirement();
        return;
      }
      if (input === "e") {
        toggleAutoStopSeeding();
        return;
      }
      if (key.tab) {
        setRegion(region === "sidebar" ? "content" : "sidebar");
        return;
      }
      if (key.rightArrow || input === "l") {
        if (region === "sidebar") setRegion("content");
        return;
      }
      if (key.leftArrow || input === "h") {
        if (region === "content") setRegion("sidebar");
        return;
      }
      if (key.escape) {
        if (captureMode === "esc") return;
        if (region === "content") {
          setRegion("sidebar");
          return;
        }
        setView("splash");
        return;
      }
      if (input === "q") {
        quitAll();
        return;
      }
    },
    { isActive: isRawModeSupported && view === "browser" && !!store },
  );

  if (!store) {
    return (
      <Box height={rows} justifyContent="center" alignItems="center">
        <Spinner label="Starting torlink" />
      </Box>
    );
  }

  if (view === "splash") {
    return (
      <StoreContext.Provider value={store}>
        <TabTitle />
        <Splash />
      </StoreContext.Provider>
    );
  }

  return (
    <StoreContext.Provider value={store}>
      <TabTitle />
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Logo />
          {safeNotice ? <Text color={noticeColor}>{safeNotice}</Text> : null}
        </Box>
        {showTopRule ? <Rule width={ruleWidth} /> : null}

        {showHelp ? (
          <Box marginTop={1}>
            <HelpOverlay />
          </Box>
        ) : null}

        {editingFolder ? (
          <Box marginTop={1}>
            <FolderPrompt
              width={Math.max(24, Math.min(cols - 4, 62))}
              value={store.config.downloadDir}
              onSubmit={setDownloadDir}
              onCancel={closeFolderPrompt}
            />
          </Box>
        ) : null}

        <Box
          height={bodyH}
          marginTop={compact ? 0 : 1}
          display={showHelp || editingFolder ? "none" : "flex"}
          overflow="hidden"
        >
          <Sidebar />
          <Box flexGrow={1} flexDirection="column">
            {section === "downloads" ? (
              <Downloads />
            ) : section === "seeding" ? (
              <Seeding />
            ) : section === "sources" ? (
              <Sources />
            ) : (
              <Results />
            )}
          </Box>
        </Box>

        {showFooter ? (
          <Box display={showHelp || editingFolder ? "none" : "flex"}>
            <Footer hints={footerHints(region, section, downloadFocus, seedFocus)} />
          </Box>
        ) : null}
      </Box>
    </StoreContext.Provider>
  );
}
