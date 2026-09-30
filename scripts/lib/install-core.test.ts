import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../apps/companion/src/config.ts";
import { parseArgs } from "../build-db.ts";
import { runSetup } from "../setup.ts";
import {
  availableProviders,
  buildConfig,
  expectedAfterDatabase,
  expectedAfterSetup,
  missingFiles,
  normalizePathInput,
  parseYesNo,
  pickProvider,
  planConfigStep,
  planDatabaseStep,
  resolveTypedPath,
  stripGameExecutable,
  validateQuestieCheckout,
  validateWowPath,
} from "./install-core.ts";

const existsIn =
  (...present: string[]) =>
  (path: string): boolean =>
    present.includes(path);

const example: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "config.example.json"), "utf-8"),
);

type BuiltProvider = { enabled: boolean; model: string; models?: string[] };

type BuiltConfig = {
  wowPath: string;
  provider: string;
  providers: Record<"claude" | "codex" | "cursor", BuiltProvider>;
  companionPort: number;
  slotCount: number;
  timeoutMs: number;
};

const builtConfig = (text: string): BuiltConfig => JSON.parse(text) as BuiltConfig;

describe("normalizePathInput", () => {
  it("trims spaces and strips the quotes Explorer adds to a copied path", () => {
    expect(normalizePathInput('  "D:\\Games\\Wow Folder"  ')).toBe("D:\\Games\\Wow Folder");
    expect(normalizePathInput("'D:\\x'")).toBe("D:\\x");
    expect(normalizePathInput("D:\\x")).toBe("D:\\x");
  });

  it("keeps an unbalanced quote", () => {
    expect(normalizePathInput('"D:\\x')).toBe('"D:\\x');
  });
});

describe("resolveTypedPath", () => {
  const base = resolve("repo-root");

  it("turns a relative answer into an absolute path under the base", () => {
    expect(resolveTypedPath("..\\QuestieDB", base)).toBe(resolve(base, "..\\QuestieDB"));
    expect(resolveTypedPath('"sub folder"', base)).toBe(resolve(base, "sub folder"));
  });

  it("keeps an absolute answer and normalises dot segments", () => {
    const absolute = resolve("games", "wow");
    expect(resolveTypedPath(absolute, base)).toBe(absolute);
    expect(resolveTypedPath(join(absolute, "sub", ".."), base)).toBe(absolute);
  });

  it("returns an empty string for an empty answer so validation refuses it", () => {
    expect(resolveTypedPath("   ", base)).toBe("");
    expect(validateWowPath(existsIn(), resolveTypedPath("", base)).ok).toBe(false);
  });
});

describe("stripGameExecutable", () => {
  const base = resolve("repo-root");
  const dir = join("games", "wow");

  it("turns the path of WowB.exe into its folder", () => {
    expect(stripGameExecutable(join(dir, "WowB.exe"))).toBe(dir);
    expect(stripGameExecutable(join(dir, "wowb.EXE"))).toBe(dir);
  });

  it("leaves a folder path alone, including a folder that only contains the name", () => {
    expect(stripGameExecutable(dir)).toBe(dir);
    expect(stripGameExecutable(join(dir, "WowB.exe.bak"))).toBe(join(dir, "WowB.exe.bak"));
  });

  it("makes a typed exe path pass the folder check", () => {
    const typed = resolveTypedPath(`"${join(dir, "WowB.exe")}"`, base);
    const folder = resolve(base, dir);
    expect(validateWowPath(existsIn(join(folder, "WowB.exe")), stripGameExecutable(typed))).toEqual(
      { ok: true, value: folder },
    );
  });

  it("leaves an empty answer empty so validation refuses it", () => {
    expect(stripGameExecutable("")).toBe("");
  });
});

describe("validateWowPath", () => {
  it("accepts a folder that holds WowB.exe", () => {
    const dir = join("games", "wow");
    expect(validateWowPath(existsIn(join(dir, "WowB.exe")), dir)).toEqual({
      ok: true,
      value: dir,
    });
  });

  it("refuses a folder without WowB.exe and names the file", () => {
    const result = validateWowPath(existsIn(), join("games", "wow"));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("WowB.exe");
  });

  it("refuses an empty answer", () => {
    expect(validateWowPath(existsIn(), "").ok).toBe(false);
  });
});

describe("validateQuestieCheckout", () => {
  const dir = join("code", "QuestieDB");
  const dataForever = join(dir, "data", "Forever");
  const areaMap = join(dir, "support", "Forever", "Zones", "areaIdToUiMapId.lua");

  it("accepts a checkout with both paths build-db reads", () => {
    expect(validateQuestieCheckout(existsIn(dataForever, areaMap), dir).ok).toBe(true);
  });

  it("refuses a folder missing data/Forever", () => {
    expect(validateQuestieCheckout(existsIn(areaMap), dir).ok).toBe(false);
  });

  it("refuses a folder missing the area map", () => {
    const result = validateQuestieCheckout(existsIn(dataForever), dir);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("areaIdToUiMapId.lua");
  });

  it("refuses an empty answer", () => {
    expect(validateQuestieCheckout(existsIn(), "").ok).toBe(false);
  });
});

describe("availableProviders", () => {
  it("lists only the providers found on PATH, in a fixed order", () => {
    expect(availableProviders((command) => command === "codex")).toEqual(["codex"]);
    expect(availableProviders(() => true)).toEqual(["claude", "codex"]);
    expect(availableProviders(() => false)).toEqual([]);
  });

  it("never offers cursor", () => {
    expect(availableProviders(() => true)).not.toContain("cursor");
  });
});

describe("pickProvider", () => {
  it("accepts a number or a name from the offered options", () => {
    expect(pickProvider("2", ["claude", "codex"])).toEqual({ ok: true, value: "codex" });
    expect(pickProvider(" Claude ", ["claude", "codex"])).toEqual({ ok: true, value: "claude" });
  });

  it("refuses a provider that was not offered", () => {
    expect(pickProvider("codex", ["claude"]).ok).toBe(false);
    expect(pickProvider("3", ["claude", "codex"]).ok).toBe(false);
    expect(pickProvider("0", ["claude", "codex"]).ok).toBe(false);
    expect(pickProvider("", ["claude", "codex"]).ok).toBe(false);
  });
});

describe("parseYesNo", () => {
  it("reads y and yes as true, n, no and empty as false, anything else as undefined", () => {
    expect(parseYesNo("Y")).toBe(true);
    expect(parseYesNo("yes")).toBe(true);
    expect(parseYesNo("n")).toBe(false);
    expect(parseYesNo("")).toBe(false);
    expect(parseYesNo("maybe")).toBeUndefined();
  });
});

describe("buildConfig with the real config.example.json", () => {
  it("builds a config parseConfig accepts when only claude was found", () => {
    const built = buildConfig(example, {
      wowPath: "D:\\Games\\Wow",
      defaultProvider: "claude",
      chosen: [{ provider: "claude", model: "the-claude-model" }],
    });
    expect(built.ok).toBe(true);
    const config = builtConfig(built.ok ? built.value : "{}");
    expect(parseConfig(config).ok).toBe(true);
    expect(config.wowPath).toBe("D:\\Games\\Wow");
    expect(config.provider).toBe("claude");
    expect(config.providers.claude.model).toBe("the-claude-model");
    expect(config.providers.claude.enabled).toBe(true);
    expect(config.providers.codex.enabled).toBe(false);
    expect(config.providers.cursor.enabled).toBe(false);
  });

  it("builds a config parseConfig accepts when both providers were found", () => {
    const built = buildConfig(example, {
      wowPath: "D:\\Games\\Wow",
      defaultProvider: "codex",
      chosen: [
        { provider: "claude", model: "the-claude-model" },
        { provider: "codex", model: "the-codex-model" },
      ],
    });
    expect(built.ok).toBe(true);
    const config = builtConfig(built.ok ? built.value : "{}");
    expect(parseConfig(config).ok).toBe(true);
    expect(config.provider).toBe("codex");
    expect(config.providers.claude).toMatchObject({ enabled: true, model: "the-claude-model" });
    expect(config.providers.codex).toMatchObject({
      enabled: true,
      model: "the-codex-model",
      models: ["the-codex-model"],
    });
    expect(config.providers.cursor.enabled).toBe(false);
  });

  it("builds a config parseConfig accepts when only codex was found and disables claude", () => {
    const built = buildConfig(example, {
      wowPath: "x",
      defaultProvider: "codex",
      chosen: [{ provider: "codex", model: "the-codex-model" }],
    });
    const config = builtConfig(built.ok ? built.value : "{}");
    expect(parseConfig(config).ok).toBe(true);
    expect(config.providers.claude.enabled).toBe(false);
    expect(config.providers.codex.models).toEqual(["the-codex-model"]);
  });

  it("keeps the other keys of the example and does not change the example object", () => {
    const before = JSON.stringify(example);
    const built = buildConfig(example, {
      wowPath: "x",
      defaultProvider: "claude",
      chosen: [{ provider: "claude", model: "m" }],
    });
    const config = builtConfig(built.ok ? built.value : "{}");
    expect(JSON.stringify(example)).toBe(before);
    expect(config.companionPort).toBe(47831);
    expect(config.slotCount).toBe(200);
    expect(config.timeoutMs).toBe(600000);
    expect(built.ok && built.value.endsWith("}\n")).toBe(true);
  });

  it("refuses a default provider that has no model, an empty model, or a bad example", () => {
    expect(
      buildConfig(example, {
        wowPath: "x",
        defaultProvider: "codex",
        chosen: [{ provider: "claude", model: "m" }],
      }).ok,
    ).toBe(false);
    expect(
      buildConfig(example, {
        wowPath: "x",
        defaultProvider: "claude",
        chosen: [{ provider: "claude", model: "  " }],
      }).ok,
    ).toBe(false);
    expect(
      buildConfig(
        {},
        { wowPath: "x", defaultProvider: "claude", chosen: [{ provider: "claude", model: "m" }] },
      ).ok,
    ).toBe(false);
  });
});

describe("planConfigStep", () => {
  const wowPath = join("games", "wow");
  const exe = join(wowPath, "WowB.exe");
  const valid = (): string => {
    const built = buildConfig(example, {
      wowPath,
      defaultProvider: "claude",
      chosen: [{ provider: "claude", model: "m" }],
    });
    return built.ok ? built.value : "";
  };

  it("creates a config only when none exists", () => {
    expect(planConfigStep(undefined, existsIn())).toEqual({ kind: "create" });
  });

  it("keeps a valid existing config and never plans to create over an existing one", () => {
    expect(planConfigStep(valid(), existsIn(exe))).toEqual({ kind: "keep", wowPath });
    for (const text of ["", "{}", "not json", valid(), "[]"]) {
      expect(planConfigStep(text, existsIn(exe)).kind).not.toBe("create");
    }
  });

  it("stops on an existing config that is not valid JSON, and says so", () => {
    const plan = planConfigStep("{ nope", existsIn(exe));
    expect(plan).toEqual({ kind: "stop", reason: "config.json is not valid JSON" });
  });

  it("stops with the companion's own message on a config parseConfig refuses", () => {
    const plan = planConfigStep(JSON.stringify({ wowPath }), existsIn(exe));
    expect(plan).toEqual({ kind: "stop", reason: "config.json: provider is missing" });
  });

  it("stops when the wowPath of an existing config has no WowB.exe", () => {
    const plan = planConfigStep(valid(), existsIn());
    expect(plan.kind).toBe("stop");
    expect(plan.kind === "stop" && plan.reason).toContain("WowB.exe");
  });
});

describe("planDatabaseStep", () => {
  it("builds when there is no database", () => {
    expect(planDatabaseStep(false, undefined)).toBe("build");
  });

  it("asks whether to rebuild when a database exists and nothing was answered", () => {
    expect(planDatabaseStep(true, undefined)).toBe("ask-whether-to-rebuild");
  });

  it("skips on no or on an empty answer, builds on yes", () => {
    expect(planDatabaseStep(true, parseYesNo("n"))).toBe("skip");
    expect(planDatabaseStep(true, parseYesNo(""))).toBe("skip");
    expect(planDatabaseStep(true, parseYesNo("y"))).toBe("build");
  });
});

describe("postconditions", () => {
  it("expects the database where build-db writes it by default", () => {
    const parsed = parseArgs(["a-questie-checkout"]);
    expect(parsed.ok).toBe(true);
    const root = resolve("repo-root");
    expect(expectedAfterDatabase(root)).toEqual([
      resolve(root, parsed.ok ? parsed.value.outPath : ""),
    ]);
  });

  it("finds every expected file after the real setup script ran against a temp game folder", () => {
    const wowPath = mkdtempSync(join(tmpdir(), "wowc-install-postcondition-"));
    try {
      expect(missingFiles(existsSync, expectedAfterSetup(wowPath))).toHaveLength(2);
      runSetup({
        wowPath,
        repoAddonDir: join(import.meta.dirname, "..", "..", "addon", "WoWCompanion"),
        slotCount: 2,
      });
      expect(missingFiles(existsSync, expectedAfterSetup(wowPath))).toEqual([]);
    } finally {
      rmSync(wowPath, { recursive: true, force: true });
    }
  });

  it("reports exactly the files that are missing", () => {
    const [toc, signal] = expectedAfterSetup("wow");
    expect(missingFiles(existsIn(toc ?? ""), [toc ?? "", signal ?? ""])).toEqual([signal]);
    expect(missingFiles(existsIn(), [])).toEqual([]);
  });
});
