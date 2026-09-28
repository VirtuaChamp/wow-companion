import type { Provider, ProviderId } from "@wow-companion/contracts";
import type { Config } from "../config.ts";

type Description = Awaited<ReturnType<Provider["describe"]>>;
export type Descriptions = ReadonlyMap<ProviderId, Description>;

export const PROVIDER_ORDER: readonly ProviderId[] = ["claude", "codex", "cursor"];

export type DescribeService = {
  cached(): Descriptions;
  refresh(): Promise<Descriptions>;
  ensureFresh(maxAgeMs: number): Promise<Descriptions>;
};

function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  onTimeout: T,
): Promise<T> {
  const controller = new AbortController();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller.abort();
      resolve(onTimeout);
    }, timeoutMs);
    Promise.resolve()
      .then(() => work(controller.signal))
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          resolve(onTimeout);
        },
      );
  });
}

function unavailable(config: Config, id: ProviderId, reason: string): Description {
  return {
    installed: false,
    enabled: false,
    reason,
    models: [...config.providers[id].models],
    efforts: [],
  };
}

function applyConfig(config: Config, id: ProviderId, description: Description): Description {
  return config.providers[id].enabled
    ? description
    : { ...description, enabled: false, reason: "disabled in config.json" };
}

export function createDescribeService(input: {
  config: Config;
  providers: ReadonlyMap<ProviderId, Provider>;
  timeoutMs: number;
  before?: () => Promise<void>;
  log: (line: string) => void;
}): DescribeService {
  const { config } = input;
  let latest: Descriptions = new Map(
    PROVIDER_ORDER.map((id) => [
      id,
      applyConfig(config, id, unavailable(config, id, "not checked yet")),
    ]),
  );
  let inflight: Promise<Descriptions> | undefined;
  let refreshedAt: number | undefined;

  async function describeOne(id: ProviderId): Promise<[ProviderId, Description]> {
    const provider = input.providers.get(id);
    const description =
      provider === undefined
        ? unavailable(config, id, "provider adapter not available")
        : await bounded(
            (signal) => provider.describe(signal),
            input.timeoutMs,
            unavailable(config, id, "provider check timed out or failed"),
          );
    return [id, applyConfig(config, id, description)];
  }

  async function run(): Promise<Descriptions> {
    if (input.before !== undefined) {
      await bounded(() => input.before?.() ?? Promise.resolve(), input.timeoutMs, undefined);
    }
    latest = new Map(await Promise.all(PROVIDER_ORDER.map(describeOne)));
    refreshedAt = Date.now();
    return latest;
  }

  function refresh(): Promise<Descriptions> {
    inflight ??= run().finally(() => {
      inflight = undefined;
    });
    return inflight;
  }

  return {
    cached: () => latest,
    refresh,
    ensureFresh(maxAgeMs) {
      return refreshedAt !== undefined && Date.now() - refreshedAt <= maxAgeMs
        ? Promise.resolve(latest)
        : refresh();
    },
  };
}
