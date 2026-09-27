import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { err, ok, type Result } from "../lib/result.ts";
import type { ExportedData } from "./rows.ts";
import { validateExportedData } from "./validate.ts";

export const DEFAULT_EXPORTER_TIMEOUT_MS = 120_000;
export const DEFAULT_MEMORY_CEILING_KB = 512 * 1024;

const EXPECTED_ARRAYS: (keyof ExportedData)[] = [
  "npc",
  "npc_spawn",
  "quest",
  "quest_start",
  "quest_end",
  "object",
  "object_spawn",
  "item",
  "item_source",
];

const isExportedData = (value: unknown): value is ExportedData => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return EXPECTED_ARRAYS.every((key) => Array.isArray(record[key]));
};

export const runExporter = (
  luaCommand: string,
  exporterPath: string,
  dataForeverDir: string,
  areaMapPath: string,
  timeoutMs: number = DEFAULT_EXPORTER_TIMEOUT_MS,
  memoryCeilingKb: number = DEFAULT_MEMORY_CEILING_KB,
): Result<ExportedData, string> => {
  if (!existsSync(dataForeverDir)) {
    return err(`expected checkout folder not found: ${dataForeverDir}`);
  }
  if (!existsSync(areaMapPath)) {
    return err(`expected area map file not found: ${areaMapPath}`);
  }
  const result = spawnSync(
    luaCommand,
    [exporterPath, dataForeverDir, areaMapPath, String(memoryCeilingKb)],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 256,
      timeout: timeoutMs,
    },
  );
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT" || result.signal !== null) {
      return err(`exporter timed out after ${timeoutMs}ms`);
    }
    return err(`failed to launch lua exporter: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr ?? "";
    const message =
      stderr.trim().length > 0 ? stderr.trim() : `lua exporter exited with status ${result.status}`;
    return err(message);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return err("lua exporter produced invalid JSON");
  }
  if (!isExportedData(parsed)) {
    return err("lua exporter produced an unexpected data shape");
  }
  const validationError = validateExportedData(parsed);
  if (validationError !== null) {
    return err(validationError);
  }
  return ok(parsed);
};
