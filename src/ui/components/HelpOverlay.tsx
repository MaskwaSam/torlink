import { Box, Text } from "ink";
import {
  COL_GAP,
  FRAME,
  FULL_HELP_CHROME_ROWS,
  KEY_W,
  fitColumnWidths,
  pickLayout,
} from "../helpLayout";
import { HELP_GROUPS } from "../keymap";
import { useStore } from "../store";
import { COLOR, ICON, RULE, lerpHex } from "../theme";

const CARD_BORDER = lerpHex(COLOR.accent, RULE, 0.55);
const FOOT_FULL = "Your downloaded files always stay on disk.";

export function HelpOverlay() {
  const { cols, rows } = useStore();
  // Leave room for the three-line app logo, rule/margin, and the compact
  // card's border/title/footer. Labels can truncate; every shortcut stays.
  const measured = pickLayout(cols, Math.max(1, rows - 9));
  const width = Math.max(1, Math.min(measured.width, cols - 2));
  const colWidths = fitColumnWidths(measured, width);
  const short =
    rows < measured.gridH + FULL_HELP_CHROME_ROWS || width - FRAME < FOOT_FULL.length;

  return (
    <Box
      flexDirection="column"
      alignSelf="flex-start"
      width={width}
      borderStyle="round"
      borderColor={CARD_BORDER}
      paddingX={1}
      paddingY={short ? 0 : 1}
    >
      <Text bold color={COLOR.accent}>
        Keyboard
      </Text>
      <Box marginTop={short ? 0 : 1} flexDirection="row">
        {measured.layout.map((column, columnIndex) => (
          <Box
            key={column.join("-")}
            flexDirection="column"
            width={colWidths[columnIndex]}
            marginRight={columnIndex < measured.layout.length - 1 ? COL_GAP : 0}
          >
            {column.map((groupIndex, position) => {
              const group = HELP_GROUPS[groupIndex]!;
              return (
                <Box
                  key={group.title}
                  flexDirection="column"
                  marginTop={position > 0 ? 1 : 0}
                >
                  <Text bold>{group.title}</Text>
                  {group.hints.map((hint) => (
                    <Box key={hint.keys + hint.label}>
                      <Box width={KEY_W[groupIndex]} flexShrink={0}>
                        <Text color={COLOR.alt}>{hint.keys}</Text>
                      </Box>
                      <Text dimColor wrap="truncate-end">
                        {hint.label}
                      </Text>
                    </Box>
                  ))}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
      {short ? (
        <Text dimColor wrap="truncate-end">
          {`? or esc closes ${ICON.dot} files stay on disk`}
        </Text>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{FOOT_FULL}</Text>
          <Text dimColor>Press ? or esc to close</Text>
        </Box>
      )}
    </Box>
  );
}
