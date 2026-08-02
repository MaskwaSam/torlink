import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

function launch(command: string, args: string[], anyExit = false): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const process = spawn(command, args);
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      timer = setTimeout(() => {
        try {
          process.kill();
        } catch {}
        finish(false);
      }, 4_000);
      timer.unref?.();
      process.on("error", () => finish(false));
      process.on("close", (code) => finish(anyExit || code === 0));
    } catch {
      resolve(false);
    }
  });
}

const LINUX_OPENERS: readonly [string, readonly string[]][] = [
  ["xdg-open", []],
  ["gio", ["open"]],
];

/** Open an existing directory in the platform file manager. Never throws. */
export async function openFolder(dir: string): Promise<boolean> {
  if (!dir || !existsSync(dir)) return false;
  if (process.platform === "win32") {
    // explorer.exe commonly exits 1 even after successfully opening a window.
    return launch("explorer", [dir], true);
  }
  if (process.platform === "darwin") return launch("open", [dir]);
  for (const [command, args] of LINUX_OPENERS) {
    if (await launch(command, [...args, dir])) return true;
  }
  return false;
}
