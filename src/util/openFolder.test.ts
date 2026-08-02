import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const spawn = vi.fn();
const existsSync = vi.fn();

vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:fs", () => ({ existsSync }));

type FakeProcess = EventEmitter & { kill: () => void };

function fakeProcess(code: number): FakeProcess {
  const child = new EventEmitter() as FakeProcess;
  child.kill = vi.fn();
  queueMicrotask(() => child.emit("close", code));
  return child;
}

function onPlatform(platform: NodeJS.Platform): () => void {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  return () => {
    Object.defineProperty(process, "platform", { value: original });
    vi.resetModules();
    spawn.mockReset();
    existsSync.mockReset();
  };
}

describe("openFolder", () => {
  it("uses Finder's open command on macOS", async () => {
    const restore = onPlatform("darwin");
    try {
      existsSync.mockReturnValue(true);
      spawn.mockImplementation(() => fakeProcess(0));
      const { openFolder } = await import("./openFolder");

      await expect(openFolder("/Users/me/Downloads/torlink")).resolves.toBe(true);
      expect(spawn).toHaveBeenCalledWith("open", ["/Users/me/Downloads/torlink"]);
    } finally {
      restore();
    }
  });

  it("falls back to the next Linux opener", async () => {
    const restore = onPlatform("linux");
    try {
      existsSync.mockReturnValue(true);
      spawn.mockImplementation((command: string) => fakeProcess(command === "gio" ? 0 : 1));
      const { openFolder } = await import("./openFolder");

      await expect(openFolder("/home/me/Downloads/torlink")).resolves.toBe(true);
      expect(spawn).toHaveBeenNthCalledWith(1, "xdg-open", ["/home/me/Downloads/torlink"]);
      expect(spawn).toHaveBeenNthCalledWith(2, "gio", ["open", "/home/me/Downloads/torlink"]);
    } finally {
      restore();
    }
  });

  it("does not spawn anything for a missing folder", async () => {
    const restore = onPlatform("darwin");
    try {
      existsSync.mockReturnValue(false);
      const { openFolder } = await import("./openFolder");

      await expect(openFolder("/gone")).resolves.toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
