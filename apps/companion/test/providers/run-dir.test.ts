import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cleanupRunDir, safeRunDir } from "../../src/adapters/providers/run-dir.ts";
import { fixturePath } from "./helpers.ts";

describe("run-dir.cleanupRunDir", () => {
  test("removes an existing run directory without reporting", () => {
    const dir = safeRunDir(fixturePath(), "tmp-cleanup", "cleanup-ok");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "marker.txt"), "x");
    let reported = false;
    cleanupRunDir(dir, () => {
      reported = true;
    });
    expect(reported).toBe(false);
  });

  test("reports the leaked path instead of swallowing the error silently", () => {
    const badDir = "\0not-a-real-path";
    let reportedDir: string | undefined;
    let reportedError: unknown;
    cleanupRunDir(badDir, (d, error) => {
      reportedDir = d;
      reportedError = error;
    });
    expect(reportedDir).toBe(badDir);
    expect(reportedError).toBeDefined();
  });
});
