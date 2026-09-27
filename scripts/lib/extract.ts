import { spawnSync } from "node:child_process";
import { type Result, err, ok } from "./result.ts";

export type ExtractError = { kind: "extract_failed"; tool: string; stderr: string };

export const extractZip = (zipPath: string, destDir: string): Result<void, ExtractError> => {
  const script =
    "Expand-Archive -LiteralPath $env:WOWC_EXTRACT_ZIP_PATH -DestinationPath $env:WOWC_EXTRACT_DEST_DIR -Force";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, WOWC_EXTRACT_ZIP_PATH: zipPath, WOWC_EXTRACT_DEST_DIR: destDir },
  });
  if (result.status !== 0) {
    return err({ kind: "extract_failed", tool: "powershell.exe", stderr: result.stderr ?? "" });
  }
  return ok(undefined);
};

export const extractTarGz = (tarPath: string, destDir: string): Result<void, ExtractError> => {
  const result = spawnSync("tar", ["-xzf", tarPath, "-C", destDir], { encoding: "utf8" });
  if (result.status !== 0) {
    return err({ kind: "extract_failed", tool: "tar", stderr: result.stderr ?? "" });
  }
  return ok(undefined);
};
