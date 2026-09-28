import { parseSnapshot } from "@wow-companion/contracts";
import type { GameToCompanion, GetStateResponse, Snapshot } from "@wow-companion/contracts";
import type { DaemonContext } from "./context.ts";

const SNAPSHOT_KEYS: readonly (keyof Snapshot)[] = [
  "character",
  "position",
  "money",
  "quests",
  "equipped",
  "bags",
  "professions",
  "talents",
];

function isLive(ctx: DaemonContext): boolean {
  return SNAPSHOT_KEYS.every((key) => ctx.state.refreshed.has(key));
}

export function liveSnapshot(ctx: DaemonContext): Snapshot | undefined {
  return ctx.isConnected() && isLive(ctx) ? parseSnapshot(ctx.state.game) : undefined;
}

export function getState(ctx: DaemonContext): GetStateResponse {
  const snapshot = liveSnapshot(ctx);
  return snapshot === undefined
    ? { ok: false, error: "not_connected" }
    : { ok: true, value: snapshot };
}

export function onState(ctx: DaemonContext, msg: Extract<GameToCompanion, { t: "state" }>): void {
  ctx.state.game = { ...ctx.state.game, ...msg.delta };
  for (const key of SNAPSHOT_KEYS) {
    if (msg.delta[key] !== undefined) ctx.state.refreshed.add(key);
  }
  ctx.persistGame();
}
