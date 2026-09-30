import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { fileURLToPath } from "node:url";
import { writeNewFile } from "./lib/install-io.ts";
import {
  availableProviders,
  buildConfig,
  expectedAfterDatabase,
  expectedAfterSetup,
  missingFiles,
  modelPrompt,
  nextSteps,
  parseYesNo,
  pickProvider,
  planConfigStep,
  planDatabaseStep,
  resolveTypedPath,
  stripGameExecutable,
  validateQuestieCheckout,
  validateWowPath,
  type PickableProvider,
  type ProviderModel,
} from "./lib/install-core.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "config.json");
const examplePath = join(root, "config.example.json");
const databasePath = join(root, "data", "questie.sqlite");

let rl: Interface | undefined;
let inputClosed = false;

const ask = (question: string): Promise<string> =>
  new Promise((resolveAnswer, rejectAnswer) => {
    const closedMessage = "input closed before an answer was given";
    if (inputClosed) {
      rejectAnswer(new Error(closedMessage));
      return;
    }
    const active = rl ?? createInterface({ input: process.stdin, output: process.stdout });
    rl = active;
    const onClose = (): void => {
      rl = undefined;
      inputClosed = true;
      rejectAnswer(new Error(closedMessage));
    };
    active.once("close", onClose);
    active.question(question, (answer) => {
      active.off("close", onClose);
      if (process.stdin.isTTY) {
        active.close();
        rl = undefined;
      }
      resolveAnswer(answer);
    });
  });

const say = (line: string): void => console.log(line);

function fail(message: string): never {
  console.error(`\nInstall stopped: ${message}`);
  process.exit(1);
}

const onPath = (command: string): boolean =>
  spawnSync("where.exe", [command], { stdio: "ignore" }).status === 0;

const runNode = (script: string, args: string[]): boolean =>
  spawnSync(process.execPath, [join(root, "scripts", script), ...args], {
    cwd: root,
    stdio: "inherit",
  }).status === 0;

const requireFiles = (step: string, files: readonly string[]): void => {
  const missing = missingFiles(existsSync, files);
  if (missing.length > 0) {
    fail(`${step} reported success but did not create: ${missing.join(", ")}`);
  }
};

const askUntilValid = async <T>(
  question: string,
  check: (answer: string) => { ok: true; value: T } | { ok: false; error: string },
): Promise<T> => {
  for (;;) {
    const checked = check(await ask(question));
    if (checked.ok) {
      return checked.value;
    }
    say(`  ${checked.error}. Try again.`);
  }
};

const askYesNo = (question: string): Promise<boolean> =>
  askUntilValid(question, (raw) => {
    const parsed = parseYesNo(raw);
    return parsed === undefined
      ? { ok: false as const, error: "answer y or n" }
      : { ok: true as const, value: parsed };
  });

const askForDefaultProvider = async (
  options: readonly PickableProvider[],
): Promise<PickableProvider> => {
  const only = options.length === 1 ? options[0] : undefined;
  if (only !== undefined) {
    say(`Only ${only} was found on your PATH, so it is the provider.`);
    return only;
  }
  const menu = options.map((option, index) => `${String(index + 1)} = ${option}`).join(", ");
  return askUntilValid(`Which provider should answer by default (${menu})? `, (answer) =>
    pickProvider(answer, options),
  );
};

const createConfig = async (): Promise<string> => {
  const example: unknown = JSON.parse(readFileSync(examplePath, "utf-8"));
  say("config.json does not exist yet. A few questions and it is created.\n");
  const wowPath = await askUntilValid(
    "Game folder, the one that holds WowB.exe (the _classic_beta_ folder): ",
    (answer) => validateWowPath(existsSync, stripGameExecutable(resolveTypedPath(answer, root))),
  );
  const found = availableProviders(onPath);
  if (found.length === 0) {
    fail("neither claude nor codex is on your PATH. Install one and run install.cmd again.");
  }
  const defaultProvider = await askForDefaultProvider(found);
  const chosen: ProviderModel[] = [];
  for (const provider of found) {
    const model = await askUntilValid(modelPrompt(provider), (answer) =>
      answer.trim().length === 0
        ? { ok: false, error: "a model is required" }
        : { ok: true, value: answer.trim() },
    );
    chosen.push({ provider, model });
  }
  const built = buildConfig(example, { wowPath, defaultProvider, chosen });
  if (!built.ok) {
    return fail(built.error);
  }
  const written = writeNewFile(configPath, built.value);
  if (!written.ok) {
    return fail(written.error);
  }
  say(
    "config.json created. Providers that were not found on your PATH, and Cursor, are disabled.\n",
  );
  return wowPath;
};

const settleConfig = async (): Promise<string> => {
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf-8") : undefined;
  const plan = planConfigStep(existing, existsSync);
  if (plan.kind === "stop") {
    return fail(
      `${plan.reason}. Fix config.json, or delete it and run install.cmd again to create a new one.`,
    );
  }
  if (plan.kind === "keep") {
    say("config.json already exists and is kept as it is.\n");
    return plan.wowPath;
  }
  return createConfig();
};

const buildDatabase = async (): Promise<void> => {
  say("Building the world database from your QuestieDB checkout.");
  const first = planDatabaseStep(existsSync(databasePath), undefined);
  const action =
    first === "ask-whether-to-rebuild"
      ? planDatabaseStep(
          true,
          await askYesNo("data/questie.sqlite already exists. Build it again? (y/N) "),
        )
      : first;
  if (action === "skip") {
    say("Keeping the existing database.\n");
    return;
  }
  say("Clone it first if you have not: git clone https://github.com/Questie/QuestieDB.git");
  const checkout = await askUntilValid("Path of your QuestieDB checkout: ", (answer) =>
    validateQuestieCheckout(existsSync, resolveTypedPath(answer, root)),
  );
  if (!runNode("build-db.ts", [checkout])) {
    fail("build-db failed. Read its message above.");
  }
  requireFiles("build-db", expectedAfterDatabase(root));
  say("");
};

const main = async (): Promise<void> => {
  const wowPath = await settleConfig();
  say(
    "Downloading the Lua 5.1.5 interpreter the database build needs into .tools/ (checksum verified).",
  );
  say("It is a small download into this project folder. Nothing is installed on your system.");
  if (!runNode("lua-setup.ts", ["--lua-only"])) {
    fail("lua-setup failed. Read its message above.");
  }
  say("");
  await buildDatabase();
  say("Installing the addon into the game folder.");
  if (!runNode("setup.ts", [])) {
    fail("setup failed. Read its message above.");
  }
  requireFiles("setup", expectedAfterSetup(wowPath));
  say("");
  for (const line of nextSteps()) {
    say(line);
  }
};

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  rl?.close();
}
