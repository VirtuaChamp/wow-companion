import { describe, expect, test } from "vitest";
import { handleRequest } from "./stub-mcp/server.ts";

describe("stub-mcp.handleRequest", () => {
  test("initialize", () => {
    const response = handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(response?.result).toMatchObject({ serverInfo: { name: "wowc-stub-mcp" } });
  });

  test("tools/list", () => {
    const response = handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const result = response?.result as { tools: { name: string }[] };
    expect(result.tools.map((t) => t.name)).toEqual(["wowc_ping"]);
  });

  test("tools/call echoes WOWC_RUN", () => {
    const previous = process.env["WOWC_RUN"];
    process.env["WOWC_RUN"] = "test-run-id";
    const response = handleRequest({ jsonrpc: "2.0", id: 3, method: "tools/call" });
    process.env["WOWC_RUN"] = previous;
    const result = response?.result as { content: { text: string }[] };
    expect(result.content[0]?.text).toContain("test-run-id");
  });

  test("unknown method with id returns an error", () => {
    const response = handleRequest({ jsonrpc: "2.0", id: 4, method: "nope" });
    expect(response?.error).toBeDefined();
  });

  test("notification returns nothing", () => {
    const response = handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response).toBeUndefined();
  });
});
