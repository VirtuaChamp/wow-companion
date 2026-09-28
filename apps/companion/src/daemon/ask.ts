import type {
  CompanionToGame,
  Effort,
  GameToCompanion,
  Mention,
  ProviderEvent,
  Snapshot,
} from "@wow-companion/contracts";
import { beginAsk, completeAsk, createChat, failAsk } from "../core/chats.ts";
import type { ChatState } from "../core/chats.ts";
import { build as buildPrompt } from "../core/prompt.ts";
import { chatChoice } from "../core/settings.ts";
import type { RunOutcome } from "../runner.ts";
import { chatsErrorMessage, commit, reportChatsError } from "./commit.ts";
import type { DaemonContext } from "./context.ts";
import { fullSnapshot } from "./state.ts";

const NEWLINE = String.fromCharCode(10);
const SYSTEM_PREFACE =
  "You are an assistant inside World of Warcraft Forever, answering in a small in-game chat window. Keep answers short. Use the wowc tools for game state, world data and waypoints. You are read-only: you cannot run commands or change files.";

type AskInput = {
  chatId: string;
  askId: string;
  text: string;
  mentions: Mention[];
  sessionId?: string;
  transcriptSummary?: string;
};

function formatMention(mention: Mention): string {
  return mention.kind === "quest"
    ? `- quest ${String(mention.questId)}`
    : `- item ${String(mention.itemId)}`;
}

function systemPrompt(
  snapshot: Snapshot | undefined,
  mentions: readonly Mention[],
  transcriptSummary: string | undefined,
): string {
  if (snapshot !== undefined) {
    return `${SYSTEM_PREFACE}${NEWLINE}${NEWLINE}${buildPrompt(snapshot, mentions, transcriptSummary)}`;
  }
  const lines: string[] = [];
  if (transcriptSummary !== undefined && transcriptSummary.length > 0) {
    lines.push("Previous conversation summary:", transcriptSummary, "");
  }
  lines.push("The game state has not arrived yet: the game tools answer not_connected.");
  if (mentions.length > 0) lines.push("Mentions:", ...mentions.map(formatMention));
  return `${SYSTEM_PREFACE}${NEWLINE}${NEWLINE}${lines.join(NEWLINE)}`;
}

function resolveChoice(ctx: DaemonContext, chat: ChatState): { model: string; effort?: Effort } {
  const own = chatChoice(ctx.state.settings, chat.id);
  if (own !== undefined) {
    return { model: own.model, ...(own.effort === undefined ? {} : { effort: own.effort }) };
  }
  const { global } = ctx.state.settings;
  const source = chat.provider === global.provider ? global : ctx.config.providers[chat.provider];
  return {
    model: source.model,
    ...(source.effort === undefined ? {} : { effort: source.effort }),
  };
}

function progressSender(ctx: DaemonContext, askId: string): (event: ProviderEvent) => void {
  let last: string | undefined;
  function push(key: string, msg: CompanionToGame): void {
    if (key === last) return;
    last = key;
    ctx.out.send(msg);
  }
  return (event) => {
    switch (event.kind) {
      case "text":
        push("thinking", { t: "progress", id: askId, status: "thinking" });
        return;
      case "tool":
        if (event.failure !== undefined) ctx.log(`tool ${event.name} failed`);
        push(`tool:${event.name}`, {
          t: "progress",
          id: askId,
          status: "tool",
          detail: event.name,
        });
        return;
      case "session":
        return;
    }
  };
}

async function executeAsk(ctx: DaemonContext, input: AskInput): Promise<void> {
  const chat = ctx.state.chats.chats.find((candidate) => candidate.id === input.chatId);
  if (chat === undefined) return;
  const outcome: RunOutcome = !ctx.config.providers[chat.provider].enabled
    ? { result: { ok: false, error: "provider_disabled" } }
    : await ctx.runner.run(
        {
          askId: input.askId,
          provider: chat.provider,
          ...resolveChoice(ctx, chat),
          prompt: input.text,
          system: systemPrompt(fullSnapshot(ctx), input.mentions, input.transcriptSummary),
          ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        },
        progressSender(ctx, input.askId),
      );
  if (outcome.result.ok) {
    const completed = completeAsk(
      ctx.state.chats,
      input.chatId,
      input.askId,
      outcome.result.value,
      ctx.now(),
    );
    if (!completed.ok) {
      ctx.log(chatsErrorMessage(completed.error));
      return;
    }
    const waypoint = outcome.waypoint;
    commit(ctx, {
      state: completed.value.state,
      effects: completed.value.effects.map((effect) =>
        effect.t === "reply" && waypoint !== undefined ? { ...effect, waypoint } : effect,
      ),
    });
    return;
  }
  const failed = failAsk(
    ctx.state.chats,
    input.chatId,
    input.askId,
    outcome.result.error,
    ctx.now(),
  );
  if (!failed.ok) {
    ctx.log(chatsErrorMessage(failed.error));
    return;
  }
  commit(ctx, failed.value);
  if (failed.value.retry !== undefined) {
    await executeAsk(ctx, {
      chatId: input.chatId,
      askId: input.askId,
      text: failed.value.retry.text,
      mentions: input.mentions,
      transcriptSummary: failed.value.retry.transcriptSummary,
    });
  }
}

function endAskWithError(ctx: DaemonContext, chatId: string, askId: string, cause: unknown): void {
  ctx.log(`ask failed: ${String(cause)}`);
  try {
    const failed = failAsk(ctx.state.chats, chatId, askId, "provider_failed", ctx.now());
    if (failed.ok) commit(ctx, { state: failed.value.state, effects: failed.value.effects });
  } catch (error) {
    ctx.log(`ask ${askId} could not be ended: ${String(error)}`);
  }
}

export function onAsk(ctx: DaemonContext, msg: Extract<GameToCompanion, { t: "ask" }>): void {
  if (!ctx.state.chats.chats.some((chat) => chat.id === msg.chat)) {
    const created = createChat(
      ctx.state.chats,
      msg.chat,
      `Chat ${String(ctx.state.chats.chats.length + 1)}`,
      ctx.state.settings.global.provider,
      ctx.now(),
    );
    if (!created.ok) return reportChatsError(ctx, created.error, msg.id);
    commit(ctx, created.value);
  }
  const begun = beginAsk(ctx.state.chats, msg.chat, msg.id, msg.text, ctx.now());
  if (!begun.ok) return reportChatsError(ctx, begun.error, msg.id);
  commit(ctx, begun.value);
  executeAsk(ctx, {
    chatId: msg.chat,
    askId: msg.id,
    text: msg.text,
    mentions: msg.mentions,
    ...(begun.value.sessionId === undefined ? {} : { sessionId: begun.value.sessionId }),
  }).catch((error: unknown) => endAskWithError(ctx, msg.chat, msg.id, error));
}
