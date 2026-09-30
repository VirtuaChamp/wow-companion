import { err, ok, type Result } from "./result.ts";

export type ToolSelection = { luacheck: boolean };

export const parseToolSelection = (argv: readonly string[]): Result<ToolSelection, string> => {
  const flags = argv.filter((arg) => arg.length > 0);
  const unknown = flags.filter((flag) => flag !== "--lua-only");
  if (unknown.length > 0) {
    return err(`unknown argument: ${unknown.join(", ")}; the only flag is --lua-only`);
  }
  return ok({ luacheck: !flags.includes("--lua-only") });
};
