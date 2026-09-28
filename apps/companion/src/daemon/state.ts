import { parseSnapshot } from "@wow-companion/contracts";
import type { GameToCompanion, GetStateResponse, Snapshot } from "@wow-companion/contracts";
import type { DaemonContext } from "./context.ts";

export function fullSnapshot(ctx: DaemonContext): Snapshot | undefined {
  return parseSnapshot(ctx.state.game);
}

export function getState(ctx: DaemonContext): GetStateResponse {
  const snapshot = fullSnapshot(ctx);
  return ctx.isConnected() && snapshot !== undefined
    ? { ok: true, value: snapshot }
    : { ok: false, error: "not_connected" };
}

export function onState(ctx: DaemonContext, msg: Extract<GameToCompanion, { t: "state" }>): void {
  ctx.state.game = { ...ctx.state.game, ...msg.delta };
  ctx.persistGame();
}
