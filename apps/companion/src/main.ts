import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { GameToCompanion } from "@wow-companion/contracts";
import { onAsk } from "./daemon/ask.ts";
import {
  buildProviders,
  chatsStore,
  createProviderProbes,
  gameStore,
  loadStartup,
  settingsStore,
  slotPaths,
} from "./daemon/bootstrap.ts";
import { onCmd } from "./daemon/cmd.ts";
import { createContext } from "./daemon/context.ts";
import type { Daemon, DaemonContext, DaemonDeps } from "./daemon/context.ts";
import { onHello } from "./daemon/hello.ts";
import { createLazyApi, createShutdown, startServices } from "./daemon/lifecycle.ts";
import { onSettings } from "./daemon/settings.ts";
import { getState, onState } from "./daemon/state.ts";
import { LOCAL_API_HOST, createLocalApiServer } from "./local-api-server.ts";
import { createFsSlots } from "./adapters/fs-slots.ts";
import { createScreenCaptureSource } from "./transport/capture.ts";
import { createScreenLink } from "./transport/screen-link.ts";
import { EMPTY_WAV } from "./transport/slots.ts";

export type { Daemon, DaemonDeps };
export { settingsFromConfig } from "./daemon/settings.ts";

const GAME_PROCESS_NAME = "WowB";
const COMMIT_RETRY_MS = 1000;
const MAX_APPLY_FAILURES = 3;

function handle(ctx: DaemonContext, msg: GameToCompanion): Promise<void> | undefined {
  switch (msg.t) {
    case "hello":
      return onHello(ctx, msg);
    case "settings":
      return onSettings(ctx, msg);
    case "state":
      onState(ctx, msg);
      return undefined;
    case "ask":
      onAsk(ctx, msg);
      return undefined;
    case "items":
      ctx.items.receive(msg);
      return undefined;
    case "cmd":
      onCmd(ctx, msg);
      return undefined;
  }
}

export function createDaemon(deps: DaemonDeps): Daemon {
  const ctx = createContext(deps);
  const detached = new Set<Promise<void>>();
  let iterator: AsyncIterator<GameToCompanion> | undefined;
  let loop: Promise<void> = Promise.resolve();
  let stopped = false;

  let settingsPending: Promise<void> | undefined;

  async function commitToLink(msg: GameToCompanion): Promise<void> {
    if (deps.link.committed === undefined) return;
    while (!stopped) {
      if ((await ctx.saveState()) && (await deps.link.committed(msg))) return;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, deps.commitRetryMs ?? COMMIT_RETRY_MS),
      );
    }
  }

  const applyFailures = new Map<string, number>();

  async function applyThenCommit(
    msg: Extract<GameToCompanion, { t: "ask" | "cmd" }>,
    run: () => Promise<void> | undefined,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      ctx.log(`message ${msg.t} failed: ${String(error)}`);
      const key = `${msg.t}:${msg.id}`;
      const failures = (applyFailures.get(key) ?? 0) + 1;
      if (failures < MAX_APPLY_FAILURES) {
        applyFailures.set(key, failures);
        deps.link.release?.(msg);
        return;
      }
      applyFailures.delete(key);
      ctx.out.send({
        t: "error",
        id: msg.id,
        chat: msg.chat,
        code: "daemon_error",
        message: "the companion could not apply this message",
      });
    }
    applyFailures.delete(`${msg.t}:${msg.id}`);
    await commitToLink(msg);
  }

  function dispatch(msg: GameToCompanion): void {
    const report = (error: unknown): void => ctx.log(`message ${msg.t} failed: ${String(error)}`);
    const gated =
      settingsPending !== undefined && (msg.t === "ask" || msg.t === "cmd" || msg.t === "settings");
    const run = (): Promise<void> | undefined =>
      gated ? settingsPending?.then(() => handle(ctx, msg)) : handle(ctx, msg);
    let finished: Promise<void> | undefined;
    if (msg.t === "ask" || msg.t === "cmd") {
      finished = applyThenCommit(msg, run);
    } else {
      try {
        finished = run()?.catch(report);
      } catch (error) {
        report(error);
        return;
      }
    }
    if (finished === undefined) return;
    const tracked: Promise<void> = finished.finally(() => {
      detached.delete(tracked);
      if (settingsPending === tracked) settingsPending = undefined;
    });
    detached.add(tracked);
    if (msg.t === "settings") settingsPending = tracked;
  }

  return {
    api: {
      getState: () => getState(ctx),
      postItems: (ids) => ctx.items.request(ids),
      postWaypoint: (runId, waypoint) =>
        runId === undefined
          ? { ok: false, error: "no_active_ask" }
          : ctx.runner.attachWaypoint(runId, waypoint),
    },
    start() {
      ctx.persistChats();
      const source = deps.link.messages()[Symbol.asyncIterator]();
      iterator = source;
      loop = (async () => {
        for (;;) {
          const next = await source.next();
          if (next.done === true) return;
          dispatch(next.value);
        }
      })();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      ctx.runner.cancelAll();
      ctx.items.cancelAll();
      await iterator?.return?.();
      await loop;
      await Promise.allSettled(detached);
      await ctx.gameWriter.flush();
      await ctx.persister.settled();
    },
  };
}

async function main(): Promise<void> {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const log = (line: string): void => console.log(`[wowc] ${line}`);
  const loaded = await loadStartup(root, log);
  if (!loaded.ok) {
    console.error(`[wowc] ${loaded.error}`);
    process.exitCode = 1;
    return;
  }
  const startup = loaded.value;
  const { config } = startup;
  mkdirSync(startup.workspace, { recursive: true });
  const probes = createProviderProbes(startup.workspace);
  await probes.refresh();
  const providers = buildProviders({ config, root, workspace: startup.workspace, probes });

  const lazy = createLazyApi();
  const server = createLocalApiServer(lazy.handlers);
  const started = await startServices({
    server,
    port: config.companionPort,
    lazy,
    log,
    buildLink: () => {
      const onCaptureError = (error: unknown): void => log(`capture: ${String(error)}`);
      return createScreenLink({
        frameSource: createScreenCaptureSource({
          windowProcessName: GAME_PROCESS_NAME,
          onCaptureError,
        }),
        fs: createFsSlots(),
        paths: slotPaths(config.wowPath),
        emptyWav: EMPTY_WAV,
        slotCount: config.slotCount,
        onCaptureError,
        log,
        handledIds: startup.handledIds,
      });
    },
    buildDaemon: (link) =>
      createDaemon({
        link,
        config,
        providers,
        initialChats: startup.initialChats,
        initialSettings: startup.initialSettings,
        initialGame: startup.initialGame,
        chatsStore: chatsStore(startup.files.chats),
        settingsStore: settingsStore(startup.files.settings),
        gameStore: gameStore(startup.files.game),
        beforeDescribe: () => probes.refresh(),
        ...(startup.version === undefined ? {} : { version: startup.version }),
        log,
      }),
  });
  log(`local API on ${LOCAL_API_HOST}:${String(started.port)}`);

  const shutdown = createShutdown({
    link: started.link,
    daemon: started.daemon,
    server,
    exit: (code) => process.exit(code),
    log,
  });
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
