import type { GameToCompanion } from "@wow-companion/contracts";
import { openChat } from "../core/chats.ts";
import type { DaemonContext } from "./context.ts";
import { sendOptions } from "./options.ts";

export async function onHello(
  ctx: DaemonContext,
  msg: Extract<GameToCompanion, { t: "hello" }>,
): Promise<void> {
  ctx.state.helloSeen = true;
  if (msg.again === true) return;
  ctx.state.game = {};
  await ctx.describe.refresh();
  sendOptions(ctx);
  const opened = openChat(ctx.state.chats, ctx.state.chats.activeId);
  if (opened.ok) {
    ctx.state.chats = opened.value.state;
    ctx.persistChats();
    ctx.out.sendAll(opened.value.effects);
  }
}
