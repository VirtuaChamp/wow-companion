import type { ItemDetail, Result, Snapshot, ToolError, Waypoint } from "@wow-companion/contracts";
import type { LocalApi } from "../../src/local-api.ts";

export type StubLocalApiConfig = {
  readonly connected?: boolean;
  readonly snapshot?: Snapshot;
  readonly items?: readonly ItemDetail[];
  readonly itemTimeout?: boolean;
  readonly activeAsk?: boolean;
};

export function createStubLocalApi(config: StubLocalApiConfig): LocalApi {
  return {
    async getState(): Promise<Result<Snapshot, ToolError>> {
      if (config.connected === false || config.snapshot === undefined) {
        return { ok: false, error: "not_connected" };
      }
      return { ok: true, value: config.snapshot };
    },
    async postItems(ids: readonly number[]): Promise<Result<ItemDetail[], ToolError>> {
      if (config.connected === false) return { ok: false, error: "not_connected" };
      if (config.itemTimeout === true) return { ok: false, error: "item_timeout" };
      const items = config.items ?? [];
      return { ok: true, value: items.filter((item) => ids.includes(item.itemId)) };
    },
    async postWaypoint(_waypoint: Waypoint): Promise<Result<void, ToolError>> {
      if (config.activeAsk === false) return { ok: false, error: "no_active_ask" };
      return { ok: true, value: undefined };
    },
  };
}
