import type { ChatsError, ChatsOutcome } from "../core/chats.ts";
import type { DaemonContext } from "./context.ts";
import { sendOptions } from "./options.ts";

export function chatsErrorMessage(error: ChatsError): string {
  switch (error) {
    case "busy":
      return "this chat is already running an ask";
    case "not_found":
      return "chat not found";
    case "exists":
      return "chat already exists";
  }
}

export function commit(ctx: DaemonContext, outcome: ChatsOutcome): void {
  const previousActive = ctx.state.chats.activeId;
  ctx.state.chats = outcome.state;
  ctx.persistChats();
  ctx.out.sendAll(outcome.effects);
  if (outcome.state.activeId !== previousActive) sendOptions(ctx);
}

export function reportChatsError(ctx: DaemonContext, error: ChatsError, askId?: string): void {
  switch (error) {
    case "busy":
      ctx.out.send({
        t: "error",
        ...(askId === undefined ? {} : { id: askId }),
        code: "busy",
        message: chatsErrorMessage(error),
      });
      return;
    case "not_found":
    case "exists":
      ctx.log(chatsErrorMessage(error));
      return;
  }
}
