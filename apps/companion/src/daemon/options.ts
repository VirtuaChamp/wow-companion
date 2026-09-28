import type { CompanionToGame } from "@wow-companion/contracts";
import { optionChoices } from "../core/settings.ts";
import type { ProviderOption } from "../core/settings.ts";
import { activeChat } from "./context.ts";
import type { DaemonContext } from "./context.ts";
import { PROVIDER_ORDER } from "./describe.ts";
import type { Descriptions } from "./describe.ts";

export function providerOptions(described: Descriptions): ProviderOption[] {
  return PROVIDER_ORDER.flatMap((id) => {
    const description = described.get(id);
    return description === undefined
      ? []
      : [
          {
            id,
            enabled: description.enabled,
            models: description.models,
            efforts: description.efforts,
          },
        ];
  });
}

function buildOptions(ctx: DaemonContext): CompanionToGame {
  const described = ctx.describe.cached();
  const active = activeChat(ctx);
  const { settings } = ctx.state;
  const choices = optionChoices(
    settings,
    active === undefined ? undefined : { id: active.id, provider: active.provider },
  );
  return {
    t: "options",
    providers: PROVIDER_ORDER.map((id) => {
      const description = described.get(id) ?? {
        installed: false,
        enabled: false,
        models: [],
        efforts: [],
      };
      const configured = ctx.config.providers[id];
      const source = settings.global.provider === id ? settings.global : configured;
      return {
        id,
        installed: description.installed,
        enabled: description.enabled,
        ...(description.reason === undefined ? {} : { reason: description.reason }),
        models: [...description.models],
        efforts: [...description.efforts],
        current: {
          model: source.model,
          ...(source.effort === undefined ? {} : { effort: source.effort }),
        },
      };
    }),
    active: choices.active,
    ...(choices.chat === undefined ? {} : { chat: choices.chat }),
    ...(ctx.version === undefined ? {} : { companionVersion: ctx.version }),
  };
}

export function sendOptions(ctx: DaemonContext): void {
  ctx.out.send(buildOptions(ctx));
}
