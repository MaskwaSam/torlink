import { Box, Text } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { COLOR, ICON } from "../theme";
import { terminalSafeText } from "../../util/format";

interface SearchBarProps {
  width: number;
  value: string;
  placeholder?: string;
  editing: boolean;
  onSubmit: (value: string) => void;
  onChange?: (value: string) => void;
  onExitDown?: () => void;
  onExitLeft?: () => void;
}

export function SearchBar({
  width,
  value,
  placeholder = "Search torrents…",
  editing,
  onSubmit,
  onChange,
  onExitDown,
  onExitLeft,
}: SearchBarProps) {
  const displayValue = terminalSafeText(value);
  const displayPlaceholder = terminalSafeText(placeholder);
  return (
    <Panel title="search" width={width} focused={editing} height={2}>
      <Box>
        <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
        <Box flexGrow={1} minWidth={0}>
          {editing ? (
            <TextField
              defaultValue={value}
              placeholder={placeholder}
              width={Math.max(1, width - 6)}
              onSubmit={onSubmit}
              onChange={onChange}
              onExitDown={onExitDown}
              onExitLeft={onExitLeft}
            />
          ) : displayValue ? (
            <Text wrap="truncate-end">{displayValue}</Text>
          ) : (
            <Text dimColor>{displayPlaceholder}</Text>
          )}
        </Box>
      </Box>
    </Panel>
  );
}
