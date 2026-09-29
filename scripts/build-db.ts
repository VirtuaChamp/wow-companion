import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCheckoutPaths } from "./build-db/paths.ts";
import {
  DEFAULT_EXPORTER_TIMEOUT_MS,
  DEFAULT_MEMORY_CEILING_KB,
  runExporter,
} from "./build-db/run-exporter.ts";
import type { NulledReference, SkipReport } from "./build-db/sanitize.ts";
import { writeDatabase } from "./build-db/write-database.ts";
import { resolveLuaInterpreter } from "./lib/lua-tool-paths.ts";
import { resolveSupportedPlatform } from "./lib/lua-toolchain-specs.ts";
import { err, ok, type Result } from "./lib/result.ts";

export type BuildSummary = {
  outPath: string;
  counts: {
    npc: number;
    npc_spawn: number;
    quest: number;
    quest_start: number;
    quest_end: number;
    object: number;
    object_spawn: number;
    item: number;
    item_source: number;
  };
  unresolvedUiMapIds: number;
  skips: SkipReport;
  nulledReferences: NulledReference[];
};

const scriptsDir = dirname(fileURLToPath(import.meta.url));

export const buildDb = (
  checkoutPath: string,
  outPath: string,
  cwd: string,
  exporterTimeoutMs: number = DEFAULT_EXPORTER_TIMEOUT_MS,
  exporterMemoryCeilingKb: number = DEFAULT_MEMORY_CEILING_KB,
): Result<BuildSummary, string> => {
  const schemaPath = join(scriptsDir, "db-schema.sql");
  if (!existsSync(schemaPath)) {
    return err(`schema file not found: ${schemaPath}`);
  }
  const platform = resolveSupportedPlatform();
  if (!platform) {
    return err(`unsupported platform/arch: ${process.platform}-${process.arch}`);
  }
  const luaResolution = resolveLuaInterpreter(platform, join(cwd, ".tools"));
  if (!luaResolution.ok) {
    return err(`${luaResolution.error}; run pnpm run lua:setup first`);
  }
  const paths = resolveCheckoutPaths(checkoutPath, scriptsDir);
  const exported = runExporter(
    luaResolution.command,
    paths.exporterPath,
    paths.dataForeverDir,
    paths.areaMapPath,
    exporterTimeoutMs,
    exporterMemoryCeilingKb,
  );
  if (!exported.ok) {
    return err(exported.error);
  }
  const resolvedOutPath = resolve(cwd, outPath);
  mkdirSync(dirname(resolvedOutPath), { recursive: true });
  const written = writeDatabase(resolvedOutPath, schemaPath, exported.value.data);
  if (!written.ok) {
    return err(written.error);
  }
  const unresolvedUiMapIds =
    exported.value.data.npc_spawn.filter((row) => row.ui_map_id === null).length +
    exported.value.data.object_spawn.filter((row) => row.ui_map_id === null).length;
  return ok({
    outPath: resolvedOutPath,
    counts: {
      npc: exported.value.data.npc.length,
      npc_spawn: exported.value.data.npc_spawn.length,
      quest: exported.value.data.quest.length,
      quest_start: exported.value.data.quest_start.length,
      quest_end: exported.value.data.quest_end.length,
      object: exported.value.data.object.length,
      object_spawn: exported.value.data.object_spawn.length,
      item: exported.value.data.item.length,
      item_source: exported.value.data.item_source.length,
    },
    unresolvedUiMapIds,
    skips: exported.value.skips,
    nulledReferences: exported.value.nulledReferences,
  });
};

export const formatSkipReport = (skips: SkipReport): string[] =>
  (Object.keys(skips) as (keyof SkipReport)[]).map((table) => {
    const { total, skipped, firstIds } = skips[table];
    const ids = firstIds.length > 0 ? `, first source ids: ${firstIds.join(", ")}` : "";
    return `${table}: ${total} source rows, ${skipped} skipped${ids}`;
  });

export const formatNulledReferences = (nulled: readonly NulledReference[]): string[] =>
  nulled.map((entry) => {
    const ids = entry.firstIds.length > 0 ? `, first source ids: ${entry.firstIds.join(", ")}` : "";
    return `${entry.field}: ${entry.count} reference(s) to a dropped row set to null${ids}`;
  });

export type CliArgs = { checkoutPath: string; outPath: string };

export const parseArgs = (argv: string[]): Result<CliArgs, string> => {
  const positional: string[] = [];
  let outPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--out") {
      const value = argv[i + 1];
      if (value === undefined) {
        return err("--out requires a path");
      }
      outPath = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      outPath = arg.slice("--out=".length);
      continue;
    }
    if (arg.startsWith("--")) {
      return err(`unknown flag: ${arg}`);
    }
    positional.push(arg);
  }
  const USAGE = "usage: build-db <questie checkout path> [--out data/questie.sqlite]";
  if (positional.length > 1) {
    return err(USAGE);
  }
  const checkoutPath = positional[0];
  if (checkoutPath === undefined) {
    return err(USAGE);
  }
  return ok({ checkoutPath, outPath: outPath ?? "data/questie.sqlite" });
};

const main = (): void => {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }
  const result = buildDb(parsed.value.checkoutPath, parsed.value.outPath, process.cwd());
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(`wrote ${result.value.outPath}`);
  console.log(JSON.stringify(result.value.counts));
  for (const line of [
    ...formatSkipReport(result.value.skips),
    ...formatNulledReferences(result.value.nulledReferences),
  ]) {
    console.log(line);
  }
  if (result.value.unresolvedUiMapIds > 0) {
    console.log(`${result.value.unresolvedUiMapIds} spawn row(s) with unresolved ui_map_id`);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
