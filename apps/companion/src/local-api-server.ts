import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";
import {
  X_WOWC_RUN_HEADER,
  parseItemsRequest,
  parseWaypointRequest,
} from "@wow-companion/contracts";
import type {
  GetStateResponse,
  PostItemsResponse,
  PostWaypointResponse,
  ToolError,
  Waypoint,
} from "@wow-companion/contracts";

export const LOCAL_API_HOST = "127.0.0.1";

const MAX_BODY_BYTES = 256 * 1024;

export type LocalApiHandlers = {
  getState(): GetStateResponse;
  postItems(ids: number[]): Promise<PostItemsResponse | { ok: false; error: "too_large" }>;
  postWaypoint(runId: string | undefined, waypoint: Waypoint): PostWaypointResponse;
};

export type LocalApiServer = {
  start(port: number): Promise<number>;
  address(): AddressInfo | undefined;
  close(): Promise<void>;
};

function statusFor(error: ToolError): number {
  switch (error) {
    case "too_large":
      return 413;
    case "forbidden":
      return 403;
    case "unsupported_media_type":
      return 415;
    case "bad_request":
      return 400;
    case "daemon_error":
      return 500;
    case "not_connected":
      return 503;
    case "item_timeout":
      return 504;
    case "no_active_ask":
      return 409;
    case "no_waypoint_map":
      return 422;
  }
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

function sendResult<T>(
  response: http.ServerResponse,
  result: { ok: true; value: T } | { ok: false; error: ToolError },
): void {
  if (result.ok) {
    send(response, 200, {
      ok: true,
      ...(result.value === undefined ? {} : { value: result.value }),
    });
    return;
  }
  send(response, statusFor(result.error), { ok: false, error: result.error });
}

type BodyOutcome = { kind: "json"; value: unknown } | { kind: "too_large" } | { kind: "invalid" };

export function readJsonBody(request: Readable): Promise<BodyOutcome> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    function settle(outcome: BodyOutcome): void {
      if (settled) return;
      settled = true;
      resolve(outcome);
    }
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.pause();
        settle({ kind: "too_large" });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        settle({ kind: "json", value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        settle({ kind: "invalid" });
      }
    });
    request.on("error", () => settle({ kind: "invalid" }));
    request.on("close", () => settle({ kind: "invalid" }));
  });
}

function isAllowedHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const lowered = host.toLowerCase();
  return lowered === `${LOCAL_API_HOST}:${String(port)}` || lowered === `localhost:${String(port)}`;
}

function isJsonContentType(value: string | undefined): boolean {
  return value !== undefined && value.toLowerCase().startsWith("application/json");
}

function runIdOf(request: http.IncomingMessage): string | undefined {
  const raw = request.headers[X_WOWC_RUN_HEADER.toLowerCase()];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function createLocalApiServer(handlers: LocalApiHandlers): LocalApiServer {
  async function handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const port = (server.address() as AddressInfo).port;
    if (request.headers.origin !== undefined || !isAllowedHost(request.headers.host, port)) {
      return send(response, 403, { ok: false, error: "forbidden" });
    }
    const pathname = new URL(request.url ?? "/", `http://${LOCAL_API_HOST}`).pathname;
    const method = request.method ?? "GET";
    if (pathname === "/state") {
      if (method !== "GET") return send(response, 405, { ok: false, error: "bad_request" });
      return sendResult(response, handlers.getState());
    }
    if (pathname !== "/items" && pathname !== "/waypoint") {
      return send(response, 404, { ok: false, error: "bad_request" });
    }
    if (method !== "POST") return send(response, 405, { ok: false, error: "bad_request" });
    if (!isJsonContentType(request.headers["content-type"])) {
      return send(response, 415, { ok: false, error: "unsupported_media_type" });
    }
    const body = await readJsonBody(request);
    switch (body.kind) {
      case "too_large":
        response.setHeader("connection", "close");
        response.once("finish", () => request.destroy());
        return send(response, 413, { ok: false, error: "too_large" });
      case "invalid":
        return send(response, 400, { ok: false, error: "bad_request" });
      case "json":
        break;
    }
    if (pathname === "/items") {
      const parsed = parseItemsRequest(body.value);
      if (parsed === undefined) return send(response, 400, { ok: false, error: "bad_request" });
      return sendResult(response, await handlers.postItems(parsed.ids));
    }
    const waypoint = parseWaypointRequest(body.value);
    if (waypoint === undefined) return send(response, 400, { ok: false, error: "bad_request" });
    return sendResult(response, handlers.postWaypoint(runIdOf(request), waypoint));
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) send(response, 500, { ok: false, error: "daemon_error" });
      else response.end();
    });
  });

  return {
    start(port) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve((server.address() as AddressInfo).port);
        });
      });
    },
    address() {
      const value = server.address();
      return value !== null && typeof value === "object" ? value : undefined;
    },
    close() {
      return new Promise((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
