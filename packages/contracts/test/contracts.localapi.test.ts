import { describe, expect, it } from "vitest";
import {
  parseGetStateResponse,
  parsePostItemsResponse,
  parsePostWaypointResponse,
} from "../src/local-api.ts";

const snapshot = {
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

describe("contracts.localapi", () => {
  it("parses a successful GetStateResponse body", () => {
    expect(parseGetStateResponse({ ok: true, value: snapshot })).toEqual({
      ok: true,
      value: { ok: true, value: snapshot },
    });
  });

  it("parses a not_connected GetStateResponse body", () => {
    expect(parseGetStateResponse({ ok: false, error: "not_connected" })).toEqual({
      ok: true,
      value: { ok: false, error: "not_connected" },
    });
  });

  it("rejects a GetStateResponse body with an unknown error", () => {
    expect(parseGetStateResponse({ ok: false, error: "made_up" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects a GetStateResponse body whose success value is not a Snapshot", () => {
    expect(parseGetStateResponse({ ok: true, value: { ...snapshot, money: "500" } })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("parses a successful PostItemsResponse body", () => {
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
        stats: { strength: 5 },
      },
    ];
    expect(parsePostItemsResponse({ ok: true, value: items })).toEqual({
      ok: true,
      value: { ok: true, value: items },
    });
  });

  it("parses each PostItemsResponse error variant", () => {
    expect(parsePostItemsResponse({ ok: false, error: "not_connected" })).toEqual({
      ok: true,
      value: { ok: false, error: "not_connected" },
    });
    expect(parsePostItemsResponse({ ok: false, error: "item_timeout" })).toEqual({
      ok: true,
      value: { ok: false, error: "item_timeout" },
    });
  });

  it("rejects a PostItemsResponse body with an error outside its declared union", () => {
    expect(parsePostItemsResponse({ ok: false, error: "no_active_ask" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("parses a successful PostWaypointResponse body", () => {
    expect(parsePostWaypointResponse({ ok: true })).toEqual({
      ok: true,
      value: { ok: true, value: undefined },
    });
  });

  it("parses the no_active_ask PostWaypointResponse error", () => {
    expect(parsePostWaypointResponse({ ok: false, error: "no_active_ask" })).toEqual({
      ok: true,
      value: { ok: false, error: "no_active_ask" },
    });
  });

  it("rejects a PostWaypointResponse body with an error outside its declared union", () => {
    expect(parsePostWaypointResponse({ ok: false, error: "not_connected" })).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("rejects a malformed body missing the ok discriminant", () => {
    expect(parseGetStateResponse({ value: snapshot })).toEqual({ ok: false, error: "bad_frame" });
    expect(parsePostItemsResponse({})).toEqual({ ok: false, error: "bad_frame" });
    expect(parsePostWaypointResponse(null)).toEqual({ ok: false, error: "bad_frame" });
  });
});
