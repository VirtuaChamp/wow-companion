import {
  X_WOWC_RUN_HEADER,
  parseGetStateResponse,
  parsePostItemsResponse,
  parsePostWaypointResponse,
} from "@wow-companion/contracts";
import type { ItemDetail, Result, Snapshot, ToolError, Waypoint } from "@wow-companion/contracts";

export type LocalApiConfig = {
  readonly baseUrl: string;
  readonly runId: string;
  readonly requestTimeoutMs?: number;
  readonly itemsTimeoutMs?: number;
};

export type LocalApi = {
  getState(): Promise<Result<Snapshot, ToolError>>;
  postItems(ids: readonly number[]): Promise<Result<ItemDetail[], ToolError>>;
  postWaypoint(waypoint: Waypoint): Promise<Result<void, ToolError>>;
};

const DEFAULT_ITEMS_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function requestFailed<T>(): Result<T, ToolError> {
  return { ok: false, error: "not_connected" };
}

function errorForStatus(status: number): ToolError | undefined {
  switch (status) {
    case 400:
    case 404:
    case 405:
      return "bad_request";
    case 403:
      return "forbidden";
    case 413:
      return "too_large";
    case 415:
      return "unsupported_media_type";
    case 500:
      return "daemon_error";
    default:
      return undefined;
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

async function postJson(
  config: LocalApiConfig,
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(new URL(path, config.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", [X_WOWC_RUN_HEADER]: config.runId },
    body: JSON.stringify(body),
    signal,
  });
}

export function createLocalApi(config: LocalApiConfig): LocalApi {
  const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const itemsTimeoutMs = config.itemsTimeoutMs ?? DEFAULT_ITEMS_TIMEOUT_MS;
  return {
    async getState() {
      try {
        const response = await fetch(new URL("/state", config.baseUrl), {
          headers: { [X_WOWC_RUN_HEADER]: config.runId },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        const statusError = errorForStatus(response.status);
        if (statusError !== undefined) return { ok: false, error: statusError };
        const body = await response.json();
        const parsed = parseGetStateResponse(body);
        if (!parsed.ok) {
          console.error("wowc-mcp: /state returned an unparseable body");
          return requestFailed();
        }
        return parsed.value;
      } catch {
        return requestFailed();
      }
    },
    async postItems(ids: readonly number[]) {
      try {
        const response = await postJson(
          config,
          "/items",
          { ids: Array.from(ids) },
          AbortSignal.timeout(itemsTimeoutMs),
        );
        const statusError = errorForStatus(response.status);
        if (statusError !== undefined) return { ok: false, error: statusError };
        const body = await response.json();
        const parsed = parsePostItemsResponse(body);
        if (!parsed.ok) {
          console.error("wowc-mcp: /items returned an unparseable body");
          return requestFailed();
        }
        return parsed.value;
      } catch (error) {
        if (isTimeoutError(error)) return { ok: false, error: "item_timeout" };
        return requestFailed();
      }
    },
    async postWaypoint(waypoint: Waypoint) {
      try {
        const response = await postJson(
          config,
          "/waypoint",
          waypoint,
          AbortSignal.timeout(requestTimeoutMs),
        );
        if (response.status === 409) return { ok: false, error: "no_active_ask" };
        const statusError = errorForStatus(response.status);
        if (statusError !== undefined) return { ok: false, error: statusError };
        const body = await response.json();
        const parsed = parsePostWaypointResponse(body);
        if (!parsed.ok) {
          console.error("wowc-mcp: /waypoint returned an unparseable body");
          return requestFailed();
        }
        return parsed.value;
      } catch {
        return requestFailed();
      }
    },
  };
}
