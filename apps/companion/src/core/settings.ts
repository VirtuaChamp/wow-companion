import type { Effort, GameToCompanion, ProviderId, Result } from "@wow-companion/contracts";

export type ProviderChoice = { provider: ProviderId; model: string; effort?: Effort };

export type PerChatChoice = { model: string; effort?: Effort };

export type Settings = {
  global: ProviderChoice;
  perChat: Readonly<Record<string, PerChatChoice>>;
};

export type ProviderOption = {
  id: ProviderId;
  enabled: boolean;
  models: readonly string[];
  efforts: readonly Effort[];
};

export type SettingsApplyError =
  | "provider_disabled"
  | "models_unconfigured"
  | "model_unlisted"
  | "effort_unsupported";

export type ProviderChange = { chatId: string; provider: ProviderId };

export type ApplyOutcome = { settings: Settings; providerChange?: ProviderChange };

type SettingsMessage = Extract<GameToCompanion, { t: "settings" }>;

function findProvider(
  options: readonly ProviderOption[],
  id: ProviderId,
): ProviderOption | undefined {
  return options.find((option) => option.id === id);
}

export function settingsApplyErrorMessage(
  error: SettingsApplyError,
  providerId: ProviderId,
): string {
  switch (error) {
    case "provider_disabled":
      return "provider is not enabled";
    case "models_unconfigured":
      return `set providers.${providerId}.models in config.json`;
    case "model_unlisted":
      return "model is not offered by this provider";
    case "effort_unsupported":
      return "effort is not supported by this provider";
  }
}

function toGlobalChoice(msg: SettingsMessage): ProviderChoice {
  return msg.effort === undefined
    ? { provider: msg.provider, model: msg.model }
    : { provider: msg.provider, model: msg.model, effort: msg.effort };
}

function toPerChatChoice(msg: SettingsMessage): PerChatChoice {
  return msg.effort === undefined ? { model: msg.model } : { model: msg.model, effort: msg.effort };
}

export function apply(
  current: Settings,
  msg: SettingsMessage,
  providers: readonly ProviderOption[],
): Result<ApplyOutcome, SettingsApplyError> {
  const option = findProvider(providers, msg.provider);
  if (option === undefined || !option.enabled) return { ok: false, error: "provider_disabled" };
  if (option.models.length === 0) return { ok: false, error: "models_unconfigured" };
  if (!option.models.includes(msg.model)) return { ok: false, error: "model_unlisted" };
  if (msg.effort !== undefined && !option.efforts.includes(msg.effort))
    return { ok: false, error: "effort_unsupported" };
  if (msg.chat === undefined) {
    return {
      ok: true,
      value: { settings: { global: toGlobalChoice(msg), perChat: current.perChat } },
    };
  }
  return {
    ok: true,
    value: {
      settings: {
        global: current.global,
        perChat: { ...current.perChat, [msg.chat]: toPerChatChoice(msg) },
      },
      providerChange: { chatId: msg.chat, provider: msg.provider },
    },
  };
}
