import { isEffort, isProviderId } from "@wow-companion/contracts";
import type { Result } from "@wow-companion/contracts";
import { perChatFrom } from "../core/settings.ts";
import type { PerChatChoice, ProviderChoice, Settings } from "../core/settings.ts";
import { isRecord, readJsonFile, writeJsonAtomic } from "./json-file.ts";
import type { JsonFileError } from "./json-file.ts";

function parseGlobal(value: unknown): ProviderChoice | undefined {
  if (!isRecord(value)) return undefined;
  if (!isProviderId(value.provider) || typeof value.model !== "string") return undefined;
  if (value.effort === undefined) return { provider: value.provider, model: value.model };
  if (!isEffort(value.effort)) return undefined;
  return { provider: value.provider, model: value.model, effort: value.effort };
}

function parsePerChat(value: unknown): PerChatChoice | undefined {
  if (!isRecord(value) || typeof value.model !== "string") return undefined;
  if (value.effort === undefined) return { model: value.model };
  if (!isEffort(value.effort)) return undefined;
  return { model: value.model, effort: value.effort };
}

function parseSettings(value: unknown): Settings | undefined {
  if (!isRecord(value)) return undefined;
  const global = parseGlobal(value.global);
  if (global === undefined || !isRecord(value.perChat)) return undefined;
  const entries: [string, PerChatChoice][] = [];
  for (const [chatId, entry] of Object.entries(value.perChat)) {
    const choice = parsePerChat(entry);
    if (choice === undefined) return undefined;
    entries.push([chatId, choice]);
  }
  return { global, perChat: perChatFrom(entries) };
}

export async function readSettings(filePath: string): Promise<Result<Settings, JsonFileError>> {
  const read = await readJsonFile(filePath);
  if (!read.ok) return read;
  const settings = parseSettings(read.value);
  return settings === undefined
    ? { ok: false, error: "parse_failed" }
    : { ok: true, value: settings };
}

export function writeSettings(
  filePath: string,
  settings: Settings,
): Promise<Result<void, JsonFileError>> {
  return writeJsonAtomic(filePath, settings);
}
