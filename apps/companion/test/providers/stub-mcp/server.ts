import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
};
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string; result?: unknown; error?: unknown }
  | undefined;

export function handleRequest(request: JsonRpcRequest): JsonRpcResponse {
  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: request.id ?? 0,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "wowc-stub-mcp", version: "0.0.0" },
      },
    };
  }
  if (request.method === "notifications/initialized") {
    return undefined;
  }
  if (request.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: request.id ?? 0,
      result: {
        tools: [
          {
            name: "wowc_ping",
            description: "Stub tool: echoes the WOWC_RUN header this call carried.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
      },
    };
  }
  if (request.method === "tools/call") {
    const run = process.env["WOWC_RUN"] ?? "(absent)";
    return {
      jsonrpc: "2.0",
      id: request.id ?? 0,
      result: {
        content: [{ type: "text", text: `pong-from-stub WOWC_RUN=${run}` }],
        isError: false,
      },
    };
  }
  if (request.id !== undefined) {
    return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "method not found" } };
  }
  return undefined;
}

function serve(): void {
  createInterface({ input: process.stdin }).on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      return;
    }
    if (request.method === "tools/call") {
      process.stderr.write(`WOWC_RUN=${process.env["WOWC_RUN"] ?? "(absent)"}\n`);
    }
    const response = handleRequest(request);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  serve();
}
