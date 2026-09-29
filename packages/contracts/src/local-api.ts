import { isOneOf, isRecord } from "./guards.ts";
import { parseItemDetailArray, parseSnapshot } from "./parse.ts";
import type { ItemDetail, Result, Snapshot, Waypoint } from "./types.ts";

export const X_WOWC_RUN_HEADER = "X-Wowc-Run";

export type GetStateResponse = Result<Snapshot, "not_connected">;
export type PostItemsRequest = { ids: number[] };
export type PostItemsResponse = Result<ItemDetail[], "not_connected" | "item_timeout">;
export type PostWaypointRequest = Waypoint;
export type PostWaypointResponse = Result<void, "no_active_ask">;

function parseErrorField<E extends string>(
  json: Record<string, unknown>,
  errors: readonly E[],
): E | undefined {
  return isOneOf(json.error, errors) ? json.error : undefined;
}

export function parseGetStateResponse(json: unknown): Result<GetStateResponse, "bad_frame"> {
  if (!isRecord(json) || typeof json.ok !== "boolean") return { ok: false, error: "bad_frame" };
  if (json.ok) {
    const snapshot = parseSnapshot(json.value);
    return snapshot === undefined
      ? { ok: false, error: "bad_frame" }
      : { ok: true, value: { ok: true, value: snapshot } };
  }
  const error = parseErrorField(json, ["not_connected"] as const);
  return error === undefined
    ? { ok: false, error: "bad_frame" }
    : { ok: true, value: { ok: false, error } };
}

export function parsePostItemsResponse(json: unknown): Result<PostItemsResponse, "bad_frame"> {
  if (!isRecord(json) || typeof json.ok !== "boolean") return { ok: false, error: "bad_frame" };
  if (json.ok) {
    const items = parseItemDetailArray(json.value);
    return items === undefined
      ? { ok: false, error: "bad_frame" }
      : { ok: true, value: { ok: true, value: items } };
  }
  const error = parseErrorField(json, ["not_connected", "item_timeout"] as const);
  return error === undefined
    ? { ok: false, error: "bad_frame" }
    : { ok: true, value: { ok: false, error } };
}

export function parsePostWaypointResponse(
  json: unknown,
): Result<PostWaypointResponse, "bad_frame"> {
  if (!isRecord(json) || typeof json.ok !== "boolean") return { ok: false, error: "bad_frame" };
  if (json.ok) return { ok: true, value: { ok: true, value: undefined } };
  const error = parseErrorField(json, ["no_active_ask"] as const);
  return error === undefined
    ? { ok: false, error: "bad_frame" }
    : { ok: true, value: { ok: false, error } };
}
