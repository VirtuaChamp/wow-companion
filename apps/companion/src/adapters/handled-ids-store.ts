import type { Result } from "@wow-companion/contracts";
import { createHandledIds, HANDLED_IDS_MAX } from "../transport/handled-ids.ts";
import type { HandledIds } from "../transport/handled-ids.ts";
import { readJsonFile, writeJsonAtomic } from "./json-file.ts";

export type HandledIdsReadError = "read_failed" | "parse_failed";

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export async function openHandledIds(
  filePath: string,
  max: number = HANDLED_IDS_MAX,
): Promise<Result<HandledIds, HandledIdsReadError>> {
  const read = await readJsonFile(filePath);
  if (!read.ok && read.error !== "read_missing") {
    return { ok: false, error: read.error };
  }
  if (read.ok && !isIdList(read.value)) {
    return { ok: false, error: "parse_failed" };
  }
  const initial = read.ok ? (read.value as string[]) : [];
  return {
    ok: true,
    value: createHandledIds(initial, max, (ids) => writeJsonAtomic(filePath, ids)),
  };
}
