import { readFileSync, readdirSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { fixturePath } from "./helpers.ts";

const FORBIDDEN_KEYS = ["slash_commands", "terminal_slash_commands", "agents", "plugins", "skills"];
const HOME_PATH_PATTERNS = [
  /[A-Za-z]:\\{1,2}Users\\{1,2}([^"\\]+)/gi,
  /[A-Za-z]:\/Users\/([^"/]+)/gi,
  /\/home\/([^/"]+)/gi,
  /\/Users\/([^/"]+)/gi,
];
const ALLOWED_HOME_USER_SEGMENTS = new Set(["sample-user"]);
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const ALLOWED_EMAIL_DOMAINS = new Set(["example.invalid", "example.com"]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const OPERATOR_USERNAME = userInfo().username;
const USERNAME_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_])${escapeRegExp(OPERATOR_USERNAME)}([^A-Za-z0-9_]|$)`,
  "i",
);

const TRANSIENT_RUN_DIRS = new Set(["codex-runs", "runs", "tmp-cleanup"]);

function listFilesRecursively(dir: string, skipProvenance: boolean): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    if (TRANSIENT_RUN_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    if (!statSync(full).isFile()) return listFilesRecursively(full, skipProvenance);
    if (skipProvenance && entry.toLowerCase() === "provenance.md") return [];
    return [full];
  });
}

function findDisallowedHomeSegment(text: string): string | undefined {
  for (const pattern of HOME_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const segment = (match[1] ?? "").split(/[\\/]/)[0]?.toLowerCase() ?? "";
      if (!ALLOWED_HOME_USER_SEGMENTS.has(segment)) return match[0];
    }
  }
  return undefined;
}

function findDisallowedEmail(text: string): string | undefined {
  EMAIL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMAIL_PATTERN.exec(text)) !== null) {
    const domain = (match[1] ?? "").toLowerCase();
    if (!ALLOWED_EMAIL_DOMAINS.has(domain)) return match[0];
  }
  return undefined;
}

describe("fixtures.privacy", () => {
  const files = listFilesRecursively(fixturePath("fixtures"), true);

  test("no fixture file carries an operator-environment key", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const key of FORBIDDEN_KEYS) {
        expect(text.includes(`"${key}"`), `${file} contains forbidden key "${key}"`).toBe(false);
      }
    }
  });

  test("no fixture file carries the operator's machine username", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(
        USERNAME_PATTERN.test(text),
        `${file} matches the operator username "${OPERATOR_USERNAME}"`,
      ).toBe(false);
    }
  });
});

function readAllStrict(files: string[]): { file: string; text: string }[] {
  return files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
}

const BS = String.fromCharCode(92);
const winHome = (drive: string, users: string, sep: string, name: string): string =>
  [drive + ":", users, name].join(sep);

describe("test-tree.privacy", () => {
  const testRoot = fileURLToPath(new URL("..", import.meta.url));
  const files = listFilesRecursively(testRoot, false);
  const scanned = readAllStrict(files);

  test("every discovered file was read", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(scanned.length).toBe(files.length);
    for (const entry of scanned) {
      expect(typeof entry.text, `${entry.file} was not read`).toBe("string");
    }
  });

  test("no file under apps/companion/test carries a home path with a real-looking user segment", () => {
    for (const { file, text } of scanned) {
      const disallowed = findDisallowedHomeSegment(text);
      expect(disallowed, `${file} matches a disallowed home path: ${String(disallowed)}`).toBe(
        undefined,
      );
    }
  });

  test("no file under apps/companion/test carries an email address outside example.invalid/example.com", () => {
    for (const { file, text } of scanned) {
      const disallowed = findDisallowedEmail(text);
      expect(disallowed, `${file} matches a disallowed email address: ${String(disallowed)}`).toBe(
        undefined,
      );
    }
  });
});

describe("home-path matcher", () => {
  test("flags Windows home paths whatever the case of drive, Users and separator", () => {
    const variants = [
      winHome("C", "Users", BS, "alice"),
      winHome("c", "users", BS, "alice"),
      winHome("C", "USERS", BS, "alice"),
      winHome("c", "Users", "/", "alice"),
      winHome("D", "uSeRs", "/", "alice"),
      winHome("C", "users", BS + BS, "alice"),
    ];
    for (const variant of variants) {
      expect(findDisallowedHomeSegment(variant), variant).toBeDefined();
    }
  });

  test("flags POSIX-style home paths whatever the case", () => {
    for (const root of ["home", "HOME", "users", "Users"]) {
      const path = ["", root, "alice", "x"].join("/");
      expect(findDisallowedHomeSegment(path), path).toBeDefined();
    }
  });

  test("allows the sample-user placeholder in any case", () => {
    expect(findDisallowedHomeSegment(winHome("c", "USERS", BS, "Sample-User"))).toBeUndefined();
  });
});
