import { describe, expect, test } from "vitest";
import { redact, sanitizeEnvEcho, sanitizeLine } from "./redact.ts";

const winPath = (...parts: string[]): string => parts.join(String.fromCharCode(92));

describe("redact", () => {
  test("strips a Windows user path", () => {
    expect(
      redact(`cwd: "${winPath("C:", "Users", "sample-user", "wow-companion")}"`),
    ).not.toContain("sample-user");
  });

  test("strips an email address", () => {
    expect(redact("account: user@example.invalid")).toBe("account: <redacted-email>");
  });

  test("leaves ordinary text untouched", () => {
    expect(redact("pong")).toBe("pong");
  });
});

describe("sanitizeEnvEcho", () => {
  test("strips the operator environment out of a system/init message", () => {
    const sanitized = sanitizeEnvEcho({
      type: "system",
      subtype: "init",
      session_id: "abc",
      model: "claude-opus-5-5",
      tools: ["mcp__wowc__wowc_ping"],
      mcp_servers: [{ name: "wowc", status: "connected", source: "dynamic" }],
      slash_commands: ["deep-research"],
      agents: ["general-purpose"],
      plugins: [{ name: "agents-md" }],
      skills: ["design"],
      cwd: winPath("C:", "Users", "sample-user", "wow-companion"),
      memory_paths: {
        auto: winPath("C:", "Users", "sample-user", ".claude", "projects", "memory", ""),
      },
    }) as Record<string, unknown>;
    expect(sanitized["slash_commands"]).toBeUndefined();
    expect(sanitized["agents"]).toBeUndefined();
    expect(sanitized["plugins"]).toBeUndefined();
    expect(sanitized["skills"]).toBeUndefined();
    expect(sanitized["memory_paths"]).toBeUndefined();
    expect(sanitized["cwd"]).toBe("<workspace>");
    expect(sanitized["mcp_servers"]).toEqual([{ name: "wowc", status: "connected" }]);
    expect(sanitized["session_id"]).toBe("abc");
  });

  test("leaves a non-init message untouched", () => {
    const message = { type: "system", subtype: "thinking_tokens", estimated_tokens: 50 };
    expect(sanitizeEnvEcho(message)).toEqual(message);
  });
});

describe("sanitizeLine", () => {
  test("strips the operator environment out of a system/init line", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "abc",
      slash_commands: ["deep-research"],
      cwd: winPath("C:", "Users", "sample-user", "wow-companion"),
    });
    const sanitized = JSON.parse(sanitizeLine(line));
    expect(sanitized.slash_commands).toBeUndefined();
    expect(sanitized.cwd).toBe("<workspace>");
    expect(sanitized.session_id).toBe("abc");
  });

  test("round-trips a plain assistant line unchanged", () => {
    const line = JSON.stringify({ type: "assistant", session_id: "abc" });
    expect(sanitizeLine(line)).toBe(line);
  });

  test("leaves a non-JSON line untouched", () => {
    expect(sanitizeLine("stderr: some plain text")).toBe("stderr: some plain text");
  });
});
