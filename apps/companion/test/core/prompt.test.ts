import { describe, expect, it } from "vitest";
import { build } from "../../src/core/prompt.ts";
import type { Snapshot } from "@wow-companion/contracts";

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

describe("prompt.build", () => {
  it("is deterministic for the same inputs", () => {
    expect(build(snapshot, [])).toBe(build(snapshot, []));
  });

  it("includes mentions when present", () => {
    const prompt = build(snapshot, [{ kind: "quest", questId: 42 }]);
    expect(prompt).toContain("quest 42");
  });

  it("includes the transcript summary when given, before the character line", () => {
    const prompt = build(snapshot, [], "you: hi\nclaude: hello");
    expect(prompt.indexOf("Previous conversation summary")).toBeLessThan(
      prompt.indexOf("Character:"),
    );
  });

  it("omits the transcript summary section when not given", () => {
    expect(build(snapshot, [])).not.toContain("Previous conversation summary");
  });

  it("never includes the character's name (transport-only, not sent to providers)", () => {
    expect(build(snapshot, [])).not.toContain(snapshot.character.name);
  });
});
