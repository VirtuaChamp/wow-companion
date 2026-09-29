import type { CompanionToGame, ProviderError, ProviderId, Result } from "@wow-companion/contracts";

export type EpochSeconds = number;

export type HistoryLine = {
  who: "you" | ProviderId;
  text: string;
  at: EpochSeconds;
  kind?: "notice";
};

type RunningAsk = { id: string; text: string; cancelling?: boolean };

export type ChatState = {
  id: string;
  name: string;
  provider: ProviderId;
  sessionId?: string;
  runningAsk?: RunningAsk;
  unread: number;
  lastAt: EpochSeconds;
  history: readonly HistoryLine[];
};

export type ChatsState = {
  readonly activeId: string;
  readonly chats: readonly ChatState[];
};

export type ChatsError = "not_found" | "busy" | "exists";

export type ChatsOutcome = { state: ChatsState; effects: readonly CompanionToGame[] };

export type BeginAskOutcome = ChatsOutcome & { sessionId?: string };

type RetryAsk = { askId: string; text: string; transcriptSummary: string };

export type FailAskOutcome = ChatsOutcome & { retry?: RetryAsk };

const HISTORY_LIMIT = 200;
const SUMMARY_LINE_LIMIT = 50;
const SUMMARY_CHAR_LIMIT = 4000;
const REPLY_SUMMARY_LIMIT = 200;

export const emptyChatsState: ChatsState = { activeId: "", chats: [] };

function findChat(state: ChatsState, id: string): ChatState | undefined {
  return state.chats.find((chat) => chat.id === id);
}

function replaceChat(
  state: ChatsState,
  id: string,
  updater: (chat: ChatState) => ChatState,
): ChatsState {
  return { ...state, chats: state.chats.map((chat) => (chat.id === id ? updater(chat) : chat)) };
}

function pushHistory(history: readonly HistoryLine[], line: HistoryLine): HistoryLine[] {
  const next = [...history, line];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

function clearSessionId(chat: ChatState): ChatState {
  const clone: ChatState = { ...chat };
  delete clone.sessionId;
  return clone;
}

function clearRunningAsk(chat: ChatState): ChatState {
  const clone: ChatState = { ...chat };
  delete clone.runningAsk;
  return clone;
}

function byMostRecent(a: ChatState, b: ChatState): number {
  return b.lastAt - a.lastAt;
}

function toChatsMessage(state: ChatsState): CompanionToGame {
  return {
    t: "chats",
    active: state.activeId,
    list: [...state.chats].sort(byMostRecent).map((chat) => ({
      id: chat.id,
      name: chat.name,
      provider: chat.provider,
      lastAt: chat.lastAt,
      running: chat.runningAsk !== undefined,
      unread: chat.unread,
    })),
  };
}

function toHistoryMessage(chat: ChatState): CompanionToGame {
  return {
    t: "history",
    chat: chat.id,
    lines: chat.history.map((line) => ({ who: line.who, text: line.text, at: line.at })),
  };
}

function summarizeHistory(history: readonly HistoryLine[]): string {
  const text = history
    .filter((line) => line.kind !== "notice")
    .slice(-SUMMARY_LINE_LIMIT)
    .map((line) => `${line.who}: ${line.text}`)
    .join("\n");
  return text.length > SUMMARY_CHAR_LIMIT ? text.slice(text.length - SUMMARY_CHAR_LIMIT) : text;
}

function summarizeReply(text: string): string {
  const lines = text.split("\n");
  let firstLine = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      firstLine = trimmed;
      break;
    }
  }
  return firstLine.length > REPLY_SUMMARY_LIMIT
    ? `${firstLine.slice(0, REPLY_SUMMARY_LIMIT)}…`
    : firstLine;
}

function providerErrorMessage(error: ProviderError): string {
  switch (error) {
    case "session_unknown":
      return "provider lost the session, starting over is required";
    case "provider_missing":
      return "provider is not installed";
    case "provider_auth":
      return "provider authentication failed";
    case "provider_disabled":
      return "provider is disabled";
    case "provider_failed":
      return "provider failed";
    case "timeout":
      return "provider timed out";
    case "cancelled":
      return "cancelled";
  }
}

export function createChat(
  state: ChatsState,
  id: string,
  name: string,
  provider: ProviderId,
  now: EpochSeconds,
): Result<ChatsOutcome, ChatsError> {
  if (findChat(state, id) !== undefined) return { ok: false, error: "exists" };
  const chat: ChatState = { id, name, provider, unread: 0, lastAt: now, history: [] };
  const nextState: ChatsState = { activeId: id, chats: [...state.chats, chat] };
  return {
    ok: true,
    value: { state: nextState, effects: [toChatsMessage(nextState), toHistoryMessage(chat)] },
  };
}

export function setChatProvider(
  state: ChatsState,
  id: string,
  provider: ProviderId,
): Result<ChatsOutcome, ChatsError> {
  const chat = findChat(state, id);
  if (chat === undefined) return { ok: false, error: "not_found" };
  if (chat.runningAsk !== undefined) return { ok: false, error: "busy" };
  if (chat.provider === provider) return { ok: true, value: { state, effects: [] } };
  const updated = clearSessionId({ ...chat, provider });
  const nextState = replaceChat(state, id, () => updated);
  return { ok: true, value: { state: nextState, effects: [toChatsMessage(nextState)] } };
}

export function openChat(state: ChatsState, id: string): Result<ChatsOutcome, ChatsError> {
  const chat = findChat(state, id);
  if (chat === undefined) return { ok: false, error: "not_found" };
  const opened = { ...chat, unread: 0 };
  const openedState = replaceChat({ ...state, activeId: id }, id, () => opened);
  return {
    ok: true,
    value: {
      state: openedState,
      effects: [toChatsMessage(openedState), toHistoryMessage(opened)],
    },
  };
}

export function renameChat(
  state: ChatsState,
  id: string,
  name: string,
): Result<ChatsOutcome, ChatsError> {
  if (findChat(state, id) === undefined) return { ok: false, error: "not_found" };
  const nextState = replaceChat(state, id, (chat) => ({ ...chat, name }));
  return { ok: true, value: { state: nextState, effects: [toChatsMessage(nextState)] } };
}

export function deleteChat(state: ChatsState, id: string): Result<ChatsOutcome, ChatsError> {
  const chat = findChat(state, id);
  if (chat === undefined) return { ok: false, error: "not_found" };
  if (chat.runningAsk !== undefined) return { ok: false, error: "busy" };
  const remaining = state.chats.filter((chat) => chat.id !== id);
  const activeId =
    state.activeId === id ? ([...remaining].sort(byMostRecent)[0]?.id ?? "") : state.activeId;
  const nextState: ChatsState = { activeId, chats: remaining };
  return { ok: true, value: { state: nextState, effects: [toChatsMessage(nextState)] } };
}

export function resetChat(state: ChatsState, id: string): Result<ChatsOutcome, ChatsError> {
  const chat = findChat(state, id);
  if (chat === undefined) return { ok: false, error: "not_found" };
  if (chat.runningAsk !== undefined) return { ok: false, error: "busy" };
  const reset = clearSessionId({ ...chat, history: [] });
  const nextState = replaceChat(state, id, () => reset);
  return {
    ok: true,
    value: {
      state: nextState,
      effects: [toChatsMessage(nextState), toHistoryMessage(reset)],
    },
  };
}

export function cancelChat(
  state: ChatsState,
  id: string,
): Result<ChatsOutcome & { askId?: string }, ChatsError> {
  const chat = findChat(state, id);
  if (chat === undefined) return { ok: false, error: "not_found" };
  const running = chat.runningAsk;
  if (running === undefined) {
    return { ok: true, value: { state, effects: [toChatsMessage(state)] } };
  }
  const nextState = replaceChat(state, id, (c) => ({
    ...c,
    runningAsk: { ...running, cancelling: true },
  }));
  return {
    ok: true,
    value: { state: nextState, effects: [toChatsMessage(nextState)], askId: running.id },
  };
}

export function beginAsk(
  state: ChatsState,
  chatId: string,
  askId: string,
  text: string,
  now: EpochSeconds,
): Result<BeginAskOutcome, ChatsError> {
  const chat = findChat(state, chatId);
  if (chat === undefined) return { ok: false, error: "not_found" };
  if (chat.runningAsk !== undefined) return { ok: false, error: "busy" };
  const nextState = replaceChat(state, chatId, (c) => ({
    ...c,
    runningAsk: { id: askId, text },
    lastAt: now,
    history: pushHistory(c.history, { who: "you", text, at: now }),
  }));
  const effects: readonly CompanionToGame[] = [toChatsMessage(nextState)];
  return {
    ok: true,
    value:
      chat.sessionId === undefined
        ? { state: nextState, effects }
        : { state: nextState, effects, sessionId: chat.sessionId },
  };
}

export function completeAsk(
  state: ChatsState,
  chatId: string,
  askId: string,
  outcome: { sessionId: string; text: string },
  now: EpochSeconds,
): Result<ChatsOutcome, ChatsError> {
  const chat = findChat(state, chatId);
  if (chat === undefined || chat.runningAsk?.id !== askId) return { ok: false, error: "not_found" };
  const unreadDelta = chatId !== state.activeId ? 1 : 0;
  const nextState = replaceChat(state, chatId, (c) =>
    clearRunningAsk({
      ...c,
      sessionId: outcome.sessionId,
      unread: c.unread + unreadDelta,
      lastAt: now,
      history: pushHistory(c.history, { who: c.provider, text: outcome.text, at: now }),
    }),
  );
  const effects: readonly CompanionToGame[] = [
    toChatsMessage(nextState),
    {
      t: "reply",
      id: askId,
      chat: chatId,
      provider: chat.provider,
      summary: summarizeReply(outcome.text),
      full: outcome.text,
    },
  ];
  return { ok: true, value: { state: nextState, effects } };
}

export function failAsk(
  state: ChatsState,
  chatId: string,
  askId: string,
  error: ProviderError,
  now: EpochSeconds,
): Result<FailAskOutcome, ChatsError> {
  const chat = findChat(state, chatId);
  if (chat === undefined || chat.runningAsk?.id !== askId) return { ok: false, error: "not_found" };
  const cancelling = chat.runningAsk.cancelling === true;
  if (error === "session_unknown" && chat.sessionId !== undefined && !cancelling) {
    const transcriptSummary = summarizeHistory(chat.history.slice(0, -1));
    const notice: HistoryLine = {
      who: chat.provider,
      text: "session expired, starting a new one",
      at: now,
      kind: "notice",
    };
    const updated = clearSessionId({
      ...chat,
      lastAt: now,
      history: pushHistory(chat.history, notice),
    });
    const nextState = replaceChat(state, chatId, () => updated);
    return {
      ok: true,
      value: {
        state: nextState,
        effects: [toChatsMessage(nextState), toHistoryMessage(updated)],
        retry: { askId, text: chat.runningAsk.text, transcriptSummary },
      },
    };
  }
  const terminal: ProviderError = cancelling ? "cancelled" : error;
  const unreadDelta = terminal === "cancelled" ? 0 : chatId !== state.activeId ? 1 : 0;
  const nextState = replaceChat(state, chatId, (c) =>
    clearRunningAsk({ ...c, unread: c.unread + unreadDelta, lastAt: now }),
  );
  return {
    ok: true,
    value: {
      state: nextState,
      effects: [
        toChatsMessage(nextState),
        { t: "error", id: askId, code: terminal, message: providerErrorMessage(terminal) },
      ],
    },
  };
}
