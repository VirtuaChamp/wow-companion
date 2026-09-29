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

type ProviderChange = { chatId: string; provider: ProviderId };

export type ApplyOutcome = { settings: Settings; providerChange?: ProviderChange };

type SettingsMessage = Extract<GameToCompanion, { t: "settings" }>;

export function perChatFrom(
  entries: Iterable<readonly [string, PerChatChoice]>,
): Record<string, PerChatChoice> {
  return Object.assign(Object.create(null), Object.fromEntries(entries)) as Record<
    string,
    PerChatChoice
  >;
}

export function chatChoice(settings: Settings, chatId: string): PerChatChoice | undefined {
  return Object.hasOwn(settings.perChat, chatId) ? settings.perChat[chatId] : undefined;
}

export function dropChatChoice(settings: Settings, chatId: string): Settings {
  return {
    ...settings,
    perChat: perChatFrom(Object.entries(settings.perChat).filter(([id]) => id !== chatId)),
  };
}

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

export type SettingsRefusal = { code: "bad_settings"; message: string };

export function settingsRefusal(
  error: SettingsApplyError,
  providerId: ProviderId,
): SettingsRefusal {
  return { code: "bad_settings", message: settingsApplyErrorMessage(error, providerId) };
}

export type OptionChoices = {
  active: ProviderChoice;
  chat?: { id: string } & ProviderChoice;
};

export function optionChoices(
  settings: Settings,
  activeChat: { id: string; provider: ProviderId } | undefined,
): OptionChoices {
  const own = activeChat === undefined ? undefined : chatChoice(settings, activeChat.id);
  if (activeChat === undefined || own === undefined) return { active: settings.global };
  return {
    active: settings.global,
    chat: {
      id: activeChat.id,
      provider: activeChat.provider,
      model: own.model,
      ...(own.effort === undefined ? {} : { effort: own.effort }),
    },
  };
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
        perChat: perChatFrom([
          ...Object.entries(current.perChat),
          [msg.chat, toPerChatChoice(msg)],
        ]),
      },
      providerChange: { chatId: msg.chat, provider: msg.provider },
    },
  };
}
