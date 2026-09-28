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

export function fullSnapshot(ctx: DaemonContext): Snapshot | undefined {
  return parseSnapshot(ctx.state.game);
}

export function getState(ctx: DaemonContext): GetStateResponse {
  const snapshot = fullSnapshot(ctx);
  return ctx.isConnected() && isLive(ctx) && snapshot !== undefined
    ? { ok: true, value: snapshot }
    : { ok: false, error: "not_connected" };
}

function isLive(ctx: DaemonContext): boolean {
  return SNAPSHOT_KEYS.every((key) => ctx.state.refreshed.has(key));
}

export function onState(ctx: DaemonContext, msg: Extract<GameToCompanion, { t: "state" }>): void {
  ctx.state.game = { ...ctx.state.game, ...msg.delta };
  for (const key of SNAPSHOT_KEYS) {
    if (msg.delta[key] !== undefined) ctx.state.refreshed.add(key);
  }
  ctx.persistGame();
}
