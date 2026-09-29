import { describe, expect, it } from "vitest";
import {
  applyAutoTitle,
  beginAsk,
  completeAsk,
  createChat,
  emptyChatsState,
  failAsk,
  firstWordsTitle,
  renameChat,
  resetChat,
  sanitizeTitle,
} from "../../src/core/chats.ts";
import type { ChatsState, TitleSource } from "../../src/core/chats.ts";

function chatState(name: string, source: TitleSource): ChatsState {
  const result = createChat(emptyChatsState, "c1", name, "claude", 1000, source);
  if (!result.ok) throw new Error("expected ok");
  return result.value.state;
}

const QUESTION = "first question";
const IDENTITY = { at: 1001, text: QUESTION };

function answered(name: string, source: TitleSource): ChatsState {
  const begun = beginAsk(chatState(name, source), "c1", "a1", QUESTION, 1001);
  if (!begun.ok) throw new Error("expected ok");
  const done = completeAsk(begun.value.state, "c1", "a1", { sessionId: "s", text: "ok" }, 1002);
  if (!done.ok) throw new Error("expected ok");
  return done.value.state;
}

function nameOf(state: ChatsState): string | undefined {
  return state.chats[0]?.name;
}

describe("chats.title", () => {
  it("the first ask of an auto chat titles it with the first words of the question at once", () => {
    const begun = beginAsk(
      chatState("Chat 1", "auto"),
      "c1",
      "a1",
      "where is the flight master in Ironforge?",
      1001,
    );
    if (!begun.ok) throw new Error("expected ok");

    expect(nameOf(begun.value.state)).toBe("where is the flight master in");
    expect(begun.value.effects).toHaveLength(1);
    expect(begun.value.effects[0]).toMatchObject({
      t: "chats",
      list: [{ id: "c1", name: "where is the flight master in" }],
    });
  });

  it("first words never cut a word and never pass 32 characters", () => {
    expect(firstWordsTitle("  where   is\nthe flight master in Ironforge  ")).toBe(
      "where is the flight master in",
    );
    expect(firstWordsTitle("a".repeat(50))).toBe("a".repeat(32));
    expect(firstWordsTitle("short one")).toBe("short one");
    expect(firstWordsTitle("   \n ")).toBeUndefined();
  });

  it("an ask of a chat whose title is user leaves the name alone", () => {
    const begun = beginAsk(chatState("My plan", "user"), "c1", "a1", "hello there", 1001);
    if (!begun.ok) throw new Error("expected ok");

    expect(nameOf(begun.value.state)).toBe("My plan");
  });

  it("only the first ask titles: a later ask keeps the current name", () => {
    const first = beginAsk(chatState("Chat 1", "auto"), "c1", "a1", "first question", 1001);
    if (!first.ok) throw new Error("expected ok");
    const done = completeAsk(first.value.state, "c1", "a1", { sessionId: "s", text: "ok" }, 1002);
    if (!done.ok) throw new Error("expected ok");
    const titled = applyAutoTitle(done.value.state, "c1", "Flight master location", IDENTITY);
    if (!titled.ok) throw new Error("expected ok");
    const second = beginAsk(titled.value.state, "c1", "a2", "another question", 1003);
    if (!second.ok) throw new Error("expected ok");

    expect(nameOf(second.value.state)).toBe("Flight master location");
  });

  it("the first reply of an auto chat asks for a provider title, later replies and user chats do not", () => {
    const begun = beginAsk(chatState("Chat 1", "auto"), "c1", "a1", "question one", 1001);
    if (!begun.ok) throw new Error("expected ok");
    const first = completeAsk(
      begun.value.state,
      "c1",
      "a1",
      { sessionId: "s", text: "answer" },
      1002,
    );
    if (!first.ok) throw new Error("expected ok");
    expect(first.value.titleRequest).toEqual({
      question: "question one",
      reply: "answer",
      conversation: { at: 1001, text: "question one" },
    });

    const again = beginAsk(first.value.state, "c1", "a2", "question two", 1003);
    if (!again.ok) throw new Error("expected ok");
    const second = completeAsk(again.value.state, "c1", "a2", { sessionId: "s", text: "b" }, 1004);
    if (!second.ok) throw new Error("expected ok");
    expect(second.value.titleRequest).toBeUndefined();

    const userBegun = beginAsk(chatState("Mine", "user"), "c1", "a1", "question", 1001);
    if (!userBegun.ok) throw new Error("expected ok");
    const user = completeAsk(
      userBegun.value.state,
      "c1",
      "a1",
      { sessionId: "s", text: "x" },
      1002,
    );
    if (!user.ok) throw new Error("expected ok");
    expect(user.value.titleRequest).toBeUndefined();
  });

  it("a provider title replaces an auto name and emits chats, and never touches a user name", () => {
    const applied = applyAutoTitle(
      answered("Chat 1", "auto"),
      "c1",
      "Flight master location",
      IDENTITY,
    );
    if (!applied.ok) throw new Error("expected ok");
    expect(nameOf(applied.value.state)).toBe("Flight master location");
    expect(applied.value.effects).toHaveLength(1);

    const mine = answered("Mine", "user");
    expect(applyAutoTitle(mine, "c1", "Something else", IDENTITY)).toEqual({
      ok: true,
      value: { state: mine, effects: [] },
    });
    expect(applyAutoTitle(emptyChatsState, "gone", "x", IDENTITY)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("a rename sets the source to user, so a late provider title is dropped", () => {
    const renamed = renameChat(answered("Chat 1", "auto"), "c1", "My name");
    if (!renamed.ok) throw new Error("expected ok");
    expect(renamed.value.state.chats[0]?.titleSource).toBe("user");

    const late = applyAutoTitle(renamed.value.state, "c1", "Provider title", IDENTITY);
    if (!late.ok) throw new Error("expected ok");
    expect(nameOf(late.value.state)).toBe("My name");
    expect(late.value.effects).toEqual([]);
  });

  it("a title for another conversation is dropped: the chat was reset or deleted and re-created meanwhile", () => {
    const reset = resetChat(answered("Chat 1", "auto"), "c1");
    if (!reset.ok) throw new Error("expected ok");
    const afterReset = applyAutoTitle(reset.value.state, "c1", "Late title", IDENTITY);
    if (!afterReset.ok) throw new Error("expected ok");
    expect(nameOf(afterReset.value.state)).toBe("first question");
    expect(afterReset.value.effects).toEqual([]);

    const reseeded = chatState("Default", "auto");
    const afterReseed = applyAutoTitle(reseeded, "c1", "Late title", IDENTITY);
    if (!afterReseed.ok) throw new Error("expected ok");
    expect(nameOf(afterReseed.value.state)).toBe("Default");

    const otherAsk = beginAsk(reseeded, "c1", "a9", "a different question", 2000);
    if (!otherAsk.ok) throw new Error("expected ok");
    const afterOther = applyAutoTitle(otherAsk.value.state, "c1", "Late title", IDENTITY);
    if (!afterOther.ok) throw new Error("expected ok");
    expect(nameOf(afterOther.value.state)).toBe("a different question");
  });

  it("the title request carries the question being answered, not an earlier failed one", () => {
    const first = beginAsk(chatState("Chat 1", "auto"), "c1", "a1", "the failed question", 1001);
    if (!first.ok) throw new Error("expected ok");
    const failed = failAsk(first.value.state, "c1", "a1", "provider_failed", 1002);
    if (!failed.ok) throw new Error("expected ok");
    const second = beginAsk(failed.value.state, "c1", "a2", "the real question", 1003);
    if (!second.ok) throw new Error("expected ok");
    const done = completeAsk(
      second.value.state,
      "c1",
      "a2",
      { sessionId: "s", text: "answer" },
      1004,
    );
    if (!done.ok) throw new Error("expected ok");

    expect(done.value.titleRequest?.question).toBe("the real question");
    expect(done.value.titleRequest?.conversation).toEqual({
      at: 1001,
      text: "the failed question",
    });
  });

  it("a reset chat is titled again by its next first ask", () => {
    const reset = resetChat(answered("Old title", "auto"), "c1");
    if (!reset.ok) throw new Error("expected ok");
    const again = beginAsk(reset.value.state, "c1", "a2", "brand new topic", 3000);
    if (!again.ok) throw new Error("expected ok");

    expect(nameOf(again.value.state)).toBe("brand new topic");
  });

  it("sanitizeTitle keeps one plain line of at most 32 characters", () => {
    expect(sanitizeTitle('"Flight Master in Ironforge."')).toBe("Flight Master in Ironforge");
    expect(sanitizeTitle("\n\n**Gear for level 20**\nextra line")).toBe("Gear for level 20");
    expect(sanitizeTitle("Title: a very long provider answer that keeps going")).toBe(
      "a very long provider answer that",
    );
    expect(sanitizeTitle("Title: Gear for level 20")).toBe("Gear for level 20");
    expect(sanitizeTitle("title:   'Quest help'")).toBe("Quest help");
    expect(sanitizeTitle("What's the deal with find_npc")).toBe("What's the deal with find_npc");
    expect(sanitizeTitle("`Gear`")).toBe("Gear");
    expect(sanitizeTitle("_rings_ and more")).toBe("rings_ and more");
    expect(sanitizeTitle("  ")).toBeUndefined();
    expect(sanitizeTitle('""')).toBeUndefined();
  });
});
