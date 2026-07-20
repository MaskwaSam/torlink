import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ManagedTransmissionDaemon,
  TransmissionRpcClient,
} from "../src/download/engine";

const root = await mkdtemp(path.join(os.tmpdir(), "torlink-transmission-smoke-"));
const runner = new ManagedTransmissionDaemon({ stateDir: path.join(root, "state") });

try {
  const endpoint = await runner.start(path.join(root, "downloads"));
  const client = new TransmissionRpcClient(endpoint.url);
  await client.request("session-get");
  const response = await client.request<{ torrents?: unknown[] }>("torrent-get", {
    fields: ["id"],
  });
  if ((response.torrents ?? []).length !== 0) {
    throw new Error("Temporary Transmission daemon was not empty");
  }
  process.stdout.write(`Transmission smoke check passed at ${endpoint.url}\n`);
} finally {
  runner.destroy();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(root, { recursive: true, force: true });
}
