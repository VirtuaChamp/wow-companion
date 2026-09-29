import { access, rename, rm, writeFile } from "node:fs/promises";
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
    async exists(path) {
      try {
        await access(path);
        return true;
      } catch (error) {
        if (isMissingFile(error)) return false;
        throw error;
      }
    },
    async remove(path) {
      try {
        await rm(path);
      } catch (error) {
        if (isMissingFile(error)) return;
        throw error;
      }
    },
    async rename(from, to) {
      await rename(from, to);
    },
  };
}
