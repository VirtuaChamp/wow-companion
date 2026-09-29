import { describe, expect, it } from "vitest";
import {
  isEffort,
  isProviderId,
  parseCompanionToGame,
  parseGameToCompanion,
  parseItemsRequest,
  parseSnapshot,
  parseWaypointRequest,
} from "../src/parse.ts";
import type { CompanionToGame, GameToCompanion, Snapshot } from "../src/types.ts";
import type { Choice } from "../src/index.ts";

const choiceExportCheck: Choice = { provider: "claude", model: "opus" };
void choiceExportCheck;

const gameToCompanionSamples: GameToCompanion[] = [
  { t: "hello", v: 1, build: "1.60.1.70009", iface: 16001, session: "sess-1", slot: 1 },
  {
    t: "state",
    seq: 1,
    delta: {
      character: {
        name: "Alice",
        level: 10,
        classId: 1,
        raceId: 1,
        faction: "Alliance",
        xp: 100,
        xpMax: 1000,
      },
      position: { uiMapId: 1, zone: "Elwynn Forest", subzone: "Goldshire", x: 10, y: 20 },
      money: 500,
      quests: [
        {
          questId: 1,
          title: "A Quest",
          level: 5,
          complete: false,
          objectives: [{ text: "Kill 5 boars", done: false, have: 2, need: 5 }],
        },
      ],
      equipped: [{ slot: 1, itemId: 100, itemLevel: 20 }],
      bags: [{ bag: 0, slot: 0, itemId: 200, count: 1 }],
      professions: [{ name: "Mining", rank: 10, max: 300 }],
      talents: [{ tab: "Arms", points: 5 }],
    },
  },
  {
    t: "ask",
    id: "ask-1",
    chat: "chat-1",
    text: "where is @quest",
    mentions: [
      { kind: "quest", questId: 1 },
      { kind: "item", itemId: 2, bag: 0, slot: 1, equipSlot: 2 },
    ],
  },
  {
    t: "items",
    req: "req-1",
    items: [
      {
        itemId: 100,
        name: "Sword",
        quality: 3,
        itemLevel: 20,
        requiredLevel: 10,
        equipLoc: "INVTYPE_WEAPON",
        classId: 2,
        subClassId: 7,
        stats: { strength: 5 },
      },
    ],
  },
  { t: "cmd", chat: "chat-1", name: "new" },
  { t: "cmd", chat: "chat-1", name: "rename", arg: "New Name" },
  { t: "settings", provider: "claude", model: "opus", effort: "medium" },
  { t: "settings", chat: "chat-1", provider: "codex", model: "gpt" },
];

const companionToGameSamples: CompanionToGame[] = [
  {
    t: "chats",
    active: "chat-1",
    list: [
      { id: "chat-1", name: "Main", provider: "claude", lastAt: 1000, running: false, unread: 0 },
    ],
  },
  {
    t: "history",
    chat: "chat-1",
    lines: [
      { who: "you", text: "hi", at: 1000 },
      { who: "claude", text: "hello", at: 1001 },
    ],
  },
  {
    t: "options",
    providers: [
      {
        id: "claude",
        installed: true,
        enabled: true,
        models: ["opus", "sonnet"],
        efforts: ["low", "medium", "high"],
        current: { model: "opus", effort: "medium" },
      },
      {
        id: "cursor",
        installed: false,
        enabled: false,
        reason: "not installed",
        models: [],
        efforts: [],
        current: { model: "" },
      },
    ],
    active: { provider: "claude", model: "opus", effort: "medium" },
  },
  {
    t: "options",
    providers: [
      {
        id: "claude",
        installed: true,
        enabled: true,
        models: ["opus"],
        efforts: ["medium"],
        current: { model: "opus", effort: "medium" },
      },
    ],
    active: { provider: "claude", model: "opus", effort: "medium" },
    chat: { id: "chat-1", provider: "claude", model: "opus" },
    companionVersion: "0.4.2",
  },
  { t: "progress", id: "ask-1", chat: "c1", status: "thinking" },
  { t: "progress", id: "ask-1", chat: "c1", status: "tool", detail: "find_npc" },
  {
    t: "reply",
    id: "ask-1",
    chat: "chat-1",
    provider: "claude",
    summary: "sum",
    full: "full text",
  },
  {
    t: "reply",
    id: "ask-1",
    chat: "chat-1",
    provider: "claude",
    summary: "sum",
    full: "full text",
    waypoint: { uiMapId: 1, x: 10, y: 20, label: "Goldshire" },
  },
  { t: "itemreq", req: "req-1", ids: [100, 200] },
  { t: "ack", seq: 5 },
  { t: "error", id: "ask-1", code: "provider_missing", message: "not installed" },
  { t: "error", id: "ask-1", code: "provider_failed", message: "unclassified failure" },
  { t: "error", code: "bad_frame", message: "unparseable" },
  { t: "error", code: "bad_settings", message: "model not offered" },
];

describe("contracts.parse", () => {
  it("round-trips every GameToCompanion variant through JSON.stringify and parseGameToCompanion", () => {
    for (const sample of gameToCompanionSamples) {
      const wire = JSON.parse(JSON.stringify(sample)) as unknown;
      const result = parseGameToCompanion(wire);
      expect(result).toEqual({ ok: true, value: sample });
    }
  });

  it("round-trips every CompanionToGame variant through JSON.stringify and parseCompanionToGame", () => {
    for (const sample of companionToGameSamples) {
      const wire = JSON.parse(JSON.stringify(sample)) as unknown;
      const result = parseCompanionToGame(wire);
      expect(result).toEqual({ ok: true, value: sample });
    }
  });

  it("rejects an unknown t on GameToCompanion", () => {
    expect(parseGameToCompanion({ t: "nope", foo: 1 })).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects an unknown t on CompanionToGame", () => {
    expect(parseCompanionToGame({ t: "nope", foo: 1 })).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects a missing required field", () => {
    expect(parseGameToCompanion({ t: "hello", v: 1, build: "1.60.1" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(parseCompanionToGame({ t: "ack" })).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects a wrongly typed field", () => {
    expect(
      parseGameToCompanion({
        t: "hello",
        v: 1,
        build: 123,
        iface: 16001,
        session: "sess-1",
        slot: 1,
      }),
    ).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(parseCompanionToGame({ t: "ack", seq: "5" })).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects hello without a session token", () => {
    expect(
      parseGameToCompanion({ t: "hello", v: 1, build: "1.60.1", iface: 16001, slot: 1 }),
    ).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(
      parseGameToCompanion({
        t: "hello",
        v: 1,
        build: "1.60.1",
        iface: 16001,
        session: 7,
        slot: 1,
      }),
    ).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("accepts hello with again true and rejects any other again value", () => {
    const base = { t: "hello", v: 1, build: "1.60.1", iface: 16001, session: "sess-1", slot: 3 };
    expect(parseGameToCompanion({ ...base, again: true })).toEqual({
      ok: true,
      value: { ...base, again: true },
    });
    expect(parseGameToCompanion(base)).toEqual({ ok: true, value: base });
    expect(parseGameToCompanion({ ...base, again: false })).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(parseGameToCompanion({ ...base, again: "yes" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("bounds the hello session token to 17 plain characters", () => {
    const base = { t: "hello", v: 1, build: "1.60.1", iface: 16001, slot: 1 };
    expect(parseGameToCompanion({ ...base, session: "0000002a-0000002b" }).ok).toBe(true);
    expect(parseGameToCompanion({ ...base, session: "0000002a-0000002b0" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(parseGameToCompanion({ ...base, session: "" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(parseGameToCompanion({ ...base, session: 'a"b' })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects hello without a slot number", () => {
    expect(
      parseGameToCompanion({ t: "hello", v: 1, build: "1.60.1", iface: 16001, session: "sess-1" }),
    ).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(
      parseGameToCompanion({
        t: "hello",
        v: 1,
        build: "1.60.1",
        iface: 16001,
        session: "sess-1",
        slot: "1",
      }),
    ).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects a non-string options.companionVersion", () => {
    expect(
      parseCompanionToGame({
        t: "options",
        providers: [],
        active: { provider: "claude", model: "opus" },
        companionVersion: 42,
      }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects an options message missing active", () => {
    expect(
      parseCompanionToGame({
        t: "options",
        providers: [],
      }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects a wrongly typed options.active.effort", () => {
    expect(
      parseCompanionToGame({
        t: "options",
        providers: [],
        active: { provider: "claude", model: "opus", effort: "extreme" },
      }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects an options.chat missing id", () => {
    expect(
      parseCompanionToGame({
        t: "options",
        providers: [],
        active: { provider: "claude", model: "opus" },
        chat: { provider: "claude", model: "opus" },
      }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects an extra unknown t alongside otherwise valid fields", () => {
    expect(
      parseGameToCompanion({
        t: "unknown_extra",
        id: "ask-1",
        chat: "chat-1",
        text: "hi",
        mentions: [],
      }),
    ).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("never returns a partial value on a bad frame", () => {
    const result = parseGameToCompanion({ t: "ask", id: "ask-1", chat: "chat-1", mentions: [] });
    expect(result.ok).toBe(false);
    expect("value" in result).toBe(false);
  });

  it("rejects hello when v is not exactly 1", () => {
    expect(
      parseGameToCompanion({
        t: "hello",
        v: 2,
        build: "1.60.1",
        iface: 16001,
        session: "sess-1",
        slot: 1,
      }),
    ).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(
      parseGameToCompanion({
        t: "hello",
        v: "1",
        build: "1.60.1",
        iface: 16001,
        session: "sess-1",
        slot: 1,
      }),
    ).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects state.delta sub-objects that fail their nested guard", () => {
    const stateCorruptions: unknown[] = [
      {
        character: {
          name: "Alice",
          level: "10",
          classId: 1,
          raceId: 1,
          faction: "Alliance",
          xp: 1,
          xpMax: 1,
        },
      },
      {
        character: {
          name: "Alice",
          level: 10,
          classId: 1,
          raceId: 1,
          faction: "Klingon",
          xp: 1,
          xpMax: 1,
        },
      },
      { position: { uiMapId: 1, zone: "Elwynn", subzone: "Goldshire", x: "10", y: 20 } },
      { money: "500" },
      {
        quests: [
          {
            questId: 1,
            title: "A",
            level: 5,
            complete: false,
            objectives: [{ text: "x", done: "no", have: 1, need: 2 }],
          },
        ],
      },
      { quests: [{ questId: 1, title: "A", level: 5, complete: "false", objectives: [] }] },
      { equipped: [{ slot: 1, itemId: 100, itemLevel: "20" }] },
      { bags: [{ bag: 0, slot: 0, itemId: 200, count: "1" }] },
      { professions: [{ name: "Mining", rank: "10", max: 300 }] },
      { talents: [{ tab: "Arms", points: "5" }] },
    ];
    for (const delta of stateCorruptions) {
      expect(parseGameToCompanion({ t: "state", seq: 1, delta })).toEqual({
        ok: false,
        error: "bad_frame",
      });
    }
  });

  it("rejects Mention shapes that fail their kind-specific guard", () => {
    const askWith = (mentions: unknown[]) => ({
      t: "ask",
      id: "a",
      chat: "c",
      text: "t",
      mentions,
    });
    expect(parseGameToCompanion(askWith([{ kind: "npc", entityId: 1 }]))).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(parseGameToCompanion(askWith([{ kind: "quest" }]))).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(parseGameToCompanion(askWith([{ kind: "item", itemId: 1, bag: "0" }]))).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects ItemDetail.stats with a non-number value", () => {
    const items = [
      {
        itemId: 1,
        name: "Sword",
        quality: 1,
        itemLevel: 1,
        requiredLevel: 1,
        equipLoc: "INVTYPE_WEAPON",
        classId: 1,
        subClassId: 1,
        stats: { strength: "5" },
      },
    ];
    expect(parseGameToCompanion({ t: "items", req: "r", items })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects cmd.name outside the known command set", () => {
    expect(parseGameToCompanion({ t: "cmd", chat: "c", name: "explode" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects settings.effort outside the known effort set", () => {
    expect(
      parseGameToCompanion({ t: "settings", provider: "claude", model: "opus", effort: "ultra" }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects options.current.effort outside the known effort set", () => {
    expect(
      parseCompanionToGame({
        t: "options",
        providers: [
          {
            id: "claude",
            installed: true,
            enabled: true,
            models: ["opus"],
            efforts: ["medium"],
            current: { model: "opus", effort: "ultra" },
          },
        ],
        active: { provider: "claude", model: "opus" },
      }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects reply.waypoint with a malformed shape", () => {
    expect(
      parseCompanionToGame({
        t: "reply",
        id: "a",
        chat: "c",
        provider: "claude",
        summary: "s",
        full: "f",
        waypoint: { uiMapId: 1, x: 10, y: "20", label: "Goldshire" },
      }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects error.code outside the known ErrorCode set", () => {
    expect(parseCompanionToGame({ t: "error", code: "made_up", message: "x" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects history.who outside 'you' and the known provider ids", () => {
    expect(
      parseCompanionToGame({
        t: "history",
        chat: "c",
        lines: [{ who: "gemini", text: "hi", at: 1 }],
      }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("accepts an empty object where an array field is declared, returning []", () => {
    const result = parseGameToCompanion({ t: "ask", id: "a", chat: "c", text: "t", mentions: {} });
    expect(result).toEqual({
      ok: true,
      value: { t: "ask", id: "a", chat: "c", text: "t", mentions: [] },
    });
  });

  it("accepts an empty array where a record field is declared, returning {}", () => {
    const items = [
      {
        itemId: 1,
        name: "Grey Junk",
        quality: 0,
        itemLevel: 1,
        requiredLevel: 1,
        equipLoc: "",
        classId: 1,
        subClassId: 1,
        stats: [],
      },
    ];
    const result = parseGameToCompanion({ t: "items", req: "r", items });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({ t: "items", req: "r", items: [{ ...items[0], stats: {} }] });
  });

  it("rejects a non-empty object where an array field is declared", () => {
    expect(
      parseGameToCompanion({
        t: "ask",
        id: "a",
        chat: "c",
        text: "t",
        mentions: { kind: "quest" },
      }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects a non-empty array where a record field is declared", () => {
    const items = [
      {
        itemId: 1,
        name: "Sword",
        quality: 1,
        itemLevel: 1,
        requiredLevel: 1,
        equipLoc: "INVTYPE_WEAPON",
        classId: 1,
        subClassId: 1,
        stats: [5],
      },
    ];
    expect(parseGameToCompanion({ t: "items", req: "r", items })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("drops unknown keys at every nested level instead of carrying the input object", () => {
    const result = parseGameToCompanion({
      t: "ask",
      id: "a",
      chat: "c",
      text: "t",
      mentions: [{ kind: "quest", questId: 1, extra: "nope" }],
      unexpectedTopLevel: "nope",
    });
    expect(result).toEqual({
      ok: true,
      value: { t: "ask", id: "a", chat: "c", text: "t", mentions: [{ kind: "quest", questId: 1 }] },
    });
  });

  it("rejects a chats message with an invalid provider id", () => {
    expect(
      parseCompanionToGame({
        t: "chats",
        active: "chat-1",
        list: [
          {
            id: "chat-1",
            name: "Main",
            provider: "gemini",
            lastAt: 1000,
            running: false,
            unread: 0,
          },
        ],
      }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("accepts an error naming the chat of its ask and rejects a non-string chat", () => {
    expect(
      parseCompanionToGame({ t: "error", id: "a1", chat: "c1", code: "busy", message: "m" }),
    ).toEqual({
      ok: true,
      value: { t: "error", id: "a1", chat: "c1", code: "busy", message: "m" },
    });
    expect(parseCompanionToGame({ t: "error", code: "busy", message: "m" }).ok).toBe(true);
    expect(parseCompanionToGame({ t: "error", chat: 4, code: "busy", message: "m" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects a progress message without the chat it belongs to", () => {
    expect(parseCompanionToGame({ t: "progress", id: "ask-1", status: "thinking" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(
      parseCompanionToGame({ t: "progress", id: "ask-1", chat: 7, status: "thinking" }),
    ).toEqual({ ok: false, error: "bad_frame" });
  });

  it("rejects a progress message with status outside the known set", () => {
    expect(
      parseCompanionToGame({ t: "progress", id: "ask-1", chat: "c1", status: "done" }),
    ).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects an itemreq message with non-number ids", () => {
    expect(parseCompanionToGame({ t: "itemreq", req: "req-1", ids: ["1"] })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects a settings message with an invalid provider id", () => {
    expect(parseGameToCompanion({ t: "settings", provider: "gemini", model: "gpt" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects a state message with delta that is not an object", () => {
    expect(parseGameToCompanion({ t: "state", seq: 1, delta: "invalid" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(parseGameToCompanion({ t: "state", seq: 1, delta: [1, 2, 3] })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("accepts a state message whose empty delta was encoded as [] (the codec's empty-table rule)", () => {
    expect(parseGameToCompanion({ t: "state", seq: 1, delta: [] })).toEqual({
      ok: true,
      value: { t: "state", seq: 1, delta: {} },
    });
  });

  it("round-trips a full Snapshot through parseSnapshot", () => {
    const snapshot: Snapshot = {
      character: {
        name: "Alice",
        level: 10,
        classId: 1,
        raceId: 1,
        faction: "Alliance",
        xp: 100,
        xpMax: 1000,
      },
      position: { uiMapId: 1, zone: "Elwynn Forest", subzone: "Goldshire", x: 10, y: 20 },
      money: 500,
      quests: [],
      equipped: [],
      bags: [],
      professions: [],
      talents: [],
    };
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(parseSnapshot({ ...snapshot, money: "500" })).toBeUndefined();
  });
});

describe("contracts.parse local API requests", () => {
  it("parses a waypoint request body and refuses anything else", () => {
    const body = { uiMapId: 85, x: 40.5, y: 60, label: "Innkeeper" };
    expect(parseWaypointRequest(body)).toEqual(body);
    expect(parseWaypointRequest({ ...body, x: "40" })).toBeUndefined();
    expect(parseWaypointRequest({ uiMapId: 85, x: 1, y: 2 })).toBeUndefined();
    expect(parseWaypointRequest(null)).toBeUndefined();
    expect(parseWaypointRequest([body])).toBeUndefined();
  });

  it("parses an items request body of integer ids and accepts an empty Lua table", () => {
    expect(parseItemsRequest({ ids: [1, 200] })).toEqual({ ids: [1, 200] });
    expect(parseItemsRequest({ ids: [] })).toEqual({ ids: [] });
    expect(parseItemsRequest({ ids: {} })).toEqual({ ids: [] });
    expect(parseItemsRequest({ ids: [1.5] })).toBeUndefined();
    expect(parseItemsRequest({ ids: ["1"] })).toBeUndefined();
    expect(parseItemsRequest({})).toBeUndefined();
    expect(parseItemsRequest([1, 2])).toBeUndefined();
  });

  it("exposes the provider and effort guards", () => {
    expect(isProviderId("claude")).toBe(true);
    expect(isProviderId("gpt")).toBe(false);
    expect(isEffort("xhigh")).toBe(true);
    expect(isEffort("ultra")).toBe(false);
  });
});
