import { basename, dirname, join, resolve } from "node:path";
import { configErrorMessage, parseConfig } from "../../apps/companion/src/config.ts";
import { resolveCheckoutPaths } from "../build-db/paths.ts";
import { err, ok, type Result } from "./result.ts";

const PICKABLE_PROVIDERS = ["claude", "codex"] as const;

export type PickableProvider = (typeof PICKABLE_PROVIDERS)[number];

export type ProviderModel = { provider: PickableProvider; model: string };

export type ConfigChoice = {
  wowPath: string;
  defaultProvider: PickableProvider;
  chosen: readonly ProviderModel[];
};

export type ExistsFn = (path: string) => boolean;

const GAME_EXECUTABLE = "WowB.exe";

const MODEL_EXAMPLES: Record<PickableProvider, string> = {
  claude: "claude-sonnet-5",
  codex: "gpt-6.1-sol",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizePathInput = (raw: string): string => {
  const trimmed = raw.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return (quoted?.[2] ?? trimmed).trim();
};

export const resolveTypedPath = (raw: string, base: string): string => {
  const cleaned = normalizePathInput(raw);
  return cleaned.length === 0 ? "" : resolve(base, cleaned);
};

export const stripGameExecutable = (dir: string): string =>
  basename(dir).toLowerCase() === GAME_EXECUTABLE.toLowerCase() ? dirname(dir) : dir;

export const validateWowPath = (exists: ExistsFn, dir: string): Result<string, string> => {
  if (dir.length === 0) {
    return err("no folder given");
  }
  if (!exists(join(dir, GAME_EXECUTABLE))) {
    return err(`${GAME_EXECUTABLE} is not in ${dir}`);
  }
  return ok(dir);
};

export const validateQuestieCheckout = (exists: ExistsFn, dir: string): Result<string, string> => {
  if (dir.length === 0) {
    return err("no folder given");
  }
  const paths = resolveCheckoutPaths(dir, "");
  if (!exists(paths.dataForeverDir)) {
    return err(`${paths.dataForeverDir} does not exist, so this is not a QuestieDB checkout`);
  }
  if (!exists(paths.areaMapPath)) {
    return err(`${paths.areaMapPath} does not exist, so this is not a QuestieDB checkout`);
  }
  return ok(dir);
};

export const availableProviders = (onPath: (command: string) => boolean): PickableProvider[] =>
  PICKABLE_PROVIDERS.filter((provider) => onPath(provider));

export const pickProvider = (
  answer: string,
  options: readonly PickableProvider[],
): Result<PickableProvider, string> => {
  const text = answer.trim().toLowerCase();
  const byNumber = /^\d+$/.test(text) ? options[Number(text) - 1] : undefined;
  const picked = byNumber ?? options.find((option) => option === text);
  return picked === undefined ? err(`answer with one of: ${options.join(", ")}`) : ok(picked);
};

export const parseYesNo = (answer: string): boolean | undefined => {
  const text = answer.trim().toLowerCase();
  if (text === "y" || text === "yes") {
    return true;
  }
  if (text === "n" || text === "no" || text === "") {
    return false;
  }
  return undefined;
};

export const buildConfig = (example: unknown, choice: ConfigChoice): Result<string, string> => {
  if (!isRecord(example) || !isRecord(example["providers"])) {
    return err("config.example.json has no providers object");
  }
  if (!choice.chosen.some((entry) => entry.provider === choice.defaultProvider)) {
    return err(`no model was given for the default provider ${choice.defaultProvider}`);
  }
  if (choice.chosen.some((entry) => entry.model.trim().length === 0)) {
    return err("a model id cannot be empty");
  }
  const providers: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(example["providers"])) {
    if (!isRecord(entry)) {
      return err(`config.example.json providers.${id} is not an object`);
    }
    const picked = choice.chosen.find((candidate) => candidate.provider === id);
    providers[id] =
      picked === undefined
        ? { ...entry, enabled: false }
        : {
            ...entry,
            model: picked.model,
            ...(picked.provider === "codex" ? { models: [picked.model] } : {}),
          };
  }
  const config = {
    ...example,
    wowPath: choice.wowPath,
    provider: choice.defaultProvider,
    providers,
  };
  const checked = parseConfig(config);
  if (!checked.ok) {
    return err(
      `the config built from config.example.json is not valid: ${configErrorMessage(checked.error)}`,
    );
  }
  return ok(`${JSON.stringify(config, undefined, 2)}\n`);
};

export type ConfigStepPlan =
  | { kind: "create" }
  | { kind: "keep"; wowPath: string }
  | { kind: "stop"; reason: string };

export const planConfigStep = (
  existingText: string | undefined,
  exists: ExistsFn,
): ConfigStepPlan => {
  if (existingText === undefined) {
    return { kind: "create" };
  }
  let json: unknown;
  try {
    json = JSON.parse(existingText);
  } catch {
    return { kind: "stop", reason: "config.json is not valid JSON" };
  }
  const parsed = parseConfig(json);
  if (!parsed.ok) {
    return { kind: "stop", reason: configErrorMessage(parsed.error) };
  }
  const wowPath = validateWowPath(exists, parsed.value.wowPath);
  return wowPath.ok
    ? { kind: "keep", wowPath: wowPath.value }
    : { kind: "stop", reason: `config.json wowPath: ${wowPath.error}` };
};

export type DatabaseAction = "ask-whether-to-rebuild" | "build" | "skip";

export const planDatabaseStep = (
  databaseExists: boolean,
  rebuild: boolean | undefined,
): DatabaseAction => {
  if (!databaseExists) {
    return "build";
  }
  if (rebuild === undefined) {
    return "ask-whether-to-rebuild";
  }
  return rebuild ? "build" : "skip";
};

export const expectedAfterDatabase = (root: string): string[] => [
  join(root, "data", "questie.sqlite"),
];

export const expectedAfterSetup = (wowPath: string): string[] => {
  const addons = join(wowPath, "Interface", "AddOns");
  return [
    join(addons, "WoWCompanion", "WoWCompanion.toc"),
    join(addons, "WoWCompanion_Signals", "sig", "ctl-gone.wav"),
  ];
};

export const missingFiles = (exists: ExistsFn, files: readonly string[]): string[] =>
  files.filter((file) => !exists(file));

export const modelPrompt = (provider: PickableProvider): string => {
  const example = MODEL_EXAMPLES[provider];
  return provider === "claude"
    ? `Model for claude, an id such as ${example} (\`claude --help\` describes --model): `
    : `Model for codex, an id such as ${example} (list yours with \`codex debug models\`): `;
};

export const nextSteps = (): string[] => [
  "Next steps:",
  "  1. Start the game. If it was running during this install, close it and start it again:",
  "     it only sees the files that existed when it launched.",
  "  2. Run start.cmd and keep its window open while you play.",
  "  3. In the game, type /ai hello in any chat box.",
];
