import { describe, expect, it } from "vitest";
import { parseToolSelection } from "./lua-setup-args.ts";

describe("parseToolSelection", () => {
  it("installs both tools with no argument, the contributor behaviour", () => {
    expect(parseToolSelection([])).toEqual({ ok: true, value: { luacheck: true } });
  });

  it("installs only the Lua interpreter with --lua-only", () => {
    expect(parseToolSelection(["--lua-only"])).toEqual({
      ok: true,
      value: { luacheck: false },
    });
  });

  it("refuses an unknown argument instead of ignoring it", () => {
    const result = parseToolSelection(["--luacheck-only"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("--luacheck-only");
  });
});
