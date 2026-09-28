import type { GameToCompanion } from "@wow-companion/contracts";
import type { Config } from "../config.ts";
import { setChatProvider } from "../core/chats.ts";
import { apply, perChatFrom, settingsRefusal } from "../core/settings.ts";
import type { Settings } from "../core/settings.ts";
import { chatsErrorMessage } from "./commit.ts";
import type { DaemonContext } from "./context.ts";
import { providerOptions, sendOptions } from "./options.ts";

export function settingsFromConfig(config: Config): Settings {
  const provider = config.providers[config.provider];
  return {
    global: {
      provider: config.provider,
      model: provider.model,
      ...(provider.effort === undefined ? {} : { effort: provider.effort }),
    },
    perChat: perChatFrom([]),
  };
}

export async function onSettings(
  ctx: DaemonContext,
  msg: Extract<GameToCompanion, { t: "settings" }>,
): Promise<void> {
  const described = await ctx.describe.ensureFresh(ctx.describeMaxAgeMs);
  const applied = apply(ctx.state.settings, msg, providerOptions(described));
  if (!applied.ok) {
    const refusal = settingsRefusal(applied.error, msg.provider);
    ctx.out.send({ t: "error", code: refusal.code, message: refusal.message });
    sendOptions(ctx);
    return;
  }
  const change = applied.value.providerChange;
  const changingChat =
    change === undefined
      ? undefined
      : ctx.state.chats.chats.find((chat) => chat.id === change.chatId);
  if (
    change !== undefined &&
    (changingChat === undefined || changingChat.provider !== change.provider)
  ) {
    const changed = setChatProvider(ctx.state.chats, change.chatId, change.provider);
    if (!changed.ok) {
      ctx.out.send({ t: "error", code: "bad_settings", message: chatsErrorMessage(changed.error) });
      sendOptions(ctx);
      return;
    }
    ctx.state.chats = changed.value.state;
    ctx.persistChats();
    ctx.out.sendAll(changed.value.effects);
  }
  ctx.state.settings = applied.value.settings;
  ctx.persistSettings();
  sendOptions(ctx);
}
