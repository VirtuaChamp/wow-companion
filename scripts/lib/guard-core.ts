import { readFileSync } from "node:fs";

export type Violation = { rule: string; file: string; line: number; detail: string };

export type ListedFile = { relPath: string; absPath: string };

const readLines = (absPath: string): string[] => readFileSync(absPath, "utf8").split(/\r?\n/);

const scanFiles = (
  files: ListedFile[],
  predicate: (relPath: string) => boolean,
  patterns: RegExp[],
  ruleName: string,
): Violation[] => {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!predicate(file.relPath)) {
      continue;
    }
    const lines = readLines(file.absPath);
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          violations.push({
            rule: ruleName,
            file: file.relPath,
            line: index + 1,
            detail: line.trim(),
          });
        }
      }
    });
  }
  return violations;
};

const secretPatterns: RegExp[] = [
  /WTF[\\/]Account[\\/][0-9]/g,
  /C:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)/g,
  /\b[s][k]-[A-Za-z0-9_-]{16,}/g,
  /\b[g][h][p]_[A-Za-z0-9]{20,}/g,
  new RegExp(["CLAUDE_CODE_OAUTH_TOKEN", "=."].join(""), "g"),
  new RegExp(["ANTHROPIC_API_KEY", "=."].join(""), "g"),
];

const documentedPatternStrings = new Set<string>([
  ["CLAUDE_CODE_OAUTH_TOKEN", "=."].join(""),
  ["ANTHROPIC_API_KEY", "=."].join(""),
  "C:\\\\Users\\\\",
]);

const isSpecDoc = (relPath: string): boolean => /^docs\/specs\/[^/]+\.md$/.test(relPath);

type BacktickSpan = { start: number; end: number; content: string };

const backtickSpans = (line: string): BacktickSpan[] => {
  const spans: BacktickSpan[] = [];
  const regex = /`([^`]*)`/g;
  let match = regex.exec(line);
  while (match !== null) {
    const content = match[1] ?? "";
    spans.push({ start: match.index + 1, end: match.index + 1 + content.length, content });
    match = regex.exec(line);
  }
  return spans;
};

const isExemptSpan = (spans: BacktickSpan[], start: number, end: number): boolean =>
  spans.some(
    (span) => span.start <= start && end <= span.end && documentedPatternStrings.has(span.content),
  );

const secretsRule = (files: ListedFile[]): Violation[] => {
  const violations: Violation[] = [];
  for (const file of files) {
    const exempt = isSpecDoc(file.relPath);
    const lines = readLines(file.absPath);
    lines.forEach((line, index) => {
      const spans = exempt ? backtickSpans(line) : [];
      for (const pattern of secretPatterns) {
        for (const match of line.matchAll(pattern)) {
          const start = match.index ?? 0;
          const end = start + match[0].length;
          if (isExemptSpan(spans, start, end)) {
            continue;
          }
          violations.push({
            rule: "D12 secret pattern",
            file: file.relPath,
            line: index + 1,
            detail: line.trim(),
          });
        }
      }
    });
  }
  return violations;
};

const noGameInputRule = (files: ListedFile[]): Violation[] => {
  const patterns = [
    /SendInput/,
    /keybd_event/,
    /PostMessage/,
    /SendKeys/,
    /ReadProcessMemory/,
    /robotjs/,
    /nut-js/,
  ];
  return scanFiles(
    files,
    (relPath) => relPath.startsWith("apps/companion/") || relPath.startsWith("apps/mcp/"),
    patterns,
    "no game input",
  );
};

const noProtectedAddonCallsRule = (files: ListedFile[]): Violation[] => {
  const patterns = [
    /SendChatMessage/,
    /C_ChatInfo\.SendAddonMessage/,
    /RunMacroText/,
    /HasRestrictions/,
  ];
  return scanFiles(
    files,
    (relPath) => relPath.startsWith("addon/"),
    patterns,
    "no protected addon calls",
  );
};

const noSharedDialogTaintRule = (files: ListedFile[]): Violation[] => {
  const patterns = [/StaticPopup/, /hooksecurefunc/];
  return scanFiles(
    files,
    (relPath) => relPath.startsWith("addon/") && relPath.endsWith(".lua"),
    patterns,
    "no shared Blizzard dialog or hook in the addon",
  );
};

const noDeprecatedChatGlobalsRule = (files: ListedFile[]): Violation[] => {
  const patterns = [/ChatFrame_AddMessageEventFilter/, /ChatEdit_/, /ChatFrame_ReplyTell/];
  return scanFiles(
    files,
    (relPath) => relPath.startsWith("addon/"),
    patterns,
    "no deprecated chat globals",
  );
};

const skipStringLiteral = (text: string, start: number): number => {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === quote) {
      return i;
    }
    i += 1;
  }
  return text.length - 1;
};

const findMatchingParen = (text: string, openIndex: number): number => {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipStringLiteral(text, i);
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
};

const splitTopLevelArgs = (argsStr: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < argsStr.length; i += 1) {
    const ch = argsStr[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipStringLiteral(argsStr, i);
      current += argsStr.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
    }
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0 || parts.length > 0) {
    parts.push(current);
  }
  return parts;
};

const isLoopbackLiteral = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed === '"127.0.0.1"' || trimmed === "'127.0.0.1'";
};

const objectHasLoopbackHost = (objStr: string): boolean => {
  const trimmed = objStr.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }
  const fields = splitTopLevelArgs(trimmed.slice(1, -1));
  for (const field of fields) {
    const colonIndex = field.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }
    const key = field.slice(0, colonIndex).trim();
    const value = field.slice(colonIndex + 1);
    if (key === "host" && isLoopbackLiteral(value)) {
      return true;
    }
  }
  return false;
};

const listenCallBindsLoopback = (
  content: string,
  openIndex: number,
  closeIndex: number,
): boolean => {
  const args = splitTopLevelArgs(content.slice(openIndex + 1, closeIndex))
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  if (args.length >= 2 && isLoopbackLiteral(args[1] ?? "")) {
    return true;
  }
  if (args.length >= 1 && objectHasLoopbackHost(args[0] ?? "")) {
    return true;
  }
  return false;
};

const lineNumberAt = (content: string, index: number): number =>
  content.slice(0, index).split(/\r?\n/).length;

const localApiBindRule = (files: ListedFile[]): Violation[] => {
  const violations: Violation[] = [];
  const callPattern = /\.listen\s*\(/g;
  for (const file of files) {
    if (!(file.relPath.startsWith("apps/companion/") || file.relPath.startsWith("apps/mcp/"))) {
      continue;
    }
    const content = readFileSync(file.absPath, "utf8");
    callPattern.lastIndex = 0;
    let match = callPattern.exec(content);
    while (match !== null) {
      const openIndex = match.index + match[0].length - 1;
      const closeIndex = findMatchingParen(content, openIndex);
      if (closeIndex !== -1 && !listenCallBindsLoopback(content, openIndex, closeIndex)) {
        violations.push({
          rule: "local API must bind 127.0.0.1 only",
          file: file.relPath,
          line: lineNumberAt(content, match.index),
          detail: content
            .slice(match.index, closeIndex + 1)
            .replace(/\s+/g, " ")
            .trim(),
        });
      }
      match = callPattern.exec(content);
    }
  }
  return violations;
};

const colorCallPattern = /\bSet(?:Text|Vertex)Color\s*\(/g;

const colorLiteralViolations = (file: ListedFile): Violation[] => {
  const violations: Violation[] = [];
  const content = readFileSync(file.absPath, "utf8");
  colorCallPattern.lastIndex = 0;
  let match = colorCallPattern.exec(content);
  while (match !== null) {
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingParen(content, openIndex);
    if (closeIndex !== -1) {
      const args = splitTopLevelArgs(content.slice(openIndex + 1, closeIndex))
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      if (args.some((a) => /^[\d.]/.test(a))) {
        violations.push({
          rule: "no hard-coded colour literals",
          file: file.relPath,
          line: lineNumberAt(content, match.index),
          detail: content
            .slice(match.index, closeIndex + 1)
            .replace(/\s+/g, " ")
            .trim(),
        });
      }
    }
    match = colorCallPattern.exec(content);
  }
  return violations;
};

const noCustomArtRule = (files: ListedFile[]): Violation[] => {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!file.relPath.startsWith("addon/")) {
      continue;
    }
    if (/\.(tga|blp|ttf|otf)$/i.test(file.relPath)) {
      violations.push({
        rule: "no custom art or fonts",
        file: file.relPath,
        line: 1,
        detail: "disallowed asset extension",
      });
    }
    violations.push(...colorLiteralViolations(file));
  }
  return violations;
};

const parseGitignorePatterns = (content: string): string[] => {
  const active: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("!")) {
      const negated = line.slice(1);
      const index = active.indexOf(negated);
      if (index !== -1) {
        active.splice(index, 1);
      }
      continue;
    }
    active.push(line);
  }
  return active;
};

const isExemptFromTrackingBan = (relPath: string): boolean =>
  relPath === "config.example.json" || relPath === ".env.example";

const isBannedFromTracking = (relPath: string): boolean => {
  if (isExemptFromTrackingBan(relPath)) {
    return false;
  }
  if (relPath === "config.json") {
    return true;
  }
  if (relPath.startsWith("data/") || relPath.startsWith("apps/companion/state/")) {
    return true;
  }
  const baseName = relPath.split("/").pop() ?? "";
  return baseName.startsWith(".env");
};

const gitignoreCoverageRule = (files: ListedFile[]): Violation[] => {
  const gitignoreFile = files.find((f) => f.relPath === ".gitignore");
  if (!gitignoreFile) {
    return [
      { rule: "gitignore coverage", file: ".gitignore", line: 1, detail: "missing .gitignore" },
    ];
  }
  const content = readFileSync(gitignoreFile.absPath, "utf8");
  const patterns = parseGitignorePatterns(content);
  const required: { label: string; variants: string[] }[] = [
    { label: "data/", variants: ["data/", "/data/"] },
    { label: "apps/companion/state/", variants: ["apps/companion/state/"] },
    { label: "config.json", variants: ["config.json"] },
    { label: ".env*", variants: [".env*"] },
  ];
  const violations: Violation[] = [];
  for (const req of required) {
    if (!req.variants.some((variant) => patterns.includes(variant))) {
      violations.push({
        rule: "gitignore coverage",
        file: ".gitignore",
        line: 1,
        detail: `missing exact entry for ${req.label}`,
      });
    }
  }
  for (const file of files) {
    if (isBannedFromTracking(file.relPath)) {
      violations.push({
        rule: "gitignore coverage",
        file: file.relPath,
        line: 1,
        detail: "tracked file must be gitignored",
      });
    }
  }
  return violations;
};

const workflowShaPinRule = (files: ListedFile[]): Violation[] => {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!file.relPath.startsWith(".github/workflows/") || !file.relPath.endsWith(".yml")) {
      continue;
    }
    const lines = readLines(file.absPath);
    lines.forEach((line, index) => {
      const usesMatch = /^\s*-?\s*uses:\s*(\S+)/.exec(line);
      if (!usesMatch) {
        return;
      }
      const ref = usesMatch[1] ?? "";
      const pinned =
        /@[0-9a-f]{40}(\s+#\s*v[0-9]+\.[0-9]+\.[0-9]+)?/.test(ref) &&
        / #\s*v[0-9]+\.[0-9]+\.[0-9]+/.test(line);
      if (!pinned) {
        violations.push({
          rule: "workflow SHA pin",
          file: file.relPath,
          line: index + 1,
          detail: line.trim(),
        });
      }
    });
  }
  return violations;
};

const contractsBannedNodeModules = ["fs", "net", "child_process", "http"];

const contractsNoNodeIoRule = (files: ListedFile[]): Violation[] => {
  const importPattern = new RegExp(
    `(?:from|import\\s*\\(?|require\\()\\s*["'](?:node:)?(?:${contractsBannedNodeModules.join("|")})(?:/[^"']*)?["']`,
  );
  const globalPattern = /\b(?:process|Buffer)\b/;
  const violations: Violation[] = [];
  for (const file of files) {
    if (!file.relPath.startsWith("packages/contracts/src/")) {
      continue;
    }
    const lines = readLines(file.absPath);
    lines.forEach((line, index) => {
      if (importPattern.test(line) || globalPattern.test(line)) {
        violations.push({
          rule: "packages/contracts does no Node I/O",
          file: file.relPath,
          line: index + 1,
          detail: line.trim(),
        });
      }
    });
  }
  return violations;
};

const allRules: ((files: ListedFile[]) => Violation[])[] = [
  secretsRule,
  noGameInputRule,
  noProtectedAddonCallsRule,
  noDeprecatedChatGlobalsRule,
  noSharedDialogTaintRule,
  localApiBindRule,
  noCustomArtRule,
  gitignoreCoverageRule,
  workflowShaPinRule,
  contractsNoNodeIoRule,
];

export const runGuard = (files: ListedFile[]): Violation[] =>
  allRules.flatMap((rule) => rule(files));
