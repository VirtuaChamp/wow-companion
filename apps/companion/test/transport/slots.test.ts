import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SLOT_BYTE_CAP,
  createSlotAllocator,
  encodeSlotContent,
  writeSlot,
} from "../../src/transport/slots.ts";
import type { SlotPaths } from "../../src/transport/slots.ts";
import { makeMemoryFs } from "./memory-fs.ts";
import type { CompanionToGame } from "@wow-companion/contracts";

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");

function reportsLua515(command: string): boolean {
  const probe = spawnSync(command, ["-v"], { encoding: "utf8" });
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  return probe.error === undefined && output.includes("Lua 5.1.5");
}

function resolveLuaCommand(): string {
  const isWin = process.platform === "win32" && process.arch === "x64";
  const isLinux = process.platform === "linux" && process.arch === "x64";
  if (!isWin && !isLinux) {
    throw new Error(`unsupported platform/arch: ${process.platform}-${process.arch}`);
  }
  const linkName = isWin ? "lua.exe" : "lua";
  const installedPath = join(repoRoot, ".tools", "lua51", linkName);
  const candidates = existsSync(installedPath) ? [installedPath] : ["lua5.1", "lua"];
  for (const candidate of candidates) {
    if (reportsLua515(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "no lua interpreter reporting Lua 5.1.5 found in .tools/lua51 or on PATH; run pnpm run lua:setup first",
  );
}

function safeBracketLevel(source: string): number {
  let level = 0;
  const pattern = /]=*]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const found = match[0].length - 2;
    if (found >= level) {
      level = found + 1;
    }
  }
  return level;
}

function loadstringChecks(luaSource: string): { ok: boolean; error: string } {
  const lua = resolveLuaCommand();
  const eq = "=".repeat(safeBracketLevel(luaSource));
  const script = `local chunk, err = loadstring([${eq}[${luaSource}]${eq}]); if not chunk then io.stderr:write(err); os.exit(1) end; os.exit(0)`;
  const result = spawnSync(lua, ["-e", script], { encoding: "utf8" });
  return { ok: result.status === 0, error: result.stderr ?? "" };
}

function runDeliverChunk(content: string): { session: unknown; msgs: unknown } {
  const lua = resolveLuaCommand();
  const dir = mkdtempSync(join(tmpdir(), "wowc-deliver-"));
  const contentPath = join(dir, "deliver.lua");
  writeFileSync(contentPath, content, "utf-8");
  const result = spawnSync(lua, [join(import.meta.dirname, "run_deliver_chunk.lua"), contentPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`lua deliver harness failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as { session: unknown; msgs: unknown };
}

const paths: SlotPaths = {
  addonDeliverFile: (i) => `addons/WoWCompanion_R${i}/r.lua`,
  signalFile: (i) => `sig/${i}.wav`,
};

describe("slots.write", () => {
  it("writes a valid Lua literal that round-trips through Lua 5.1.5 loadstring", async () => {
    const writes: { path: string; data: string | Uint8Array }[] = [];
    const fs = makeMemoryFs(writes);
    const allocator = createSlotAllocator(200);
    const msgs: CompanionToGame[] = [{ t: "ack", seq: 7 }];
    const result = await writeSlot(fs, paths, allocator, "sess-1", msgs);
    expect(result.ok).toBe(true);
    const written = writes.find((w) => w.path.includes("r.lua"));
    expect(written).toBeDefined();
    const content = written?.data as string;
    expect(content.startsWith("WoWCompanion_Deliver(")).toBe(true);
    const check = loadstringChecks(content);
    expect(check.error).toBe("");
    expect(check.ok).toBe(true);
  });

  it("escapes ]], backslash, quotes and newlines and still round-trips", async () => {
    const writes: { path: string; data: string | Uint8Array }[] = [];
    const fs = makeMemoryFs(writes);
    const allocator = createSlotAllocator(200);
    const tricky = 'a]]b\\c"d\ne\rf';
    const msgs: CompanionToGame[] = [
      { t: "reply", id: "x", chat: "c", provider: "claude", summary: tricky, full: tricky },
    ];
    const result = await writeSlot(fs, paths, allocator, "sess-1", msgs);
    expect(result.ok).toBe(true);
    const content = writes.find((w) => w.path.includes("r.lua"))?.data as string;
    const check = loadstringChecks(content);
    expect(check.error).toBe("");
    expect(check.ok).toBe(true);

    const delivered = runDeliverChunk(content);
    expect(delivered.session).toBe("sess-1");
    expect(delivered.msgs).toEqual([
      { t: "reply", id: "x", chat: "c", provider: "claude", summary: tricky, full: tricky },
    ]);
  });

  it("executes the delivered chunk and decodes the exact values, not just a compiling chunk", async () => {
    const writes: { path: string; data: string | Uint8Array }[] = [];
    const fs = makeMemoryFs(writes);
    const allocator = createSlotAllocator(200);
    const msgs: CompanionToGame[] = [
      { t: "chats", active: "c1", list: [] },
      { t: "ack", seq: 42 },
    ];
    const result = await writeSlot(fs, paths, allocator, "sess-exec", msgs);
    expect(result.ok).toBe(true);
    const content = writes.find((w) => w.path.includes("r.lua"))?.data as string;

    const delivered = runDeliverChunk(content);
    expect(delivered.session).toBe("sess-exec");
    expect(delivered.msgs).toEqual(msgs);
  });

  it("writes r.lua to a temp file, renames it over r.lua, and only then deletes the signal file", async () => {
    const writes: { path: string; data: string | Uint8Array }[] = [];
    const fs = makeMemoryFs(writes);
    const allocator = createSlotAllocator(200);
    await writeSlot(fs, paths, allocator, "sess-1", [{ t: "ack", seq: 1 }]);
    expect(fs.ops).toEqual([
      "write addons/WoWCompanion_R0/r.lua.tmp",
      "rename addons/WoWCompanion_R0/r.lua.tmp addons/WoWCompanion_R0/r.lua",
      "remove sig/0.wav",
    ]);
    expect(fs.files.has("addons/WoWCompanion_R0/r.lua.tmp")).toBe(false);
    expect(fs.files.has("sig/0.wav")).toBe(false);
    expect(fs.files.has("sig/1.wav")).toBe(true);
  });

  it("does not delete the signal file when the write or the rename failed, and does not advance the allocator", async () => {
    for (const failing of ["write", "rename"] as const) {
      const fs = makeMemoryFs([], {
        hooks: {
          beforeWrite() {
            if (failing === "write") throw new Error("EBUSY");
          },
          beforeRename() {
            if (failing === "rename") throw new Error("EPERM");
          },
        },
      });
      const allocator = createSlotAllocator(200);
      await expect(
        writeSlot(fs, paths, allocator, "sess-1", [{ t: "ack", seq: 1 }]),
      ).rejects.toThrow();
      expect(fs.removed).toEqual([]);
      expect(fs.files.has("sig/0.wav")).toBe(true);
      expect(allocator.position()).toBe(0);
    }
  });

  it("a reply message alone over 64 KB yields too_large, not truncated", () => {
    const huge = "x".repeat(SLOT_BYTE_CAP);
    const result = encodeSlotContent("sess-1", [
      { t: "reply", id: "x", chat: "c", provider: "claude", summary: "s", full: huge },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("too_large");
    }
  });
});

describe("slots.exhausted", () => {
  it("the 201st delivery returns slots_exhausted", async () => {
    const writes: { path: string; data: string | Uint8Array }[] = [];
    const fs = makeMemoryFs(writes);
    const allocator = createSlotAllocator(200);
    let lastResult;
    for (let i = 0; i < 200; i += 1) {
      lastResult = await writeSlot(fs, paths, allocator, "sess-1", [{ t: "ack", seq: i }]);
      expect(lastResult.ok).toBe(true);
    }
    expect(allocator.left()).toBe(0);
    const overflow = await writeSlot(fs, paths, allocator, "sess-1", [{ t: "ack", seq: 999 }]);
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.error).toBe("slots_exhausted");
    }
  });
});
