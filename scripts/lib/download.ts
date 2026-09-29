import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { type Result, err, ok } from "./result.ts";

export type DownloadSpec = {
  url: string;
  sha256: string;
  destPath: string;
};

export type DownloadError =
  | { kind: "http"; url: string; status: number }
  | { kind: "timeout"; url: string }
  | { kind: "network"; url: string; message: string }
  | { kind: "hash_mismatch"; url: string; expected: string; actual: string };

const downloadTimeoutMs = 30_000;

export const downloadVerified = async (
  spec: DownloadSpec,
): Promise<Result<void, DownloadError>> => {
  try {
    const response = await fetch(spec.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(downloadTimeoutMs),
    });
    if (!response.ok) {
      return err({ kind: "http", url: spec.url, status: response.status });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(buffer).digest("hex");
    if (actual !== spec.sha256) {
      return err({ kind: "hash_mismatch", url: spec.url, expected: spec.sha256, actual });
    }
    await writeFile(spec.destPath, buffer);
    return ok(undefined);
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") {
      return err({ kind: "timeout", url: spec.url });
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    return err({ kind: "network", url: spec.url, message });
  }
};
