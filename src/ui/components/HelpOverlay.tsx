import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { buildHelpPages, helpHintsPerPage } from "../helpPages";
import { HELP_GROUPS } from "../keymap";
import { useStore } from "../store";
import { COLOR, ICON, RULE, lerpHex } from "../theme";

const CARD_BORDER = lerpHex(COLOR.accent, RULE, 0.55);
const FRAME = 4;
const KEY_GAP = 2;
const FOOTER = `←/→ page ${ICON.dot} ?/esc close ${ICON.dot} q quit`;

export function HelpOverlay() {
  const { cols, rows } = useStore();
  const pages = useMemo(
    () => buildHelpPages(HELP_GROUPS, helpHintsPerPage(rows)),
    [rows],
  );
  const [pageIndex, setPageIndex] = useState(0);
  const clamped = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const page = pages[clamped]!;

  useEffect(() => {
    if (pageIndex !== clamped) setPageIndex(clamped);
  }, [pageIndex, clamped]);

  useInput((input, key) => {
    if (key.leftArrow || input === "h") {
      setPageIndex((current) => (current - 1 + pages.length) % pages.length);
    } else if (key.rightArrow || input === "l") {
      setPageIndex((current) => (current + 1) % pages.length);
    }
  });

  const keyWidth = Math.max(...page.hints.map((hint) => hint.keys.length)) + KEY_GAP;
  const labelWidth = Math.max(...page.hints.map((hint) => hint.label.length));
  const part = page.parts > 1 ? ` ${page.part}/${page.parts}` : "";
  const heading = `Keyboard ${ICON.dot} ${page.title}${part} ${ICON.dot} ${clamped + 1}/${pages.length}`;
  const desiredWidth = Math.max(
    keyWidth + labelWidth + FRAME,
    heading.length + FRAME,
    FOOTER.length + FRAME,
  );
  const width = Math.max(1, Math.min(desiredWidth, cols - 2));

  return (
    <Box
      flexDirection="column"
      alignSelf="flex-start"
      width={width}
      borderStyle="round"
      borderColor={CARD_BORDER}
      paddingX={1}
    >
      <Text bold color={COLOR.accent} wrap="truncate-end">
        {heading}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {page.hints.map((hint) => (
          <Box key={hint.keys + hint.label}>
            <Box width={keyWidth} flexShrink={0}>
              <Text color={COLOR.alt} wrap="truncate-end">
                {hint.keys}
              </Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {hint.label}
            </Text>
          </Box>
        ))}
      </Box>
      <Text dimColor wrap="truncate-end">
        {FOOTER}
      </Text>
    </Box>
  );
}
