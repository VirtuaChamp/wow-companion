import type { Provider, ProviderId } from "@wow-companion/contracts";
import type { Config } from "../config.ts";

type Description = Awaited<ReturnType<Provider["describe"]>>;
export type Descriptions = ReadonlyMap<ProviderId, Description>;

export const PROVIDER_ORDER: readonly ProviderId[] = ["claude", "codex", "cursor"];

export type DescribeService = {
  cached(): Descriptions;
  refresh(): Promise<Descriptions>;
};

function bounded<T>(work: Promise<T>, timeoutMs: number, onTimeout: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), timeoutMs);
    work.then(
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

  async function describeOne(id: ProviderId): Promise<[ProviderId, Description]> {
    const provider = input.providers.get(id);
    const description =
      provider === undefined
        ? unavailable(config, id, "provider adapter not available")
        : await bounded(
            Promise.resolve().then(() => provider.describe()),
            input.timeoutMs,
            unavailable(config, id, "provider check timed out or failed"),
          );
    return [id, applyConfig(config, id, description)];
  }

  async function run(): Promise<Descriptions> {
    if (input.before !== undefined) {
      await bounded(input.before(), input.timeoutMs, undefined);
    }
    latest = new Map(await Promise.all(PROVIDER_ORDER.map(describeOne)));
    return latest;
  }

  return {
    cached: () => latest,
    refresh() {
      inflight ??= run().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
  };
}
