import type { LocalApiHandlers } from "../local-api-server.ts";
import type { Daemon } from "./context.ts";

export type LazyApi = {
  handlers: LocalApiHandlers;
  bind(api: LocalApiHandlers): void;
};

export function createLazyApi(): LazyApi {
  let bound: LocalApiHandlers | undefined;
  return {
    handlers: {
      getState: () => bound?.getState() ?? { ok: false, error: "not_connected" },
      postItems: (ids) =>
        bound?.postItems(ids) ?? Promise.resolve({ ok: false, error: "not_connected" }),
      postWaypoint: (runId, waypoint) =>
        bound?.postWaypoint(runId, waypoint) ?? { ok: false, error: "no_active_ask" },
    },
    bind(api) {
      bound = api;
    },
  };
}

type Closable = { close(): void };
type AsyncClosable = { close(): Promise<void> };

export async function startServices<L extends Closable>(input: {
  server: AsyncClosable & { start(port: number): Promise<number> };
  port: number;
  lazy: LazyApi;
  buildLink: () => L;
  buildDaemon: (link: L) => Daemon;
  log: (line: string) => void;
}): Promise<{ link: L; daemon: Daemon; port: number }> {
  const port = await input.server.start(input.port);
  let link: L | undefined;
  let daemon: Daemon | undefined;
  try {
    link = input.buildLink();
    daemon = input.buildDaemon(link);
    input.lazy.bind(daemon.api);
    daemon.start();
    return { link, daemon, port };
  } catch (error) {
    try {
      link?.close();
    } catch (closeError) {
      input.log(`link close failed: ${String(closeError)}`);
    }
    await daemon?.stop().catch((stopError: unknown) => {
      input.log(`daemon stop failed: ${String(stopError)}`);
    });
    await input.server.close().catch((closeError: unknown) => {
      input.log(`server close failed: ${String(closeError)}`);
    });
    throw error;
  }
}

export function createShutdown(input: {
  link: Closable;
  daemon: Pick<Daemon, "stop">;
  server: AsyncClosable;
  exit: (code: number) => void;
  log: (line: string) => void;
}): () => Promise<void> {
  let running: Promise<void> | undefined;

  async function run(): Promise<void> {
    let failed = false;
    try {
      input.link.close();
    } catch (error) {
      failed = true;
      input.log(`link close failed: ${String(error)}`);
    }
    try {
      await input.daemon.stop();
    } catch (error) {
      failed = true;
      input.log(`daemon stop failed: ${String(error)}`);
    }
    try {
      await input.server.close();
    } catch (error) {
      failed = true;
      input.log(`server close failed: ${String(error)}`);
    }
    input.exit(failed ? 1 : 0);
  }

  return () => {
    running ??= run();
    return running;
  };
}
