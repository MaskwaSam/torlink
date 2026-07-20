import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { SOURCES, sourceDisplayName } from "../../sources/registry";
import { Panel } from "./Panel";
import { wrapStep, windowStart } from "../move";
import { COLOR, ICON, sourceStyle } from "../theme";
import { useStore } from "../store";
import type { Source } from "../../sources/types";

const MARK = 2;
const STATUS_W = 5;
const GROUP_W = 11;
const SRC_W = 4;
const OFF = "#7c7785";

export function Sources() {
  const { config, setConfig, region, contentWidth, listRows, setNotice } = useStore();
  const focused = region === "content";
  const disabled = new Set(config.disabledSources);
  const enabledCount = SOURCES.filter((s) => !disabled.has(s.id)).length;
  const total = SOURCES.length;
  const [cursor, setCursor] = useState(0);
  const clamped = Math.min(cursor, Math.max(0, total - 1));

  const setDisabled = (nextDisabled: Set<Source["id"]>): void => {
    setConfig({
      ...config,
      disabledSources: SOURCES.filter((s) => nextDisabled.has(s.id)).map((s) => s.id),
    });
  };

  const toggleSource = (source: Source): void => {
    const nextDisabled = new Set(config.disabledSources);
    const enabled = !nextDisabled.has(source.id);
    if (enabled && enabledCount <= 1) {
      setNotice("Keep at least one source enabled.");
      return;
    }
    if (enabled) nextDisabled.add(source.id);
    else nextDisabled.delete(source.id);
    setDisabled(nextDisabled);
    setNotice(`${sourceDisplayName(source)} ${enabled ? "disabled" : "enabled"}.`);
  };

  const enableAll = (): void => {
    if (config.disabledSources.length === 0) {
      setNotice("All sources already enabled.");
      return;
    }
    setConfig({ ...config, disabledSources: [] });
    setNotice("All sources enabled.");
  };

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") setCursor(wrapStep(clamped, -1, total));
      else if (key.downArrow || input === "j") setCursor(wrapStep(clamped, 1, total));
      else if (key.return || input === " ") {
        const source = SOURCES[clamped];
        if (source) toggleSource(source);
      } else if (input === "r") {
        enableAll();
      }
    },
    { isActive: focused && total > 0 },
  );

  const panelH = Math.max(5, listRows - 1);
  const rows = Math.max(1, panelH - 1);
  const start = windowStart(clamped, total, rows);
  const visible = SOURCES.slice(start, start + rows);

  return (
    <Panel
      title="sources"
      width={contentWidth}
      focused={focused}
      count={`(${enabledCount}/${total})`}
      height={panelH}
    >
      <Box>
        <Box width={MARK} flexShrink={0} />
        <Box width={STATUS_W} flexShrink={0}>
          <Text bold dimColor>Use</Text>
        </Box>
        <Box flexGrow={1} minWidth={0} marginLeft={1}>
          <Text bold dimColor>Source</Text>
        </Box>
        <Box width={GROUP_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
          <Text bold dimColor>Category</Text>
        </Box>
        <Box width={SRC_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
          <Text bold dimColor>Tag</Text>
        </Box>
      </Box>

      {visible.map((source, i) => {
        const here = start + i === clamped && focused;
        const enabled = !disabled.has(source.id);
        const ss = sourceStyle(source.id);
        return (
          <Box key={source.id}>
            <Box width={MARK} flexShrink={0}>
              <Text color={COLOR.accent} bold>
                {here ? ICON.pointer : ""}
              </Text>
            </Box>
            <Box width={STATUS_W} flexShrink={0}>
              <Text color={enabled ? COLOR.good : OFF} dimColor={!enabled}>
                {enabled ? ICON.done : ICON.pending} {enabled ? "on" : "off"}
              </Text>
            </Box>
            <Box flexGrow={1} minWidth={0} marginLeft={1}>
              <Text
                wrap="truncate-end"
                bold={here}
                color={here ? COLOR.accent : undefined}
                dimColor={!here || !enabled}
              >
                {sourceDisplayName(source)}
              </Text>
            </Box>
            <Box width={GROUP_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text dimColor>{source.group}</Text>
            </Box>
            <Box width={SRC_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text color={ss.color} dimColor={!here || !enabled}>
                {ss.tag}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Panel>
  );
}
