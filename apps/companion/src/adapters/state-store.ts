import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderId, Result } from "@wow-companion/contracts";
import type { ChatState, ChatsState, HistoryLine } from "../core/chats.ts";

export type StateStoreError = "read_missing" | "read_failed" | "parse_failed" | "write_failed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const providerIds: readonly ProviderId[] = ["claude", "codex", "cursor"];

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (providerIds as readonly string[]).includes(value);
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
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    return code === "ENOENT"
      ? { ok: false, error: "read_missing" }
      : { ok: false, error: "read_failed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "parse_failed" };
  }
  const state = parseChatsState(parsed);
  if (state === undefined) return { ok: false, error: "parse_failed" };
  return { ok: true, value: state };
}

export async function writeChatsState(
  filePath: string,
  state: ChatsState,
): Promise<Result<void, StateStoreError>> {
  try {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tempPath = path.join(
      dir,
      `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`,
    );
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, filePath);
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}
