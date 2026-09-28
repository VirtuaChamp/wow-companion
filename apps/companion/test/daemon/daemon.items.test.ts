import { afterEach, describe, expect, it } from "vitest";
import type { ItemDetail } from "@wow-companion/contracts";
import { hello, serve, startDaemon, waitForSent } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const detail: ItemDetail = {
  itemId: 200,
  name: "Cloth Robe",
  quality: 2,
  itemLevel: 10,
  requiredLevel: 5,
  equipLoc: "INVTYPE_CHEST",
  classId: 4,
  subClassId: 1,
  stats: {},
};

describe("daemon.items", () => {
  it("answers not_connected before a hello and sends nothing", async () => {
    const harness = startDaemon();
    cleanups.push(harness.stop);

    expect(await harness.daemon.api.postItems([200])).toEqual({
      ok: false,
      error: "not_connected",
    });
    expect(harness.link.sent()).toEqual([]);
  });

  it("sends an itemreq and resolves with the items the game answers", async () => {
    const harness = startDaemon();
    cleanups.push(harness.stop);
    harness.link.push(hello());
    await waitForSent(harness.link, 3);

    const pending = harness.daemon.api.postItems([200]);
    const sent = await waitForSent(harness.link, 4);
    const request = sent[3];
    if (request?.t !== "itemreq") throw new Error("expected itemreq");
    expect(request.ids).toEqual([200]);
    harness.link.push({ t: "items", req: request.req, items: [detail] });

    expect(await pending).toEqual({ ok: true, value: [detail] });
  });

  it("keeps two concurrent requests apart by req id", async () => {
    const harness = startDaemon();
    cleanups.push(harness.stop);
    harness.link.push(hello());
    await waitForSent(harness.link, 3);

    const first = harness.daemon.api.postItems([1]);
    const second = harness.daemon.api.postItems([2]);
    const sent = await waitForSent(harness.link, 5);
    const [reqA, reqB] = [sent[3], sent[4]];
    if (reqA?.t !== "itemreq" || reqB?.t !== "itemreq") throw new Error("expected itemreq");
    expect(reqA.req).not.toBe(reqB.req);
    harness.link.push({ t: "items", req: reqB.req, items: [{ ...detail, itemId: 2 }] });
    harness.link.push({ t: "items", req: reqA.req, items: [{ ...detail, itemId: 1 }] });

    expect(await first).toEqual({ ok: true, value: [{ ...detail, itemId: 1 }] });
    expect(await second).toEqual({ ok: true, value: [{ ...detail, itemId: 2 }] });
  });

  it("answers item_timeout when the game does not answer in time and ignores a late answer for that request", async () => {
    const harness = startDaemon({ itemTimeoutMs: 20 });
    cleanups.push(harness.stop);
    harness.link.push(hello());
    await waitForSent(harness.link, 3);

    const result = await harness.daemon.api.postItems([200]);
    expect(result).toEqual({ ok: false, error: "item_timeout" });
    const expired = harness.link.sent()[3];
    if (expired?.t !== "itemreq") throw new Error("expected itemreq");

    const fresh = startDaemon({ itemTimeoutMs: 500 });
    cleanups.push(fresh.stop);
    fresh.link.push(hello());
    await waitForSent(fresh.link, 3);
    const second = fresh.daemon.api.postItems([201]);
    const secondRequest = (await waitForSent(fresh.link, 4))[3];
    if (secondRequest?.t !== "itemreq") throw new Error("expected itemreq");
    fresh.link.push({ t: "items", req: "req-does-not-exist", items: [detail] });
    const stillPending = await Promise.race([
      second.then(() => "answered"),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 40)),
    ]);
    expect(stillPending).toBe("pending");
    fresh.link.push({ t: "items", req: secondRequest.req, items: [{ ...detail, itemId: 201 }] });
    expect(await second).toEqual({ ok: true, value: [{ ...detail, itemId: 201 }] });

    const before = harness.link.sent().length;
    harness.link.push({ t: "items", req: expired.req, items: [detail] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.link.sent()).toHaveLength(before);
    const next = harness.daemon.api.postItems([202]);
    const nextRequest = (await waitForSent(harness.link, before + 1))[before];
    if (nextRequest?.t !== "itemreq") throw new Error("expected itemreq");
    expect(nextRequest.req).not.toBe(expired.req);
    harness.link.push({ t: "items", req: nextRequest.req, items: [{ ...detail, itemId: 202 }] });
    expect(await next).toEqual({ ok: true, value: [{ ...detail, itemId: 202 }] });
  });

  it("answers an empty ids list without spending a reply slot", async () => {
    const harness = startDaemon();
    cleanups.push(harness.stop);
    harness.link.push(hello());
    await waitForSent(harness.link, 3);

    expect(await harness.daemon.api.postItems([])).toEqual({ ok: true, value: [] });
    expect(harness.link.sent()).toHaveLength(3);
  });

  it("answers too_large, not not_connected, when the link refuses the request as too large", async () => {
    const harness = startDaemon();
    cleanups.push(harness.stop);
    harness.link.push(hello());
    await waitForSent(harness.link, 3);
    harness.link.send = () => ({ ok: false, error: "too_large" });

    expect(await harness.daemon.api.postItems([1, 2, 3])).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("answers not_connected without sending when the link reports the game gone", async () => {
    const harness = startDaemon();
    cleanups.push(harness.stop);
    harness.link.push(hello());
    await waitForSent(harness.link, 3);
    harness.link.setConnected(false);

    expect(await harness.daemon.api.postItems([200])).toEqual({
      ok: false,
      error: "not_connected",
    });
    expect(harness.link.sent()).toHaveLength(3);
  });

  it("answers not_connected when the link cannot carry the request", async () => {
    const harness = startDaemon();
    cleanups.push(harness.stop);
    harness.link.push(hello());
    await waitForSent(harness.link, 3);
    harness.link.send = () => ({ ok: false, error: "slots_exhausted" });

    expect(await harness.daemon.api.postItems([200])).toEqual({
      ok: false,
      error: "not_connected",
    });
  });

  it("serves POST /items over HTTP end to end", async () => {
    const harness = startDaemon();
    cleanups.push(harness.stop);
    const { server, base } = await serve(harness.daemon);
    cleanups.push(() => server.close());
    harness.link.push(hello());
    await waitForSent(harness.link, 3);

    const response = fetch(`${base}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [200] }),
    });
    const sent = await waitForSent(harness.link, 4);
    const request = sent[3];
    if (request?.t !== "itemreq") throw new Error("expected itemreq");
    harness.link.push({ t: "items", req: request.req, items: [detail] });
    const answered = await response;

    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ ok: true, value: [detail] });
  });
});
