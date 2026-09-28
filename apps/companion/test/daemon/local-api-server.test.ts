import http from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { X_WOWC_RUN_HEADER } from "@wow-companion/contracts";
import { LOCAL_API_HOST, createLocalApiServer, readJsonBody } from "../../src/local-api-server.ts";
import type { LocalApiHandlers, LocalApiServer } from "../../src/local-api-server.ts";
import { makeSnapshot } from "./helpers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const open: LocalApiServer[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => server.close()));
});

function handlers(overrides: Partial<LocalApiHandlers> = {}): LocalApiHandlers {
  return {
    getState: () => ({ ok: true, value: makeSnapshot() }),
    postItems: async () => ({ ok: true, value: [] }),
    postWaypoint: () => ({ ok: true, value: undefined }),
    ...overrides,
  };
}

async function start(h: LocalApiHandlers): Promise<{ base: string; server: LocalApiServer }> {
  const server = createLocalApiServer(h);
  open.push(server);
  const port = await server.start(0);
  return { base: `http://127.0.0.1:${String(port)}`, server };
}

describe("daemon.local-api-server", () => {
  it("binds 127.0.0.1 only", async () => {
    expect(LOCAL_API_HOST).toBe("127.0.0.1");
    const server = createLocalApiServer(handlers());
    open.push(server);
    await server.start(0);
    expect(server.address()).toEqual({
      address: "127.0.0.1",
      family: "IPv4",
      port: expect.any(Number),
    });
    const port = server.address()?.port ?? 0;
    const refused = await new Promise<string>((resolve) => {
      const request = http.get({ host: "::1", port, path: "/state" }, () => resolve("connected"));
      request.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "error"));
    });
    expect(refused).not.toBe("connected");
  });

  it("serves GET /state as a Result and maps not_connected to 503", async () => {
    const connected = await start(handlers());
    const okResponse = await fetch(`${connected.base}/state`);
    expect(okResponse.status).toBe(200);
    expect(await okResponse.json()).toEqual({ ok: true, value: makeSnapshot() });
    const offline = await start(
      handlers({ getState: () => ({ ok: false, error: "not_connected" }) }),
    );
    const offlineResponse = await fetch(`${offline.base}/state`);
    expect(offlineResponse.status).toBe(503);
    expect(await offlineResponse.json()).toEqual({ ok: false, error: "not_connected" });
  });

  it("serves POST /items and maps item_timeout to 504", async () => {
    const seen: number[][] = [];
    const { base } = await start(
      handlers({
        postItems: async (ids) => {
          seen.push(ids);
          return { ok: false, error: "item_timeout" };
        },
      }),
    );
    const response = await fetch(`${base}/items`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ids: [5, 6] }),
    });
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ ok: false, error: "item_timeout" });
    expect(seen).toEqual([[5, 6]]);
  });

  it("hands the X-Wowc-Run header and the waypoint to POST /waypoint and maps no_active_ask to 409", async () => {
    const seen: { runId: string | undefined; label: string }[] = [];
    const { base } = await start(
      handlers({
        postWaypoint: (runId, waypoint) => {
          seen.push({ runId, label: waypoint.label });
          return runId === "run-known"
            ? { ok: true, value: undefined }
            : { ok: false, error: "no_active_ask" };
        },
      }),
    );
    const post = (runId?: string) =>
      fetch(`${base}/waypoint`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(runId === undefined ? {} : { [X_WOWC_RUN_HEADER]: runId }),
        },
        body: JSON.stringify({ uiMapId: 85, x: 1, y: 2, label: "L" }),
      });
    const good = await post("run-known");
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ ok: true });
    const unknown = await post("run-other");
    expect(unknown.status).toBe(409);
    expect(await unknown.json()).toEqual({ ok: false, error: "no_active_ask" });
    const missing = await post();
    expect(missing.status).toBe(409);
    expect(seen).toEqual([
      { runId: "run-known", label: "L" },
      { runId: "run-other", label: "L" },
      { runId: undefined, label: "L" },
    ]);
  });

  it("refuses malformed bodies, unknown paths and wrong methods without touching a handler", async () => {
    let calls = 0;
    const { base } = await start(
      handlers({
        postItems: async () => {
          calls += 1;
          return { ok: true, value: [] };
        },
        postWaypoint: () => {
          calls += 1;
          return { ok: true, value: undefined };
        },
      }),
    );
    const badItems = await fetch(`${base}/items`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: '{"ids":"x"}',
    });
    expect(badItems.status).toBe(400);
    const badJson = await fetch(`${base}/waypoint`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: "{nope",
    });
    expect(badJson.status).toBe(400);
    const badWaypoint = await fetch(`${base}/waypoint`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: '{"x":1}',
    });
    expect(badWaypoint.status).toBe(400);
    expect((await fetch(`${base}/nowhere`)).status).toBe(404);
    expect(
      (await fetch(`${base}/state`, { method: "POST", headers: JSON_HEADERS, body: "{}" })).status,
    ).toBe(405);
    expect((await fetch(`${base}/items`)).status).toBe(405);
    expect(calls).toBe(0);
  });

  it("refuses a request body over 256 KB with 413, stops reading and closes the connection", async () => {
    const { server } = await start(handlers());
    const port = server.address()?.port ?? 0;
    const outcome = await new Promise<{ status: number; connection: string | undefined }>(
      (resolve, reject) => {
        const request = http.request(
          {
            host: LOCAL_API_HOST,
            port,
            path: "/items",
            method: "POST",
            headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
          },
          (response) => {
            response.resume();
            resolve({ status: response.statusCode ?? 0, connection: response.headers.connection });
          },
        );
        request.on("error", reject);
        request.write("x".repeat(300 * 1024));
      },
    );
    expect(outcome.status).toBe(413);
    expect(outcome.connection).toBe("close");
  });

  it("settles a body read when the client goes away mid-body without an error event", async () => {
    const request = new PassThrough();
    const outcome = readJsonBody(request);
    request.write('{"ids":');
    request.destroy();

    expect(await outcome).toEqual({ kind: "invalid" });
  });

  it("stops reading a body once it is over the limit", async () => {
    const request = new PassThrough();
    const outcome = readJsonBody(request);
    request.write("x".repeat(300 * 1024));

    expect(await outcome).toEqual({ kind: "too_large" });
    expect(request.isPaused()).toBe(true);
  });

  it("refuses a request whose Host is not 127.0.0.1:<port> or localhost:<port> with a Result error body", async () => {
    let reads = 0;
    const { server } = await start(
      handlers({
        getState: () => {
          reads += 1;
          return { ok: true, value: makeSnapshot() };
        },
      }),
    );
    const port = server.address()?.port ?? 0;
    const get = (host: string) =>
      new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const request = http.request(
          { host: LOCAL_API_HOST, port, path: "/state", method: "GET", headers: { host } },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
              }),
            );
          },
        );
        request.on("error", reject);
        request.end();
      });
    const rebound = await get(`evil.example:${String(port)}`);
    expect(rebound.status).toBe(403);
    expect(rebound.body).toEqual({ ok: false, error: "forbidden" });
    expect((await get(`127.0.0.1:${String(port + 1)}`)).status).toBe(403);
    expect((await get("127.0.0.1")).status).toBe(403);
    expect(reads).toBe(0);
    expect((await get(`127.0.0.1:${String(port)}`)).status).toBe(200);
    expect((await get(`localhost:${String(port)}`)).status).toBe(200);
    expect(reads).toBe(2);
  });

  it("refuses any request that carries an Origin header, on every route", async () => {
    let calls = 0;
    const { base } = await start(
      handlers({
        postItems: async () => {
          calls += 1;
          return { ok: true, value: [] };
        },
        postWaypoint: () => {
          calls += 1;
          return { ok: true, value: undefined };
        },
      }),
    );
    const withOrigin = { ...JSON_HEADERS, origin: "https://evil.example" };
    const state = await fetch(`${base}/state`, { headers: { origin: "https://evil.example" } });
    expect(state.status).toBe(403);
    expect(await state.json()).toEqual({ ok: false, error: "forbidden" });
    const items = await fetch(`${base}/items`, {
      method: "POST",
      headers: withOrigin,
      body: '{"ids":[1]}',
    });
    expect(items.status).toBe(403);
    const waypoint = await fetch(`${base}/waypoint`, {
      method: "POST",
      headers: withOrigin,
      body: '{"uiMapId":1,"x":1,"y":1,"label":"l"}',
    });
    expect(waypoint.status).toBe(403);
    expect(calls).toBe(0);
  });

  it("refuses a POST that is not application/json without touching a handler", async () => {
    let calls = 0;
    const { base } = await start(
      handlers({
        postItems: async () => {
          calls += 1;
          return { ok: true, value: [] };
        },
      }),
    );
    const response = await fetch(`${base}/items`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: '{"ids":[1]}',
    });
    expect(response.status).toBe(415);
    expect(calls).toBe(0);
  });

  it("answers 413 for an items request that is too large for the link", async () => {
    const { base } = await start(
      handlers({ postItems: async () => ({ ok: false, error: "too_large" }) }),
    );
    const response = await fetch(`${base}/items`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: '{"ids":[1]}',
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: "too_large" });
  });

  it("words every refusal as a ToolError Result body", async () => {
    const { base } = await start(handlers());
    const bodyOf = async (response: Response) => response.json();
    expect(await bodyOf(await fetch(`${base}/nowhere`))).toEqual({
      ok: false,
      error: "bad_request",
    });
    expect(await bodyOf(await fetch(`${base}/items`))).toEqual({ ok: false, error: "bad_request" });
    expect(
      await bodyOf(
        await fetch(`${base}/items`, { method: "POST", headers: JSON_HEADERS, body: "{nope" }),
      ),
    ).toEqual({ ok: false, error: "bad_request" });
    expect(
      await bodyOf(
        await fetch(`${base}/items`, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
      ),
    ).toEqual({ ok: false, error: "unsupported_media_type" });
    expect(
      await bodyOf(await fetch(`${base}/state`, { headers: { origin: "https://evil.example" } })),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("maps every ToolError a handler returns to its HTTP status", async () => {
    const statuses: [string, number][] = [
      ["not_connected", 503],
      ["item_timeout", 504],
      ["no_active_ask", 409],
      ["no_waypoint_map", 422],
      ["too_large", 413],
      ["forbidden", 403],
      ["unsupported_media_type", 415],
      ["bad_request", 400],
      ["daemon_error", 500],
    ];
    for (const [error, status] of statuses) {
      const { base } = await start(
        handlers({
          postItems: async () => ({ ok: false, error: error as "not_connected" }),
        }),
      );
      const response = await fetch(`${base}/items`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: '{"ids":[1]}',
      });
      expect([error, response.status]).toEqual([error, status]);
      expect(await response.json()).toEqual({ ok: false, error });
    }
  });
});
