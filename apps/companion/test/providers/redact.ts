import { userInfo } from "node:os";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const OPERATOR_USERNAME = userInfo().username;

const REDACTIONS: [RegExp, string][] = [
  [/[A-Za-z]:\\{1,2}Users\\{1,2}[^"\\]*/g, "<home>"],
  [/[A-Za-z]:\/Users\/[^"/]+/g, "<home>"],
  [/\/home\/[^/"]+/g, "<home>"],
  [/\/Users\/[^/"]+/g, "<home>"],
  [/sk-[A-Za-z0-9_-]{10,}/g, "<redacted-key>"],
  [/(Authorization["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1<redacted>"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<redacted-email>"],
  [
    new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(OPERATOR_USERNAME)}([^A-Za-z0-9_]|$)`, "gi"),
    "$1<operator>$2",
  ],
];

export function redact(text: string): string {
  return REDACTIONS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
}

const ENV_ECHO_KEPT_KEYS = [
  "type",
  "subtype",
  "session_id",
  "model",
  "tools",
  "mcp_servers",
  "apiKeySource",
  "permissionMode",
];

export function sanitizeEnvEcho(message: unknown): unknown {
  if (typeof message !== "object" || message === null) return message;
  const record = message as Record<string, unknown>;
  if (record["type"] !== "system" || record["subtype"] !== "init") return message;
  const kept: Record<string, unknown> = {};
  for (const key of ENV_ECHO_KEPT_KEYS) {
    if (key in record) kept[key] = record[key];
  }
  if ("cwd" in record) kept["cwd"] = "<workspace>";
  if (Array.isArray(kept["mcp_servers"])) {
    kept["mcp_servers"] = (kept["mcp_servers"] as unknown[]).map((server) => {
      if (typeof server !== "object" || server === null) return server;
      const entry = server as Record<string, unknown>;
      return { name: entry["name"], status: entry["status"] };
    });
  }
  return kept;
}

export function sanitizeLine(line: string): string {
  try {
    return JSON.stringify(sanitizeEnvEcho(JSON.parse(line)));
  } catch {
    return line;
  }
}
