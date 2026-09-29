import { isProviderId } from "@wow-companion/contracts";
import type { ProviderId, Result } from "@wow-companion/contracts";
import type { ChatState, ChatsState, HistoryLine } from "../core/chats.ts";
import { isRecord, readJsonFile, writeJsonAtomic } from "./json-file.ts";

export type StateStoreError = "read_missing" | "read_failed" | "parse_failed" | "write_failed";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseHistoryLine(value: unknown): HistoryLine | undefined {
  if (!isRecord(value)) return undefined;
  const who = value.who;
  if (who !== "you" && !isProviderId(who)) return undefined;
  if (!isString(value.text) || !isNumber(value.at)) return undefined;
  const line: HistoryLine = { who: who as "you" | ProviderId, text: value.text, at: value.at };
  if (value.kind !== undefined) {
    if (value.kind !== "notice") return undefined;
    line.kind = "notice";
  }
  return line;
}

function parseHistory(value: unknown): HistoryLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines: HistoryLine[] = [];
  for (const item of value) {
    const line = parseHistoryLine(item);
    if (line === undefined) return undefined;
    lines.push(line);
  }
  return lines;
}

function parseChatState(value: unknown): ChatState | undefined {
  if (!isRecord(value)) return undefined;
  if (!isString(value.id) || !isString(value.name) || !isProviderId(value.provider))
    return undefined;
  if (!isNumber(value.unread) || !isNumber(value.lastAt)) return undefined;
  const history = parseHistory(value.history);
  if (history === undefined) return undefined;
  const chat: ChatState = {
    id: value.id,
    name: value.name,
    provider: value.provider,
    unread: value.unread,
    lastAt: value.lastAt,
    history,
  };
  if (value.sessionId !== undefined) {
    if (!isString(value.sessionId)) return undefined;
    chat.sessionId = value.sessionId;
  }
  return chat;
}

function parseChatsState(value: unknown): ChatsState | undefined {
  if (!isRecord(value)) return undefined;
  if (!isString(value.activeId)) return undefined;
  if (!Array.isArray(value.chats)) return undefined;
  const chats: ChatState[] = [];
  const seenIds = new Set<string>();
  for (const item of value.chats) {
    const chat = parseChatState(item);
    if (chat === undefined) return undefined;
    if (seenIds.has(chat.id)) return undefined;
    seenIds.add(chat.id);
    chats.push(chat);
  }
  const activeNamesAChat = chats.some((chat) => chat.id === value.activeId);
  if (chats.length === 0 ? value.activeId !== "" : !activeNamesAChat) return undefined;
  return { activeId: value.activeId, chats };
}

export async function readChatsState(
  filePath: string,
): Promise<Result<ChatsState, StateStoreError>> {
  const read = await readJsonFile(filePath);
  if (!read.ok) return read;
  const state = parseChatsState(read.value);
  return state === undefined ? { ok: false, error: "parse_failed" } : { ok: true, value: state };
}

export function writeChatsState(
  filePath: string,
  state: ChatsState,
): Promise<Result<void, StateStoreError>> {
  return writeJsonAtomic(filePath, state);
}
