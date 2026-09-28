import { describe, expect, it } from "vitest";
import { createLazyApi, createShutdown, startServices } from "../../src/daemon/lifecycle.ts";
import type { Daemon } from "../../src/daemon/context.ts";

function fakeDaemon(
  overrides: Partial<Daemon> = {},
): Daemon & { started: number; stopped: number } {
  const daemon = {
    started: 0,
    stopped: 0,
    api: {
      getState: () => ({ ok: false as const, error: "not_connected" as const }),
      postItems: async () => ({ ok: false as const, error: "not_connected" as const }),
      postWaypoint: () => ({ ok: true as const, value: undefined }),
    },
    start() {
      daemon.started += 1;
    },
    async stop() {
      daemon.stopped += 1;
    },
    ...overrides,
  };
  return daemon;
}

function fakeServer(startResult: Promise<number>) {
  const calls: string[] = [];
  return {
    calls,
    start: (port: number) => {
      calls.push(`start:${String(port)}`);
      return startResult;
    },
    close: async () => {
      calls.push("close");
    },
  };
}

describe("daemon.lifecycle", () => {
  it("does not build the link when the server cannot listen", async () => {
    const server = fakeServer(Promise.reject(new Error("EADDRINUSE")));
    let linkBuilt = 0;

    await expect(
      startServices({
        server,
        port: 1234,
        lazy: createLazyApi(),
        log: () => {},
        buildLink: () => {
          linkBuilt += 1;
          return { close() {} };
        },
        buildDaemon: () => fakeDaemon(),
      }),
    ).rejects.toThrow("EADDRINUSE");

    expect(linkBuilt).toBe(0);
    expect(server.calls).toEqual(["start:1234"]);
  });

  it("starts the server first, then the link, then the daemon, and binds the api", async () => {
    const order: string[] = [];
    const server = fakeServer(Promise.resolve(1234));
    const lazy = createLazyApi();
    const daemon = fakeDaemon({
      api: {
        getState: () => ({ ok: false, error: "not_connected" }),
        postItems: async () => ({ ok: true, value: [] }),
        postWaypoint: () => ({ ok: true, value: undefined }),
      },
    });
    expect(await lazy.handlers.postItems([1])).toEqual({ ok: false, error: "not_connected" });

    const started = await startServices({
      server: {
        ...server,
        start: async (port) => {
          order.push("server");
          return server.start(port);
        },
      },
      port: 1234,
      lazy,
      log: () => {},
      buildLink: () => {
        order.push("link");
        return { close() {} };
      },
      buildDaemon: () => {
        order.push("daemon");
        return daemon;
      },
    });

    expect(order).toEqual(["server", "link", "daemon"]);
    expect(started.port).toBe(1234);
    expect(daemon.started).toBe(1);
    expect(await lazy.handlers.postItems([1])).toEqual({ ok: true, value: [] });
  });

  it("closes the link and the server when building fails after listening", async () => {
    const server = fakeServer(Promise.resolve(1234));
    let linkClosed = 0;

    await expect(
      startServices({
        server,
        port: 1234,
        lazy: createLazyApi(),
        log: () => {},
        buildLink: () => ({
          close() {
            linkClosed += 1;
          },
        }),
        buildDaemon: () => {
          throw new Error("daemon failed");
        },
      }),
    ).rejects.toThrow("daemon failed");

    expect(linkClosed).toBe(1);
    expect(server.calls).toEqual(["start:1234", "close"]);
  });

  it("answers the local API safely before the daemon is bound", () => {
    const lazy = createLazyApi();
    expect(lazy.handlers.getState()).toEqual({ ok: false, error: "not_connected" });
    expect(lazy.handlers.postWaypoint("run", { uiMapId: 1, x: 1, y: 1, label: "" })).toEqual({
      ok: false,
      error: "no_active_ask",
    });
  });

  it("exits even when stop or close rejects, and only shuts down once", async () => {
    const logs: string[] = [];
    const exits: number[] = [];
    let linkCloses = 0;
    const shutdown = createShutdown({
      link: {
        close() {
          linkCloses += 1;
          throw new Error("link close failed");
        },
      },
      daemon: {
        stop: () => Promise.reject(new Error("stop failed")),
      },
      server: { close: () => Promise.reject(new Error("close failed")) },
      exit: (code) => exits.push(code),
      log: (line) => logs.push(line),
    });

    await Promise.all([shutdown(), shutdown()]);

    expect(exits).toEqual([1]);
    expect(linkCloses).toBe(1);
    expect(logs).toHaveLength(3);
  });

  it("exits 0 after a clean shutdown", async () => {
    const exits: number[] = [];
    const daemon = fakeDaemon();
    const shutdown = createShutdown({
      link: { close() {} },
      daemon,
      server: { close: async () => {} },
      exit: (code) => exits.push(code),
      log: () => {},
    });

    await shutdown();

    expect(exits).toEqual([0]);
    expect(daemon.stopped).toBe(1);
  });
});
