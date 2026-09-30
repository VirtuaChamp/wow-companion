import { writeFileSync } from "node:fs";
import { err, ok, type Result } from "./result.ts";

export const writeNewFile = (path: string, content: string): Result<void, string> => {
  try {
    writeFileSync(path, content, { encoding: "utf-8", flag: "wx" });
    return ok(undefined);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    return err(code === "EEXIST" ? `${path} already exists and is not overwritten` : String(error));
  }
};
