import type { GameLink, GameToCompanion, PostItemsResponse } from "@wow-companion/contracts";

type ItemsRequestResult = PostItemsResponse | { ok: false; error: "too_large" };

export type ItemsBroker = {
  request(ids: number[]): Promise<ItemsRequestResult>;
  receive(msg: Extract<GameToCompanion, { t: "items" }>): void;
  cancelAll(): void;
};

export function createItemsBroker(input: {
  link: GameLink;
  isConnected: () => boolean;
  timeoutMs: number;
}): ItemsBroker {
  const pending = new Map<string, (response: PostItemsResponse) => void>();
  let counter = 0;

  return {
    request(ids) {
      if (!input.isConnected()) return Promise.resolve({ ok: false, error: "not_connected" });
      if (ids.length === 0) return Promise.resolve({ ok: true, value: [] });
      counter += 1;
      const req = `req-${String(counter)}`;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(req);
          resolve({ ok: false, error: "item_timeout" });
        }, input.timeoutMs);
        pending.set(req, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
        const sent = input.link.send({ t: "itemreq", req, ids });
        if (sent.ok) return;
        clearTimeout(timer);
        pending.delete(req);
        switch (sent.error) {
          case "too_large":
            resolve({ ok: false, error: "too_large" });
            return;
          case "slots_exhausted":
            resolve({ ok: false, error: "not_connected" });
            return;
        }
      });
    },
    receive(msg) {
      const resolve = pending.get(msg.req);
      if (resolve === undefined) return;
      pending.delete(msg.req);
      resolve({ ok: true, value: msg.items });
    },
    cancelAll() {
      for (const resolve of pending.values()) resolve({ ok: false, error: "not_connected" });
      pending.clear();
    },
  };
}
