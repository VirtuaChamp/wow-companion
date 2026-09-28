import { createServer } from "node:http";
import type { Server } from "node:http";
import { X_WOWC_RUN_HEADER } from "@wow-companion/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalApi } from "../src/local-api.ts";

type Handler = (
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) => void;

async function startServer(handler: Handler): Promise<{ baseUrl: string; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no server address");
  return { baseUrl: `http://127.0.0.1:${String(address.port)}`, server };
}

async function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

describe("local-api.createLocalApi", () => {
  let activeServer: Server | undefined;

  afterEach(async () => {
    if (activeServer !== undefined) {
      await stopServer(activeServer);
      activeServer = undefined;
    }
  });

  it("sends the X-Wowc-Run header on every request, including POST /items and POST /waypoint (aca-r2-7)", async () => {
    const seenHeaders: (string | undefined)[] = [];
    const { baseUrl, server } = await startServer((req, res) => {
      seenHeaders.push(req.headers[X_WOWC_RUN_HEADER.toLowerCase()] as string | undefined);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_connected" }));
    });
    activeServer = server;
    const localApi = createLocalApi({ baseUrl, runId: "run-123" });
    await localApi.getState();
    await localApi.postItems([1]);
    await localApi.postWaypoint({ uiMapId: 1, x: 1, y: 1, label: "x" });
    expect(seenHeaders).toEqual(["run-123", "run-123", "run-123"]);
  });

  it("maps a 409 on /waypoint to no_active_ask", async () => {
    const { baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no_active_ask" }));
    });
    activeServer = server;
    const localApi = createLocalApi({ baseUrl, runId: "run-123" });
    const result = await localApi.postWaypoint({ uiMapId: 1, x: 1, y: 1, label: "x" });
    expect(result).toEqual({ ok: false, error: "no_active_ask" });
  });

  it("maps a slow /items response past the deadline to item_timeout", async () => {
    const { baseUrl, server } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, value: [] }));
      }, 200);
    });
    activeServer = server;
    const localApi = createLocalApi({ baseUrl, runId: "run-123", itemsTimeoutMs: 20 });
    const result = await localApi.postItems([1, 2, 3]);
    expect(result).toEqual({ ok: false, error: "item_timeout" });
  });

  it("maps a non-JSON response body to not_connected instead of throwing", async () => {
    const { baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("not json");
    });
    activeServer = server;
    const localApi = createLocalApi({ baseUrl, runId: "run-123" });
    const result = await localApi.getState();
    expect(result).toEqual({ ok: false, error: "not_connected" });
  });

  it("forwards the requested ids and returns the parsed item details", async () => {
    let requestedBody: string | undefined;
    const { baseUrl, server } = await startServer((req, res) => {
      readBody(req)
        .then((body) => {
          requestedBody = body;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, value: [] }));
        })
        .catch(() => {
          res.writeHead(500);
          res.end();
        });
    });
    activeServer = server;
    const localApi = createLocalApi({ baseUrl, runId: "run-123" });
    await localApi.postItems([1, 2]);
    expect(requestedBody).toBe(JSON.stringify({ ids: [1, 2] }));
  });
});
