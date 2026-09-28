import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db.ts";
import { createServer } from "../src/server.ts";
import { buildMiniDb, cleanupMiniDbTempDirs } from "./fixtures/build-mini-db.ts";
import { createStubLocalApi } from "./fixtures/local-api-stub.ts";
import { makeSnapshot } from "./fixtures/snapshot.ts";

const TOOL_NAMES = [
  "get_game_state",
  "find_npc",
  "find_quest",
  "find_object",
  "suggest_gear_upgrades",
  "set_waypoint",
] as const;

async function connectedClient(db: Db, localApi: ReturnType<typeof createStubLocalApi>) {
  const server = createServer({ db, localApi });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

describe("createServer over InMemoryTransport", () => {
  let db: Db;

  beforeAll(() => {
    db = buildMiniDb();
  });

  afterAll(() => {
    db.close();
    cleanupMiniDbTempDirs();
  });

  it("lists exactly the six mini-spec tools", async () => {
    const { client } = await connectedClient(db, createStubLocalApi({ snapshot: makeSnapshot() }));
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    await client.close();
  });

  it("every tool call returns a schema-valid CallToolResult", async () => {
    const { client } = await connectedClient(db, createStubLocalApi({ snapshot: makeSnapshot() }));
    const getState = await client.callTool({ name: "get_game_state", arguments: {} });
    expect(getState.isError).toBeFalsy();
    const findNpc = await client.callTool({ name: "find_npc", arguments: { name: "Hogger" } });
    expect(findNpc.isError).toBeFalsy();
    const findQuest = await client.callTool({ name: "find_quest", arguments: { id: 100 } });
    expect(findQuest.isError).toBeFalsy();
    const findObject = await client.callTool({
      name: "find_object",
      arguments: { name: "Mailbox" },
    });
    expect(findObject.isError).toBeFalsy();
    const gear = await client.callTool({ name: "suggest_gear_upgrades", arguments: {} });
    expect(gear.isError).toBeFalsy();
    const waypoint = await client.callTool({
      name: "set_waypoint",
      arguments: { uiMapId: 85, x: 10, y: 20, label: "Here" },
    });
    expect(waypoint.isError).toBeFalsy();
    const content = waypoint.content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content[0]).toMatchObject({ type: "text" });
      expect(typeof content[0]?.text).toBe("string");
    }
    await client.close();
  });

  it("find_npc rejects a call with neither name nor id", async () => {
    const { client } = await connectedClient(db, createStubLocalApi({ snapshot: makeSnapshot() }));
    const result = await client.callTool({ name: "find_npc", arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("find_npc, find_quest and find_object reject an empty or whitespace-only name (aca-r2-9)", async () => {
    const { client } = await connectedClient(db, createStubLocalApi({ snapshot: makeSnapshot() }));
    const npcBlank = await client.callTool({ name: "find_npc", arguments: { name: "" } });
    expect(npcBlank.isError).toBe(true);
    const npcWhitespace = await client.callTool({ name: "find_npc", arguments: { name: "   " } });
    expect(npcWhitespace.isError).toBe(true);
    const questBlank = await client.callTool({ name: "find_quest", arguments: { name: "" } });
    expect(questBlank.isError).toBe(true);
    const objectBlank = await client.callTool({ name: "find_object", arguments: { name: "  " } });
    expect(objectBlank.isError).toBe(true);
    await client.close();
  });

  it("set_waypoint surfaces no_active_ask as a schema-valid error result", async () => {
    const { client } = await connectedClient(
      db,
      createStubLocalApi({ snapshot: makeSnapshot(), activeAsk: false }),
    );
    const result = await client.callTool({
      name: "set_waypoint",
      arguments: { uiMapId: 85, x: 10, y: 20, label: "Here" },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
