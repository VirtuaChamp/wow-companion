import { readFile, writeFile } from "node:fs/promises";
import type { SlotFs } from "../transport/slots.ts";

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

export function createFsSlots(): SlotFs {
  return {
    async writeFile(path, data) {
      await writeFile(path, data);
    },
    async readFile(path) {
      try {
        return new Uint8Array(await readFile(path));
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      }
    },
  };
}
