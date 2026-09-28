import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Result } from "@wow-companion/contracts";

export type JsonFileError = "read_missing" | "read_failed" | "parse_failed" | "write_failed";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonFile(
  filePath: string,
): Promise<
  Result<unknown, Extract<JsonFileError, "read_missing" | "read_failed" | "parse_failed">>
> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    return code === "ENOENT"
      ? { ok: false, error: "read_missing" }
      : { ok: false, error: "read_failed" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "parse_failed" };
  }
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<Result<void, Extract<JsonFileError, "write_failed">>> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await rename(tempPath, filePath);
    return { ok: true, value: undefined };
  } catch {
    await rm(tempPath, { force: true }).catch(() => undefined);
    return { ok: false, error: "write_failed" };
  }
}
