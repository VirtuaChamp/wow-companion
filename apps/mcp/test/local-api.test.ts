import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
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

  const statusMappings: [number, string][] = [
    [403, "forbidden"],
    [413, "too_large"],
    [415, "unsupported_media_type"],
    [400, "bad_request"],
    [404, "bad_request"],
    [405, "bad_request"],
    [500, "daemon_error"],
  ];

  for (const [status, expected] of statusMappings) {
    it(`maps HTTP ${String(status)} to ${expected} on every route, never not_connected`, async () => {
      const { baseUrl, server } = await startServer((_req, res) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: expected }));
      });
      activeServer = server;
      const localApi = createLocalApi({ baseUrl, runId: "run-123" });
      const failure = { ok: false, error: expected };
      expect(await localApi.getState()).toEqual(failure);
      expect(await localApi.postItems([1])).toEqual(failure);
      expect(await localApi.postWaypoint({ uiMapId: 1, x: 1, y: 1, label: "x" })).toEqual(failure);
    });
  }

  it("maps the statuses even when the body is not JSON", async () => {
    const { baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(413, { "content-type": "text/plain" });
      res.end("nope");
    });
    activeServer = server;
    const localApi = createLocalApi({ baseUrl, runId: "run-123" });
    expect(await localApi.postItems([1])).toEqual({ ok: false, error: "too_large" });
  });

  it("keeps not_connected for 503, item_timeout for 504 and no_active_ask for 409", async () => {
    const { baseUrl, server } = await startServer((req, res) => {
      const status = req.url === "/items" ? 504 : req.url === "/waypoint" ? 409 : 503;
      const error =
        status === 504 ? "item_timeout" : status === 409 ? "no_active_ask" : "not_connected";
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error }));
    });
    activeServer = server;
    const localApi = createLocalApi({ baseUrl, runId: "run-123" });
    expect(await localApi.getState()).toEqual({ ok: false, error: "not_connected" });
    expect(await localApi.postItems([1])).toEqual({ ok: false, error: "item_timeout" });
    expect(await localApi.postWaypoint({ uiMapId: 1, x: 1, y: 1, label: "x" })).toEqual({
      ok: false,
      error: "no_active_ask",
    });
  });

  it("sends Content-Type application/json and a 127.0.0.1:<port> Host on its POSTs", async () => {
    const seen: { url: string | undefined; type: string | undefined; host: string | undefined }[] =
      [];
    const { baseUrl, server } = await startServer((req, res) => {
      seen.push({ url: req.url, type: req.headers["content-type"], host: req.headers.host });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, value: [] }));
    });
    activeServer = server;
    const localApi = createLocalApi({ baseUrl, runId: "run-123" });
    await localApi.postItems([1]);
    await localApi.postWaypoint({ uiMapId: 1, x: 1, y: 1, label: "x" });
    const port = new URL(baseUrl).port;
    for (const entry of seen) {
      expect(entry.type).toBe("application/json");
      expect(entry.host).toBe(`127.0.0.1:${port}`);
    }
    expect(seen.map((entry) => entry.url)).toEqual(["/items", "/waypoint"]);
  });

  describe("against the real local API server", () => {
    let child: ChildProcess | undefined;

    afterEach(() => {
      child?.kill();
      child = undefined;
    });

    async function startReal(): Promise<string> {
      const serverUrl = new URL("../../companion/src/local-api-server.ts", import.meta.url).href;
      const script = [
        `import { createLocalApiServer } from ${JSON.stringify(serverUrl)};`,
        "const server = createLocalApiServer({",
        '  getState: () => ({ ok: false, error: "not_connected" }),',
        "  postItems: async (ids) => ({ ok: true, value: [] }),",
        '  postWaypoint: (runId) => (runId === "run-real" ? { ok: true, value: undefined } : { ok: false, error: "no_active_ask" }),',
        "});",
        "const port = await server.start(0);",
        "console.log('PORT ' + port);",
        "setInterval(() => {}, 1000);",
      ].join(String.fromCharCode(10));
      child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["ignore", "pipe", "inherit"],
      });
      const port = await new Promise<string>((resolve, reject) => {
        child?.stdout?.on("data", (chunk: Buffer) => {
          const match = /PORT (\d+)/.exec(chunk.toString("utf8"));
          if (match?.[1] !== undefined) resolve(match[1]);
        });
        child?.on("error", reject);
        child?.on("exit", () => reject(new Error("server exited")));
      });
      return `http://127.0.0.1:${port}`;
    }

    it("is accepted by the daemon's Host, Origin and content-type checks and maps its answers", async () => {
      const baseUrl = await startReal();
      const localApi = createLocalApi({ baseUrl, runId: "run-real" });

      expect(await localApi.getState()).toEqual({ ok: false, error: "not_connected" });
      expect(await localApi.postItems([1, 2])).toEqual({ ok: true, value: [] });
      expect(await localApi.postWaypoint({ uiMapId: 1, x: 1, y: 1, label: "x" })).toEqual({
        ok: true,
        value: undefined,
      });
      const other = createLocalApi({ baseUrl, runId: "run-other" });
      expect(await other.postWaypoint({ uiMapId: 1, x: 1, y: 1, label: "x" })).toEqual({
        ok: false,
        error: "no_active_ask",
      });
    });

    it("sees the daemon's refusals as typed errors", async () => {
      const baseUrl = await startReal();
      const forbidden = await fetch(`${baseUrl}/state`, {
        headers: { origin: "https://evil.example" },
      });
      expect(forbidden.status).toBe(403);
      const tooLarge = createLocalApi({ baseUrl, runId: "run-real" });
      const ids = Array.from({ length: 100000 }, (_, index) => index + 1);
      expect(await tooLarge.postItems(ids)).toEqual({ ok: false, error: "too_large" });
    });
  });
});
