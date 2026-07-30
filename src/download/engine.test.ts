import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ManagedTransmissionDaemon,
  TRANSMISSION_INSTALL_HINT,
  TransmissionRpcClient,
  findTransmissionDaemon,
} from "./engine";

function jsonResponse(status: number, body: unknown, sessionId?: string): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (sessionId) headers.set("X-Transmission-Session-Id", sessionId);
  return new Response(JSON.stringify(body), { status, headers });
}

describe("TransmissionRpcClient", () => {
  it("retries once with the session id returned by Transmission 409 responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(409, {}, "sid-1"))
      .mockResolvedValueOnce(jsonResponse(200, { result: "success", arguments: {} }));
    const client = new TransmissionRpcClient("http://127.0.0.1:9091/transmission/rpc", fetchImpl);

    await expect(client.request("session-get")).resolves.toEqual({});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({
      "X-Transmission-Session-Id": "sid-1",
    });
  });

  it("maps normal and duplicate torrent-add responses to the returned hash", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          result: "success",
          arguments: { "torrent-added": { hashString: "abc", name: "One", totalSize: 10 } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          result: "success",
          arguments: { "torrent-duplicate": { hashString: "def", name: "Two" } },
        }),
      );
    const client = new TransmissionRpcClient("http://127.0.0.1/rpc", fetchImpl);

    await expect(client.add("magnet:?xt=urn:btih:abc", "/tmp")).resolves.toMatchObject({
      hashString: "abc",
      name: "One",
    });
    await expect(client.add("magnet:?xt=urn:btih:def", "/tmp")).resolves.toMatchObject({
      hashString: "def",
      name: "Two",
    });
  });

  it("sends typed start, stop, remove, verify, and stats requests", async () => {
    const calls: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return jsonResponse(200, {
        result: "success",
        arguments: {
          torrents: [
            {
              hashString: "abc",
              name: "Example",
              totalSize: 100,
              leftUntilDone: 25,
              percentDone: 0.75,
            },
          ],
        },
      });
    });
    const client = new TransmissionRpcClient("http://127.0.0.1/rpc", fetchImpl);

    await client.get(["abc"]);
    await client.start(["abc"]);
    await client.stop(["abc"]);
    await client.remove(["abc"]);
    await client.verify(["abc"]);

    expect(calls).toMatchObject([
      { method: "torrent-get" },
      { method: "torrent-start" },
      { method: "torrent-stop" },
      { method: "torrent-remove", arguments: { "delete-local-data": false } },
      { method: "torrent-verify" },
    ]);
  });

  it("raises RPC result errors instead of shell-parsing output", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { result: "invalid or corrupt torrent file" }));
    const client = new TransmissionRpcClient("http://127.0.0.1/rpc", fetchImpl);

    await expect(client.request("torrent-add")).rejects.toThrow(
      "Transmission torrent-add failed: invalid or corrupt torrent file",
    );
  });

  it("sends .torrent files as metainfo when a torrent path is provided", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "torlink-rpc-test-"));
    try {
      const file = path.join(dir, "one.torrent");
      await writeFile(file, Buffer.from("torrent bytes"));
      const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.arguments.metainfo).toBe(Buffer.from("torrent bytes").toString("base64"));
        expect(body.arguments.filename).toBeUndefined();
        return jsonResponse(200, {
          result: "success",
          arguments: { "torrent-added": { hashString: "abc" } },
        });
      });
      const client = new TransmissionRpcClient("http://127.0.0.1/rpc", fetchImpl);
      await client.add(file, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ManagedTransmissionDaemon", () => {
  it("reports the Homebrew install command when the daemon binary is missing", async () => {
    await expect(findTransmissionDaemon(["/definitely/not/transmission-daemon"])).resolves.toBeNull();
    await expect(
      new ManagedTransmissionDaemon({ binary: "" }).start("/tmp"),
    ).rejects.toThrow(TRANSMISSION_INSTALL_HINT);
  });

  it("spawns a localhost-only TorLink-owned daemon and stops it on destroy", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "torlink-daemon-test-"));
    const killed: string[] = [];
    const child = {
      exitCode: null,
      signalCode: null,
      unref: vi.fn(),
      kill: vi.fn((signal: string) => {
        killed.push(signal);
        return true;
      }),
    };
    const spawnImpl = vi.fn(() => child);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(409, {}, "sid-1"))
      .mockResolvedValueOnce(jsonResponse(200, { result: "success", arguments: {} }))
      .mockResolvedValueOnce(jsonResponse(409, {}, "sid-2"))
      .mockResolvedValueOnce(jsonResponse(200, { result: "success", arguments: {} }));

    try {
      const runner = new ManagedTransmissionDaemon({
        binary: "/opt/homebrew/bin/transmission-daemon",
        stateDir: tmp,
        rpcPort: 49123,
        peerPort: 51414,
        fetchImpl,
        spawnImpl: spawnImpl as never,
      });
      const endpoint = await runner.start(path.join(tmp, "downloads"));
      expect(endpoint.url).toBe("http://127.0.0.1:49123/transmission/rpc");
      expect(spawnImpl).toHaveBeenCalledTimes(1);
      const firstCall = spawnImpl.mock.calls[0] as unknown as [string, string[]];
      const args = firstCall[1];
      expect(args).toContain("--foreground");
      expect(args).toContain("--rpc-bind-address");
      expect(args).toContain("127.0.0.1");
      expect(args).toContain("--no-auth");
      expect(args).toContain("--allowed");
      expect(args).toContain("--no-portmap");
      expect(args).toContain("--peerport");
      expect(args).toContain("51414");
      const rpcCalls = fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
      expect(rpcCalls).toMatchObject([
        { method: "session-get" },
        { method: "session-get" },
        {
          method: "session-set",
          arguments: {
            "download-queue-enabled": false,
            "queue-stalled-enabled": false,
            "seed-queue-enabled": false,
            "start-added-torrents": true,
            start_paused: false,
          },
        },
        {
          method: "session-set",
          arguments: {
            "download-queue-enabled": false,
            "queue-stalled-enabled": false,
            "seed-queue-enabled": false,
            "start-added-torrents": true,
            start_paused: false,
          },
        },
      ]);
      runner.destroy();
      expect(killed).toContain("SIGTERM");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("reuses an existing TorLink daemon from saved RPC settings instead of spawning another", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "torlink-existing-daemon-test-"));
    const configDir = path.join(tmp, "daemon-config");
    const spawnImpl = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(409, {}, "sid-1"))
      .mockResolvedValueOnce(jsonResponse(200, { result: "success", arguments: {} }))
      .mockResolvedValueOnce(jsonResponse(409, {}, "sid-2"))
      .mockResolvedValueOnce(jsonResponse(200, { result: "success", arguments: {} }));

    try {
      await mkdir(configDir, { recursive: true });
      await writeFile(path.join(configDir, "settings.json"), JSON.stringify({ "rpc-port": 49124 }));
      const runner = new ManagedTransmissionDaemon({
        binary: "/opt/homebrew/bin/transmission-daemon",
        stateDir: tmp,
        fetchImpl,
        spawnImpl: spawnImpl as never,
      });

      const endpoint = await runner.start(path.join(tmp, "downloads"));

      expect(endpoint.url).toBe("http://127.0.0.1:49124/transmission/rpc");
      expect(spawnImpl).not.toHaveBeenCalled();
      expect(fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toMatchObject([
        { method: "session-get" },
        { method: "session-get" },
        {
          method: "session-set",
          arguments: {
            "download-queue-enabled": false,
            "queue-stalled-enabled": false,
            "seed-queue-enabled": false,
            "start-added-torrents": true,
            start_paused: false,
          },
        },
        {
          method: "session-set",
          arguments: {
            "download-queue-enabled": false,
            "queue-stalled-enabled": false,
            "seed-queue-enabled": false,
            "start-added-torrents": true,
            start_paused: false,
          },
        },
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
