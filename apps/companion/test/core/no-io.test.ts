import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const forbidden = [
  "node:fs",
  "node:net",
  "node:child_process",
  "node:http",
  '"fs"',
  '"net"',
  '"child_process"',
  '"http"',
];

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("core.no-io", () => {
  it("apps/companion/src/core imports no fs, net, child_process or http module", async () => {
    const coreDir = path.join(import.meta.dirname, "..", "..", "src", "core");
    const files = await listFiles(coreDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = await readFile(file, "utf8");
      for (const token of forbidden) {
        expect(content, `${file} must not import ${token}`).not.toContain(token);
      }
    }
  });
});
