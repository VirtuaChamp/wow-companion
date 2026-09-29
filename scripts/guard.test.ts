import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGuard } from "./lib/guard-core.ts";
import { walkFiles } from "./lib/list-files.ts";

const dirs: string[] = [];

const makeFixture = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "guard-fixture-"));
  dirs.push(dir);
  return dir;
};

const writeFile = (root: string, relPath: string, content: string): void => {
  const absPath = join(root, ...relPath.split("/"));
  mkdirSync(join(absPath, ".."), { recursive: true });
  writeFileSync(absPath, content);
};

const baseCleanTree = (root: string): void => {
  writeFile(
    root,
    ".gitignore",
    "data/\napps/companion/state/\nconfig.json\n.env*\n!.env.example\n",
  );
  writeFile(root, "addon/WoWCompanion/Core.lua", "local _, ns = ...\n");
  writeFile(root, "apps/companion/src/main.ts", "server.listen(47831, '127.0.0.1');\nexport {};\n");
  writeFile(root, "apps/mcp/src/server.ts", "server.listen(47832, '127.0.0.1');\nexport {};\n");
  writeFile(root, "packages/contracts/src/index.ts", "export {};\n");
};

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("guard.detects", () => {
  it("passes on a clean tree", () => {
    const root = makeFixture();
    baseCleanTree(root);
    const violations = runGuard(walkFiles(root));
    expect(violations).toEqual([]);
  });

  it("detects a raw single-backslash absolute user path", () => {
    const root = makeFixture();
    baseCleanTree(root);
    const rawUserPath = "install path: C:" + "\\Users\\someone\\wow\n";
    writeFile(root, "notes.md", rawUserPath);
    const violations = runGuard(walkFiles(root));
    expect(violations.some((v) => v.rule === "D12 secret pattern" && v.file === "notes.md")).toBe(
      true,
    );
  });

  it("detects an escaped double-backslash absolute user path", () => {
    const root = makeFixture();
    baseCleanTree(root);
    const escapedUserPath = "install path: C:" + "\\\\Users\\\\someone\\\\wow\n";
    writeFile(root, "notes.md", escapedUserPath);
    const violations = runGuard(walkFiles(root));
    expect(violations.some((v) => v.rule === "D12 secret pattern" && v.file === "notes.md")).toBe(
      true,
    );
  });

  it("detects a forward-slash absolute user path", () => {
    const root = makeFixture();
    baseCleanTree(root);
    const forwardSlashUserPath = "install path: C:" + "/Users/someone/wow\n";
    writeFile(root, "notes.md", forwardSlashUserPath);
    const violations = runGuard(walkFiles(root));
    expect(violations.some((v) => v.rule === "D12 secret pattern" && v.file === "notes.md")).toBe(
      true,
    );
  });

  it("detects a WTF/Account path with forward slashes", () => {
    const root = makeFixture();
    baseCleanTree(root);
    const forwardSlashPath = "saved at WTF" + "/Account/1" + "/config\n";
    writeFile(root, "notes.md", forwardSlashPath);
    const violations = runGuard(walkFiles(root));
    expect(violations.some((v) => v.rule === "D12 secret pattern" && v.file === "notes.md")).toBe(
      true,
    );
  });

  it("detects a WTF\\Account path with backslashes", () => {
    const root = makeFixture();
    baseCleanTree(root);
    const backslashPath = "saved at WTF" + "\\Account\\1" + "\\config\n";
    writeFile(root, "notes.md", backslashPath);
    const violations = runGuard(walkFiles(root));
    expect(violations.some((v) => v.rule === "D12 secret pattern" && v.file === "notes.md")).toBe(
      true,
    );
  });

  it("detects an sk- token", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "notes.md", `token: ${"s" + "k"}-fakefakefakefakefakefake\n`);
    const violations = runGuard(walkFiles(root));
    expect(violations.some((v) => v.rule === "D12 secret pattern" && v.file === "notes.md")).toBe(
      true,
    );
  });

  it("detects a ghp_ token", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(
      root,
      "config.example.json",
      `{"token":"gh${"p_"}fakefakefakefakefakefakefakefakefak"}\n`,
    );
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some((v) => v.rule === "D12 secret pattern" && v.file === "config.example.json"),
    ).toBe(true);
  });

  it("detects a CLAUDE_CODE_OAUTH_TOKEN assignment", () => {
    const root = makeFixture();
    baseCleanTree(root);
    const oauthTokenLine = "CLAUDE_CODE_OAUTH_TOKEN" + "=x\n";
    writeFile(root, "notes.md", oauthTokenLine);
    const violations = runGuard(walkFiles(root));
    expect(violations.some((v) => v.rule === "D12 secret pattern" && v.file === "notes.md")).toBe(
      true,
    );
  });

  it("detects an ANTHROPIC_API_KEY assignment", () => {
    const root = makeFixture();
    baseCleanTree(root);
    const apiKeyLine = "ANTHROPIC_API_KEY" + "=x\n";
    writeFile(root, "notes.md", apiKeyLine);
    const violations = runGuard(walkFiles(root));
    expect(violations.some((v) => v.rule === "D12 secret pattern" && v.file === "notes.md")).toBe(
      true,
    );
  });

  it("does not flag the documented pattern strings in backticks in docs/specs/*.md", () => {
    const root = makeFixture();
    baseCleanTree(root);
    const documentedPatternsLine =
      "guard refuses `WTF[\\\\/]Account[\\\\/]\\d`, `C:\\\\Users\\\\`, `sk-`, `ghp_`, `CLAUDE_CODE_OAUTH_TOKEN" +
      "=.`, `ANTHROPIC_API_KEY" +
      "=.`.\n";
    writeFile(root, "docs/specs/example.md", documentedPatternsLine);
    const violations = runGuard(walkFiles(root));
    expect(violations.filter((v) => v.rule === "D12 secret pattern")).toEqual([]);
  });

  it("still flags a secret in docs/specs/*.md outside a documented backtick span", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(
      root,
      "docs/specs/example.md",
      `remember the token ${"s" + "k"}-fakefakefakefakefakefake\n`,
    );
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some((v) => v.rule === "D12 secret pattern" && v.file === "docs/specs/example.md"),
    ).toBe(true);
  });

  it("flags a secret inside a non-documented backtick span in docs/specs/*.md", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(
      root,
      "docs/specs/example.md",
      `the leaked value is \`${"s" + "k"}-fakefakefakefakefakefake\`\n`,
    );
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some((v) => v.rule === "D12 secret pattern" && v.file === "docs/specs/example.md"),
    ).toBe(true);
  });

  it("detects game input code", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "apps/companion/src/bad.ts", "export const doIt = () => SendInput([]);\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some((v) => v.rule === "no game input" && v.file === "apps/companion/src/bad.ts"),
    ).toBe(true);
  });

  it("detects a protected addon call", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "addon/WoWCompanion/Bad.lua", "SendChatMessage('hi', 'SAY')\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) => v.rule === "no protected addon calls" && v.file === "addon/WoWCompanion/Bad.lua",
      ),
    ).toBe(true);
  });

  it("detects a deprecated chat global", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "addon/WoWCompanion/Bad.lua", "ChatEdit_ActivateChat(DEFAULT_CHAT_FRAME)\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) => v.rule === "no deprecated chat globals" && v.file === "addon/WoWCompanion/Bad.lua",
      ),
    ).toBe(true);
  });

  it("detects a non-loopback API bind", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "apps/companion/src/api.ts", "server.listen(47831, '0.0.0.0');\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "local API must bind 127.0.0.1 only" && v.file === "apps/companion/src/api.ts",
      ),
    ).toBe(true);
  });

  it("detects a listen call with no host argument", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "apps/companion/src/api.ts", "server.listen(47831);\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "local API must bind 127.0.0.1 only" && v.file === "apps/companion/src/api.ts",
      ),
    ).toBe(true);
  });

  it("detects a listen call bound to ::", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "apps/companion/src/api.ts", "server.listen(47831, '::');\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "local API must bind 127.0.0.1 only" && v.file === "apps/companion/src/api.ts",
      ),
    ).toBe(true);
  });

  it("detects a listen call with an object argument and no host", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "apps/companion/src/api.ts", "server.listen({ port });\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "local API must bind 127.0.0.1 only" && v.file === "apps/companion/src/api.ts",
      ),
    ).toBe(true);
  });

  it("accepts a listen call bound to 127.0.0.1", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "apps/companion/src/api.ts", "server.listen(47831, '127.0.0.1');\n");
    const violations = runGuard(walkFiles(root));
    expect(violations.filter((v) => v.rule === "local API must bind 127.0.0.1 only")).toEqual([]);
  });

  it("detects a listen call with a ternary host argument", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(
      root,
      "apps/companion/src/api.ts",
      'server.listen(47831, isDev ? "0.0.0.0" : "127.0.0.1");\n',
    );
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "local API must bind 127.0.0.1 only" && v.file === "apps/companion/src/api.ts",
      ),
    ).toBe(true);
  });

  it("detects a listen call whose loopback literal is only in a trailing comment", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "apps/companion/src/api.ts", "server.listen(47831); // 127.0.0.1\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "local API must bind 127.0.0.1 only" && v.file === "apps/companion/src/api.ts",
      ),
    ).toBe(true);
  });

  it("accepts a listen call bound via a host: key on an options object", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(
      root,
      "apps/companion/src/api.ts",
      'server.listen({ port: 47831, host: "127.0.0.1" });\n',
    );
    const violations = runGuard(walkFiles(root));
    expect(violations.filter((v) => v.rule === "local API must bind 127.0.0.1 only")).toEqual([]);
  });

  it("detects a non-loopback listen call split across lines", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "apps/companion/src/api.ts", 'server.listen\n(47831, "0.0.0.0");\n');
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "local API must bind 127.0.0.1 only" && v.file === "apps/companion/src/api.ts",
      ),
    ).toBe(true);
  });

  it("accepts a wrapped multi-line listen call bound to 127.0.0.1", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "apps/companion/src/api.ts", 'server.listen(\n  47831,\n  "127.0.0.1",\n);\n');
    const violations = runGuard(walkFiles(root));
    expect(violations.filter((v) => v.rule === "local API must bind 127.0.0.1 only")).toEqual([]);
  });

  it("detects a custom art asset", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "addon/WoWCompanion/icon.tga", "binary\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) => v.rule === "no custom art or fonts" && v.file === "addon/WoWCompanion/icon.tga",
      ),
    ).toBe(true);
  });

  it("detects a hard-coded colour literal", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "addon/WoWCompanion/Bad.lua", "frame:SetTextColor(1, 0, 0)\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "no hard-coded colour literals" && v.file === "addon/WoWCompanion/Bad.lua",
      ),
    ).toBe(true);
  });

  it("detects a hard-coded colour literal split across lines", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "addon/WoWCompanion/Bad.lua", "frame:SetVertexColor(\n  1, 0, 0\n)\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "no hard-coded colour literals" && v.file === "addon/WoWCompanion/Bad.lua",
      ),
    ).toBe(true);
  });

  it("detects missing gitignore coverage", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, ".gitignore", "data/\nconfig.json\n");
    const violations = runGuard(walkFiles(root));
    expect(violations.some((v) => v.rule === "gitignore coverage")).toBe(true);
  });

  it("ignores a comment line and a substring match when checking gitignore coverage", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, ".gitignore", "# data/\nmy-data/\napps/companion/state/\nconfig.json\n.env*\n");
    const violations = runGuard(walkFiles(root));
    expect(violations.some((v) => v.rule === "gitignore coverage")).toBe(true);
  });

  it("treats a negated pattern as cancelling the earlier entry", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, ".gitignore", "data/\napps/companion/state/\nconfig.json\n.env*\n!.env*\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) => v.rule === "gitignore coverage" && v.detail === "missing exact entry for .env*",
      ),
    ).toBe(true);
  });

  it("detects a tracked file that should be gitignored", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "config.json", '{"real":true}\n');
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some((v) => v.rule === "gitignore coverage" && v.file === "config.json"),
    ).toBe(true);
  });

  it("does not flag config.example.json or .env.example as tracked violations", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "config.example.json", "{}\n");
    writeFile(root, ".env.example", "TOKEN=\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.filter(
        (v) =>
          v.rule === "gitignore coverage" &&
          (v.file === "config.example.json" || v.file === ".env.example"),
      ),
    ).toEqual([]);
  });

  it("detects an unpinned workflow action", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(
      root,
      ".github/workflows/ci.yml",
      "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v5\n",
    );
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) => v.rule === "workflow SHA pin" && v.file === ".github/workflows/ci.yml",
      ),
    ).toBe(true);
  });

  it("accepts a pinned workflow action", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(
      root,
      ".github/workflows/ci.yml",
      "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0\n",
    );
    const violations = runGuard(walkFiles(root));
    expect(violations.filter((v) => v.rule === "workflow SHA pin")).toEqual([]);
  });

  it("passes vacuously with no workflow files", () => {
    const root = makeFixture();
    baseCleanTree(root);
    const violations = runGuard(walkFiles(root));
    expect(violations.filter((v) => v.rule === "workflow SHA pin")).toEqual([]);
  });

  it("detects a bare Node module import in packages/contracts/src", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "packages/contracts/src/bad.ts", "import { readFileSync } from 'fs';\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("detects a node:-prefixed module import in packages/contracts/src", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "packages/contracts/src/bad.ts", "import http from 'node:http';\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("detects a require() of a banned Node module in packages/contracts/src", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "packages/contracts/src/bad.ts", "const cp = require('child_process');\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("detects use of the process global in packages/contracts/src", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "packages/contracts/src/bad.ts", "export const cwd = process.cwd();\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("detects use of the Buffer global in packages/contracts/src", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "packages/contracts/src/bad.ts", "export const b = Buffer.from('x');\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("accepts a pure packages/contracts/src file with no Node I/O", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "packages/contracts/src/pure.ts", "export type Id = string;\n");
    const violations = runGuard(walkFiles(root));
    expect(violations.filter((v) => v.rule === "packages/contracts does no Node I/O")).toEqual([]);
  });

  it("detects a node:-prefixed subpath import in packages/contracts/src", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(
      root,
      "packages/contracts/src/bad.ts",
      "import { readFile } from 'node:fs/promises';\n",
    );
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("detects a bare subpath import in packages/contracts/src", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "packages/contracts/src/bad.ts", "import { readFile } from 'fs/promises';\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("detects a banned module in a wrapped multi-line import", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(
      root,
      "packages/contracts/src/bad.ts",
      "import {\n  readFileSync,\n} from 'node:fs';\n",
    );
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("detects a banned module in an export ... from re-export", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "packages/contracts/src/bad.ts", "export * from 'node:net';\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("detects a bare static side-effect import in packages/contracts/src", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "packages/contracts/src/bad.ts", "import 'fs';\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("detects a node:-prefixed static side-effect import in packages/contracts/src", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "packages/contracts/src/bad.ts", "import 'node:fs';\n");
    const violations = runGuard(walkFiles(root));
    expect(
      violations.some(
        (v) =>
          v.rule === "packages/contracts does no Node I/O" &&
          v.file === "packages/contracts/src/bad.ts",
      ),
    ).toBe(true);
  });

  it("does not flag Node I/O outside packages/contracts/src", () => {
    const root = makeFixture();
    baseCleanTree(root);
    writeFile(root, "apps/companion/src/io.ts", "import { readFileSync } from 'fs';\n");
    const violations = runGuard(walkFiles(root));
    expect(violations.filter((v) => v.rule === "packages/contracts does no Node I/O")).toEqual([]);
  });
});
