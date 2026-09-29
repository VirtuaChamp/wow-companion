import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

const setSpawnVersion = async (versionLine: string): Promise<void> => {
  const { spawnSync } = await import("node:child_process");
  vi.mocked(spawnSync).mockImplementation((_command: string, args?: readonly string[]) => {
    if (args && args[0] === "-v") {
      return {
        error: undefined,
        stdout: versionLine,
        stderr: "",
      } as unknown as ReturnType<typeof spawnSync>;
    }
    return { error: new Error("unexpected"), stdout: "", stderr: "" } as unknown as ReturnType<
      typeof spawnSync
    >;
  });
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("lua-tool-paths resolver", () => {
  it("rejects a Lua interpreter reporting 5.4.6", async () => {
    await setSpawnVersion("Lua 5.4.6  Copyright (C) 1994-2023 Lua.org, PUC-Rio\n");
    const { resolveLuaInterpreter } = await import("./lua-tool-paths.ts");
    const result = resolveLuaInterpreter("linux-x64", "/tmp/does-not-exist");
    expect(result.ok).toBe(false);
  });

  it("accepts a Lua interpreter reporting 5.1.5", async () => {
    await setSpawnVersion("Lua 5.1.5  Copyright (C) 1994-2012 Lua.org, PUC-Rio\n");
    const { resolveLuaInterpreter } = await import("./lua-tool-paths.ts");
    const result = resolveLuaInterpreter("linux-x64", "/tmp/does-not-exist");
    expect(result.ok).toBe(true);
  });

  it("rejects a luac reporting 5.4.6", async () => {
    await setSpawnVersion("Lua 5.4.6  Copyright (C) 1994-2023 Lua.org, PUC-Rio\n");
    const { resolveLuac } = await import("./lua-tool-paths.ts");
    const result = resolveLuac("linux-x64", "/tmp/does-not-exist");
    expect(result.ok).toBe(false);
  });

  it("accepts a luac reporting 5.1.5", async () => {
    await setSpawnVersion("Lua 5.1.5  Copyright (C) 1994-2012 Lua.org, PUC-Rio\n");
    const { resolveLuac } = await import("./lua-tool-paths.ts");
    const result = resolveLuac("linux-x64", "/tmp/does-not-exist");
    expect(result.ok).toBe(true);
  });
});
