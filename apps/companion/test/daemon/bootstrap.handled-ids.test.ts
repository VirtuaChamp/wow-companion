import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadStartup } from "../../src/daemon/bootstrap.ts";

describe("loadStartup handled ids", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "wowc-bootstrap-"));
    await writeFile(
      path.join(root, "config.json"),
      JSON.stringify({
        wowPath: "x",
        provider: "claude",
        providers: {
          claude: { enabled: true, model: "m", models: [] },
          codex: { enabled: false, model: "m", models: [] },
          cursor: { enabled: false, model: "m", models: [] },
        },
        companionPort: 47831,
        slotCount: 200,
        timeoutMs: 1000,
      }),
    );
    await mkdir(path.join(root, "apps", "companion", "state"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("starts with no handled ids when the file is missing", async () => {
    const loaded = await loadStartup(root, () => undefined);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.files.handledIds).toBe(
        path.join(root, "apps", "companion", "state", "handled-ids.json"),
      );
      expect(loaded.value.handledIds.has("ask:x")).toBe(false);
    }
  });

  it("refuses to start on a malformed handled-ids.json and names the file", async () => {
    await writeFile(path.join(root, "apps", "companion", "state", "handled-ids.json"), "oops");
    const loaded = await loadStartup(root, () => undefined);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error).toContain("handled-ids.json");
      expect(loaded.error).toContain("parse_failed");
    }
  });

  it("loads the ids a previous run persisted", async () => {
    await writeFile(
      path.join(root, "apps", "companion", "state", "handled-ids.json"),
      JSON.stringify(["cmd:cmd-1"]),
    );
    const loaded = await loadStartup(root, () => undefined);
    expect(loaded.ok && loaded.value.handledIds.has("cmd:cmd-1")).toBe(true);
  });
});
