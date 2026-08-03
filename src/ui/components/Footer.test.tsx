import React from "react";
import { Box } from "ink";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "ink-testing-library";
import { footerHints } from "../keymap";
import { Footer } from "./Footer";

afterEach(() => cleanup());

describe("Footer", () => {
  it("keeps the Help shortcut visible in a narrow results footer", () => {
    const { lastFrame } = render(
      <Box width={78}>
        <Footer hints={footerHints("content", "all")} />
      </Box>,
    );

    expect(lastFrame()).toContain("? Keys");
  });
});
