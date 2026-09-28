import { describe, expect, it } from "vitest";
import { beginAsk, completeAsk, createChat, emptyChatsState } from "../../src/core/chats.ts";

describe("chats.busy", () => {
  it("a second ask on a running chat returns busy", () => {
    const created = createChat(emptyChatsState, "c1", "Quests", "claude", 1000);
    if (!created.ok) throw new Error("expected ok");
    const first = beginAsk(created.value.state, "c1", "ask-1", "hello", 1001);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = beginAsk(first.value.state, "c1", "ask-2", "again", 1002);
    expect(second).toEqual({ ok: false, error: "busy" });
  });

  it("a chat running an ask does not block an ask on a different chat: both run in parallel", () => {
    const withFirst = createChat(emptyChatsState, "c1", "First", "claude", 1000);
    if (!withFirst.ok) throw new Error("expected ok");
    const withSecond = createChat(withFirst.value.state, "c2", "Second", "codex", 1001);
    if (!withSecond.ok) throw new Error("expected ok");

    const firstBegun = beginAsk(withSecond.value.state, "c1", "ask-1", "hello", 1002);
    expect(firstBegun.ok).toBe(true);
    if (!firstBegun.ok) return;

    const secondBegun = beginAsk(firstBegun.value.state, "c2", "ask-2", "hi", 1003);
    expect(secondBegun.ok).toBe(true);
    if (secondBegun.ok) {
      const chat1 = secondBegun.value.state.chats.find((c) => c.id === "c1");
      const chat2 = secondBegun.value.state.chats.find((c) => c.id === "c2");
      expect(chat1?.runningAsk?.id).toBe("ask-1");
      expect(chat2?.runningAsk?.id).toBe("ask-2");
    }
  });

  it("completing one chat's ask leaves the other chat still running with its session untouched", () => {
    const withFirst = createChat(emptyChatsState, "c1", "First", "claude", 1000);
    if (!withFirst.ok) throw new Error("expected ok");
    const withSecond = createChat(withFirst.value.state, "c2", "Second", "codex", 1001);
    if (!withSecond.ok) throw new Error("expected ok");

    const firstBegun = beginAsk(withSecond.value.state, "c1", "ask-1", "hello", 1002);
    if (!firstBegun.ok) throw new Error("expected ok");
    const secondBegun = beginAsk(firstBegun.value.state, "c2", "ask-2", "hi", 1003);
    if (!secondBegun.ok) throw new Error("expected ok");

    const firstCompleted = completeAsk(
      secondBegun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: "reply" },
      1004,
    );
    expect(firstCompleted.ok).toBe(true);
    if (firstCompleted.ok) {
      const chat2 = firstCompleted.value.state.chats.find((c) => c.id === "c2");
      expect(chat2?.runningAsk?.id).toBe("ask-2");
      expect(chat2?.sessionId).toBeUndefined();
    }
  });

  it("completing a stale ask id returns not_found and leaves the state unchanged", () => {
    const created = createChat(emptyChatsState, "c1", "Quests", "claude", 1000);
    if (!created.ok) throw new Error("expected ok");
    const begun = beginAsk(created.value.state, "c1", "ask-1", "hello", 1001);
    if (!begun.ok) throw new Error("expected ok");

    const result = completeAsk(
      begun.value.state,
      "c1",
      "ask-stale",
      { sessionId: "s1", text: "reply" },
      1002,
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});
