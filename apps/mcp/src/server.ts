import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Result, ToolError } from "@wow-companion/contracts";
import { closeDb, openDb } from "./db.ts";
import type { Db } from "./db.ts";
import { createLocalApi } from "./local-api.ts";
import type { LocalApi } from "./local-api.ts";
import { createTools } from "./tools.ts";

function resultContent<T>(result: Result<T, ToolError>): CallToolResult {
  if (result.ok) {
    const text =
      result.value === undefined ? JSON.stringify({ ok: true }) : JSON.stringify(result.value);
    return { content: [{ type: "text", text }] };
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ error: result.error }) }],
    isError: true,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing required env var ${name}`);
  return value;
}

function requirePortEnv(name: string): number {
  const raw = requireEnv(name);
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || String(port) !== raw || port <= 0 || port > 65535) {
    throw new Error(`env var ${name} must be a valid port number, got ${raw}`);
  }
  return port;
}

const nameOrId = z
  .object({ name: z.string().trim().min(1).optional(), id: z.number().optional() })
  .refine((value) => value.name !== undefined || value.id !== undefined, {
    message: "name or id is required",
  });

export function createServer(deps: { readonly db: Db; readonly localApi: LocalApi }): McpServer {
  const tools = createTools(deps.db, deps.localApi);

  const server = new McpServer({ name: "wow-companion-mcp", version: "0.1.0" });

  server.registerTool(
    "get_game_state",
    { description: "Return the current character/quest/gear snapshot." },
    async () => resultContent(await tools.getGameState()),
  );

  server.registerTool(
    "find_npc",
    {
      description: "Find an NPC by name or id, with spawn locations.",
      inputSchema: nameOrId,
    },
    async (args) => resultContent(await tools.findNpc(args)),
  );

  server.registerTool(
    "find_quest",
    {
      description: "Find a quest by name or id, with start/end entities.",
      inputSchema: nameOrId,
    },
    async (args) => resultContent(await tools.findQuest(args)),
  );

  server.registerTool(
    "find_object",
    {
      description: "Find a world object by name, with spawn locations.",
      inputSchema: { name: z.string().trim().min(1) },
    },
    async (args) => resultContent(await tools.findObject(args)),
  );

  server.registerTool(
    "suggest_gear_upgrades",
    {
      description: "Compare equipped gear against QuestieDB-sourced candidates.",
      inputSchema: { slot: z.number().optional() },
    },
    async (args) => resultContent(await tools.suggestGearUpgrades(args)),
  );

  server.registerTool(
    "set_waypoint",
    {
      description: "Set a map waypoint for the ask currently running.",
      inputSchema: {
        uiMapId: z.number(),
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
        label: z.string(),
      },
    },
    async (args) => resultContent(await tools.setWaypoint(args)),
  );

  return server;
}

async function main(): Promise<void> {
  const dbPath = requireEnv("WOWC_DB_PATH");
  const runId = requireEnv("WOWC_RUN");
  const port = requirePortEnv("WOWC_PORT");
  const db = openDb(dbPath);
  const localApi = createLocalApi({ baseUrl: `http://127.0.0.1:${String(port)}`, runId });
  const server = createServer({ db, localApi });
  const shutdown = (): void => closeDb(db);
  process.once("exit", shutdown);
  await server.connect(new StdioServerTransport());
}

const entryArg = process.argv[1];
if (entryArg !== undefined && import.meta.url === pathToFileURL(entryArg).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
