import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configErrorMessage, parseConfig } from "../../src/config.ts";

const valid = {
  wowPath: "wow-path-placeholder",
  provider: "claude",
  providers: {
    claude: { enabled: true, model: "m1", effort: "low", models: ["m1"] },
    codex: { enabled: true, model: "c1" },
    cursor: { enabled: false, model: "u1" },
  },
  companionPort: 47831,
  slotCount: 200,
  timeoutMs: 600000,
};

describe("daemon.config", () => {
  it("parses a complete config and keeps models as an empty fallback when absent", () => {
    const result = parseConfig(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider).toBe("claude");
    expect(result.value.providers.claude).toEqual({
      enabled: true,
      model: "m1",
      effort: "low",
      models: ["m1"],
    });
    expect(result.value.providers.codex).toEqual({ enabled: true, model: "c1", models: [] });
    expect(result.value.companionPort).toBe(47831);
  });

  it("names the field of a missing top-level setting and never defaults it", () => {
    for (const field of [
      "wowPath",
      "provider",
      "providers",
      "companionPort",
      "slotCount",
      "timeoutMs",
    ]) {
      const broken: Record<string, unknown> = { ...valid };
      delete broken[field];
      expect(parseConfig(broken)).toEqual({ ok: false, error: { field, problem: "missing" } });
    }
  });

  it("refuses invalid values and names the field", () => {
    expect(parseConfig({ ...valid, companionPort: 70000 })).toEqual({
      ok: false,
      error: { field: "companionPort", problem: "invalid" },
    });
    expect(parseConfig({ ...valid, provider: "gpt" })).toEqual({
      ok: false,
      error: { field: "provider", problem: "invalid" },
    });
    expect(parseConfig({ ...valid, timeoutMs: 0 })).toEqual({
      ok: false,
      error: { field: "timeoutMs", problem: "invalid" },
    });
  });

  it("names a missing provider entry and a bad provider field", () => {
    const withoutCursor = {
      ...valid,
      providers: { claude: valid.providers.claude, codex: valid.providers.codex },
    };
    expect(parseConfig(withoutCursor)).toEqual({
      ok: false,
      error: { field: "providers.cursor", problem: "missing" },
    });
    const badEffort = {
      ...valid,
      providers: { ...valid.providers, claude: { enabled: true, model: "m1", effort: "ultra" } },
    };
    expect(parseConfig(badEffort)).toEqual({
      ok: false,
      error: { field: "providers.claude.effort", problem: "invalid" },
    });
    const noModel = { ...valid, providers: { ...valid.providers, codex: { enabled: true } } };
    expect(parseConfig(noModel)).toEqual({
      ok: false,
      error: { field: "providers.codex.model", problem: "missing" },
    });
  });

  it("does not read a providers.<id>.path setting", () => {
    const result = parseConfig({
      ...valid,
      providers: { ...valid.providers, claude: { enabled: true, model: "m1", path: "x" } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.providers.claude)).not.toContain("path");
  });

  it("words the error for the operator", () => {
    expect(configErrorMessage({ field: "wowPath", problem: "missing" })).toBe(
      "config.json: wowPath is missing",
    );
    expect(configErrorMessage({ field: "companionPort", problem: "invalid" })).toBe(
      "config.json: companionPort is invalid",
    );
  });

  it("ships a config.example.json that parses and holds placeholders only", () => {
    const text = readFileSync(new URL("../../../../config.example.json", import.meta.url), "utf8");
    const parsed = parseConfig(JSON.parse(text));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.companionPort).toBe(47831);
    expect(parsed.value.slotCount).toBe(200);
    expect(parsed.value.timeoutMs).toBe(600000);
    expect(parsed.value.wowPath).toMatch(/^</);
    expect(text).not.toMatch(/C:\\|\/Users\/|\/home\/|sk-|ghp_|"path"/);
  });
});
