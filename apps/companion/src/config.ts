import { isEffort, isProviderId } from "@wow-companion/contracts";
import type { Effort, ProviderId, Result } from "@wow-companion/contracts";
import { isRecord } from "./adapters/json-file.ts";

type ProviderSettings = {
  enabled: boolean;
  model: string;
  effort?: Effort;
  models: readonly string[];
};

export type Config = {
  wowPath: string;
  provider: ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
  companionPort: number;
  slotCount: number;
  timeoutMs: number;
};

export type ConfigError = { field: string; problem: "missing" | "invalid" };

function fail(field: string, problem: ConfigError["problem"]): Result<never, ConfigError> {
  return { ok: false, error: { field, problem } };
}

function positiveInteger(raw: Record<string, unknown>, field: string): Result<number, ConfigError> {
  const value = raw[field];
  if (value === undefined) return fail(field, "missing");
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? { ok: true, value }
    : fail(field, "invalid");
}

function parseProvider(id: ProviderId, value: unknown): Result<ProviderSettings, ConfigError> {
  const field = `providers.${id}`;
  if (value === undefined) return fail(field, "missing");
  if (!isRecord(value)) return fail(field, "invalid");
  if (value.enabled === undefined) return fail(`${field}.enabled`, "missing");
  if (typeof value.enabled !== "boolean") return fail(`${field}.enabled`, "invalid");
  if (value.model === undefined) return fail(`${field}.model`, "missing");
  if (typeof value.model !== "string" || value.model.length === 0)
    return fail(`${field}.model`, "invalid");
  let models: readonly string[] = [];
  if (value.models !== undefined) {
    if (!Array.isArray(value.models) || !value.models.every((m) => typeof m === "string"))
      return fail(`${field}.models`, "invalid");
    models = value.models as string[];
  }
  if (value.effort === undefined) {
    return { ok: true, value: { enabled: value.enabled, model: value.model, models } };
  }
  if (!isEffort(value.effort)) return fail(`${field}.effort`, "invalid");
  return {
    ok: true,
    value: { enabled: value.enabled, model: value.model, effort: value.effort, models },
  };
}

export function parseConfig(raw: unknown): Result<Config, ConfigError> {
  if (!isRecord(raw)) return fail("config", "invalid");
  if (raw.wowPath === undefined) return fail("wowPath", "missing");
  if (typeof raw.wowPath !== "string" || raw.wowPath.length === 0)
    return fail("wowPath", "invalid");
  if (raw.provider === undefined) return fail("provider", "missing");
  if (!isProviderId(raw.provider)) return fail("provider", "invalid");
  if (raw.providers === undefined) return fail("providers", "missing");
  if (!isRecord(raw.providers)) return fail("providers", "invalid");
  const claude = parseProvider("claude", raw.providers.claude);
  if (!claude.ok) return claude;
  const codex = parseProvider("codex", raw.providers.codex);
  if (!codex.ok) return codex;
  const cursor = parseProvider("cursor", raw.providers.cursor);
  if (!cursor.ok) return cursor;
  const companionPort = positiveInteger(raw, "companionPort");
  if (!companionPort.ok) return companionPort;
  if (companionPort.value > 65535) return fail("companionPort", "invalid");
  const slotCount = positiveInteger(raw, "slotCount");
  if (!slotCount.ok) return slotCount;
  const timeoutMs = positiveInteger(raw, "timeoutMs");
  if (!timeoutMs.ok) return timeoutMs;
  return {
    ok: true,
    value: {
      wowPath: raw.wowPath,
      provider: raw.provider,
      providers: { claude: claude.value, codex: codex.value, cursor: cursor.value },
      companionPort: companionPort.value,
      slotCount: slotCount.value,
      timeoutMs: timeoutMs.value,
    },
  };
}

export function configErrorMessage(error: ConfigError): string {
  return `config.json: ${error.field} is ${error.problem}`;
}
