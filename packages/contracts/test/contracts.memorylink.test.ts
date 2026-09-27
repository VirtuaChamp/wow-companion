import { describe, expect, it } from "vitest";
import { createMemoryLink } from "../src/memory-link.ts";
import type { GameToCompanion } from "../src/types.ts";

describe("contracts.memorylink", () => {
  it("push then messages() yields pushed messages in order", async () => {
    const link = createMemoryLink();
    const first: GameToCompanion = { t: "hello", v: 1, build: "1.60.1.70009", iface: 16001 };
    const second: GameToCompanion = { t: "state", seq: 1, delta: {} };

    link.push(first);
    link.push(second);

    const iterator = link.messages()[Symbol.asyncIterator]();
    const firstResult = await iterator.next();
    const secondResult = await iterator.next();

    expect(firstResult).toEqual({ value: first, done: false });
    expect(secondResult).toEqual({ value: second, done: false });
  });

  it("yields a message pushed after the consumer is already waiting", async () => {
    const link = createMemoryLink();
    const message: GameToCompanion = { t: "hello", v: 1, build: "1.60.1.70009", iface: 16001 };

    const iterator = link.messages()[Symbol.asyncIterator]();
    const pending = iterator.next();
    link.push(message);

    expect(await pending).toEqual({ value: message, done: false });
  });

  it("send records into sent() in call order", () => {
    const link = createMemoryLink();

    const first = link.send({ t: "ack", seq: 1 });
    const second = link.send({ t: "ack", seq: 2 });

    expect(first).toEqual({ ok: true, value: undefined });
    expect(second).toEqual({ ok: true, value: undefined });
    expect(link.sent()).toEqual([
      { t: "ack", seq: 1 },
      { t: "ack", seq: 2 },
    ]);
  });

  it("status().connected follows setConnected", () => {
    const link = createMemoryLink();

    expect(link.status().connected).toBe(false);

    link.setConnected(true);
    expect(link.status().connected).toBe(true);

    link.setConnected(false);
    expect(link.status().connected).toBe(false);
  });

  it("status().slotsLeft is 200", () => {
    const link = createMemoryLink();
    expect(link.status().slotsLeft).toBe(200);
  });

  it("status().build is set from the last pushed hello", () => {
    const link = createMemoryLink();
    expect(link.status().build).toBeUndefined();

    link.push({ t: "hello", v: 1, build: "1.60.1.70009", iface: 16001 });
    expect(link.status().build).toBe("1.60.1.70009");

    link.push({ t: "hello", v: 1, build: "1.61.0.70100", iface: 16001 });
    expect(link.status().build).toBe("1.61.0.70100");
  });

  it("sent() returns a copy that later sends and caller mutation cannot affect", () => {
    const link = createMemoryLink();
    link.send({ t: "ack", seq: 1 });

    const first = link.sent();
    first.push({ t: "ack", seq: 999 });
    link.send({ t: "ack", seq: 2 });

    expect(link.sent()).toEqual([
      { t: "ack", seq: 1 },
      { t: "ack", seq: 2 },
    ]);
  });

  it("return() on an abandoned iterator removes its waiter so no pushed message is lost", async () => {
    const link = createMemoryLink();
    const message: GameToCompanion = { t: "hello", v: 1, build: "1.60.1.70009", iface: 16001 };

    const iterator = link.messages()[Symbol.asyncIterator]();
    iterator.next();
    const returned = await iterator.return?.();
    expect(returned).toEqual({ value: undefined, done: true });

    link.push(message);

    const fresh = link.messages()[Symbol.asyncIterator]();
    const result = await fresh.next();
    expect(result).toEqual({ value: message, done: false });
  });

  it("a next() pending when return() is called resolves done", async () => {
    const link = createMemoryLink();

    const iterator = link.messages()[Symbol.asyncIterator]();
    const pending = iterator.next();
    const returned = await iterator.return?.();

    expect(returned).toEqual({ value: undefined, done: true });
    expect(await pending).toEqual({ value: undefined, done: true });
  });

  it("next() after return() resolves done", async () => {
    const link = createMemoryLink();

    const iterator = link.messages()[Symbol.asyncIterator]();
    await iterator.return?.();

    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("a push after return() is still delivered to a second, live iterator", async () => {
    const link = createMemoryLink();
    const message: GameToCompanion = { t: "hello", v: 1, build: "1.60.1.70009", iface: 16001 };

    const ended = link.messages()[Symbol.asyncIterator]();
    const pendingEnded = ended.next();
    const live = link.messages()[Symbol.asyncIterator]();
    const pendingLive = live.next();

    await ended.return?.();
    link.push(message);

    expect(await pendingEnded).toEqual({ value: undefined, done: true });
    expect(await pendingLive).toEqual({ value: message, done: false });
  });
});
