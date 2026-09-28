import { describe, expect, it } from "vitest";
import { apply, settingsApplyErrorMessage } from "../../src/core/settings.ts";
import type { ProviderOption, Settings } from "../../src/core/settings.ts";
import type { GameToCompanion } from "@wow-companion/contracts";

const providers: ProviderOption[] = [
  {
    id: "claude",
    enabled: true,
    models: ["claude-sonnet-5", "claude-opus-5-5"],
    efforts: ["low", "medium", "high"],
  },
  { id: "codex", enabled: false, models: ["gpt-5-codex"], efforts: [] },
  { id: "cursor", enabled: true, models: ["cursor-composer"], efforts: [] },
];

const baseSettings: Settings = {
  global: { provider: "claude", model: "claude-sonnet-5", effort: "medium" },
  perChat: {},
};

function settingsMsg(
  over: Partial<Extract<GameToCompanion, { t: "settings" }>>,
): Extract<GameToCompanion, { t: "settings" }> {
  return { t: "settings", provider: "claude", model: "claude-sonnet-5", ...over };
}

describe("settings.apply", () => {
  it("a global settings change updates the global choice and keeps perChat", () => {
    const result = apply(
      baseSettings,
      settingsMsg({ model: "claude-opus-5-5", effort: "high" }),
      providers,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        settings: {
          global: { provider: "claude", model: "claude-opus-5-5", effort: "high" },
          perChat: {},
        },
      },
    });
  });

  it("a chat-only settings change updates only that chat's model, drops provider from perChat, and reports the provider change", () => {
    const result = apply(
      baseSettings,
      settingsMsg({ chat: "c1", provider: "codex", model: "gpt-5-codex" }),
      providers.map((p) => (p.id === "codex" ? { ...p, enabled: true } : p)),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        settings: {
          global: baseSettings.global,
          perChat: { c1: { model: "gpt-5-codex" } },
        },
        providerChange: { chatId: "c1", provider: "codex" },
      },
    });
  });

  it("a model the provider does not list is refused, previous settings kept", () => {
    const result = apply(baseSettings, settingsMsg({ model: "not-a-model" }), providers);

    expect(result).toEqual({ ok: false, error: "model_unlisted" });
  });

  it("an effort the provider does not support is refused", () => {
    const result = apply(baseSettings, settingsMsg({ effort: "xhigh" }), providers);

    expect(result).toEqual({ ok: false, error: "effort_unsupported" });
  });

  it("a disabled provider is refused", () => {
    const result = apply(
      baseSettings,
      settingsMsg({ provider: "codex", model: "gpt-5-codex" }),
      providers,
    );

    expect(result).toEqual({ ok: false, error: "provider_disabled" });
  });

  it("an unlisted provider id is refused", () => {
    const providersWithoutCursor = providers.filter((p) => p.id !== "cursor");
    const result = apply(
      baseSettings,
      settingsMsg({ provider: "cursor", model: "anything" }),
      providersWithoutCursor,
    );

    expect(result).toEqual({ ok: false, error: "provider_disabled" });
  });

  it("a provider with an empty models list is refused with a code, the config-fix wording lives in settingsApplyErrorMessage", () => {
    const providersWithEmptyCursor = providers.map((p) =>
      p.id === "cursor" ? { ...p, models: [] } : p,
    );
    const result = apply(
      baseSettings,
      settingsMsg({ provider: "cursor", model: "whatever" }),
      providersWithEmptyCursor,
    );

    expect(result).toEqual({ ok: false, error: "models_unconfigured" });
  });
});

describe("settingsApplyErrorMessage", () => {
  it("renders each error code to its user-facing wording", () => {
    expect(settingsApplyErrorMessage("provider_disabled", "cursor")).toBe(
      "provider is not enabled",
    );
    expect(settingsApplyErrorMessage("models_unconfigured", "cursor")).toBe(
      "set providers.cursor.models in config.json",
    );
    expect(settingsApplyErrorMessage("model_unlisted", "cursor")).toBe(
      "model is not offered by this provider",
    );
    expect(settingsApplyErrorMessage("effort_unsupported", "cursor")).toBe(
      "effort is not supported by this provider",
    );
  });
});
