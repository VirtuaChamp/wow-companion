import type { GameToCompanion, Result } from "@wow-companion/contracts";
import {
  cancelChat,
  createChat,
  deleteChat,
  openChat,
  renameChat,
  resetChat,
} from "../core/chats.ts";
import type { ChatsError, ChatsOutcome } from "../core/chats.ts";
import { dropChatChoice } from "../core/settings.ts";
import { commit, reportChatsError } from "./commit.ts";
import { DEFAULT_CHAT_ID, DEFAULT_CHAT_NAME } from "./context.ts";
import type { DaemonContext } from "./context.ts";

function newChatName(ctx: DaemonContext, arg: string | undefined): string {
  return arg !== undefined && arg.trim() !== ""
    ? arg.trim()
    : `Chat ${String(ctx.state.chats.chats.length + 1)}`;
}

function deleteWithSeed(ctx: DaemonContext, chatId: string): Result<ChatsOutcome, ChatsError> {
  const deleted = deleteChat(ctx.state.chats, chatId);
  if (!deleted.ok) return deleted;
  ctx.state.settings = dropChatChoice(ctx.state.settings, chatId);
  ctx.persistSettings();
  if (deleted.value.state.chats.length > 0) return deleted;
  const seeded = createChat(
    deleted.value.state,
    DEFAULT_CHAT_ID,
    DEFAULT_CHAT_NAME,
    ctx.state.settings.global.provider,
    ctx.now(),
  );
  return seeded.ok ? seeded : deleted;
}

export function onCmd(ctx: DaemonContext, msg: Extract<GameToCompanion, { t: "cmd" }>): void {
  const { chats } = ctx.state;
  let result: Result<ChatsOutcome, ChatsError>;
  switch (msg.name) {
    case "new":
      result = createChat(
        chats,
        ctx.newId(),
        newChatName(ctx, msg.arg),
        ctx.state.settings.global.provider,
        ctx.now(),
      );
      break;
    case "open":
      result = openChat(chats, msg.chat);
      break;
    case "rename":
      if (msg.arg === undefined || msg.arg.trim() === "") {
        ctx.log("rename without a name ignored");
        return;
      }
      result = renameChat(chats, msg.chat, msg.arg.trim());
      break;
    case "delete":
      result = deleteWithSeed(ctx, msg.chat);
      break;
    case "reset":
      result = resetChat(chats, msg.chat);
      break;
    case "cancel": {
      const cancelled = cancelChat(chats, msg.chat);
      if (cancelled.ok && cancelled.value.askId !== undefined) {
        ctx.runner.cancel(cancelled.value.askId);
      }
      result = cancelled;
      break;
    }
  }
  if (!result.ok) return reportChatsError(ctx, result.error);
  commit(ctx, result.value);
}
