import { describe, expect, it } from "vitest";
import {
  beginAsk,
  cancelChat,
  completeAsk,
  createChat,
  deleteChat,
  emptyChatsState,
  failAsk,
  openChat,
  renameChat,
  resetChat,
  setChatProvider,
} from "../../src/core/chats.ts";
import type { ProviderError } from "@wow-companion/contracts";
import { apply } from "../../src/core/settings.ts";
import type { ProviderOption, Settings } from "../../src/core/settings.ts";

function created(
  id: string,
  name: string,
  provider: "claude" | "codex" | "cursor",
  now: number,
  titleSource: "auto" | "user" = "auto",
) {
  const result = createChat(emptyChatsState, id, name, provider, now, titleSource);
  if (!result.ok) throw new Error("expected ok");
  return result.value;
}

describe("chats.lifecycle", () => {
  it("create adds a chat, makes it active and emits chats + history", () => {
    const result = created("c1", "Quests", "claude", 1000);

    expect(result.state.activeId).toBe("c1");
    expect(result.state.chats).toHaveLength(1);
    expect(result.effects).toEqual([
      {
        t: "chats",
        active: "c1",
        list: [
          { id: "c1", name: "Quests", provider: "claude", lastAt: 1000, running: false, unread: 0 },
        ],
      },
      { t: "history", chat: "c1", lines: [] },
    ]);
  });

  it("create with an id already in use is refused", () => {
    const result = created("c1", "Quests", "claude", 1000);

    expect(createChat(result.state, "c1", "Again", "codex", 1001)).toEqual({
      ok: false,
      error: "exists",
    });
  });

  it("open clears unread only after a reply lands while another chat is active", () => {
    const withFirst = created("c1", "First", "claude", 1000);
    const withSecond = createChat(withFirst.state, "c2", "Second", "claude", 1001);
    if (!withSecond.ok) throw new Error("expected ok");

    const begun = beginAsk(withSecond.value.state, "c1", "ask-1", "hello", 1002);
    if (!begun.ok) throw new Error("expected ok");
    const completed = completeAsk(
      begun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: "hi" },
      1003,
    );
    if (!completed.ok) throw new Error("expected ok");

    expect(completed.value.state.chats.find((c) => c.id === "c1")?.unread).toBe(1);

    const opened = openChat(completed.value.state, "c1");
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value.state.chats.find((c) => c.id === "c1")?.unread).toBe(0);
    }
  });

  it("open on an unknown chat returns not_found", () => {
    expect(openChat(emptyChatsState, "missing")).toEqual({ ok: false, error: "not_found" });
  });

  it("rename updates the name and emits chats", () => {
    const result = created("c1", "Quests", "claude", 1000);
    const renamed = renameChat(result.state, "c1", "Gear talk");

    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.value.state.chats[0]?.name).toBe("Gear talk");
    }
  });

  it("a chat-only provider switch drops the existing session and labels the next reply with the new provider", () => {
    const result = created("c1", "Quests", "claude", 1000);
    const firstAsk = beginAsk(result.state, "c1", "ask-0", "hi", 1000);
    if (!firstAsk.ok) throw new Error("expected ok");
    const firstCompleted = completeAsk(
      firstAsk.value.state,
      "c1",
      "ask-0",
      { sessionId: "s0", text: "hello" },
      1000,
    );
    if (!firstCompleted.ok) throw new Error("expected ok");
    expect(firstCompleted.value.state.chats[0]?.sessionId).toBe("s0");

    const switched = setChatProvider(firstCompleted.value.state, "c1", "codex");
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(switched.value.state.chats[0]?.sessionId).toBeUndefined();
    expect(switched.value.state.chats[0]?.provider).toBe("codex");

    const begun = beginAsk(switched.value.state, "c1", "ask-1", "hello", 1001);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.value.sessionId).toBeUndefined();

    const completed = completeAsk(
      begun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: "hi" },
      1002,
    );
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      const reply = completed.value.effects.find((e) => e.t === "reply");
      expect(reply).toMatchObject({ provider: "codex" });
    }
  });

  it("switching provider while an ask is running returns busy", () => {
    const result = created("c1", "Quests", "claude", 1000);
    const begun = beginAsk(result.state, "c1", "ask-1", "hello", 1001);
    if (!begun.ok) throw new Error("expected ok");

    expect(setChatProvider(begun.value.state, "c1", "codex")).toEqual({
      ok: false,
      error: "busy",
    });
  });

  it("delete removes the chat and reassigns active to the most recent remaining one", () => {
    const withFirst = created("c1", "First", "claude", 1000);
    const withSecond = createChat(withFirst.state, "c2", "Second", "claude", 2000);
    if (!withSecond.ok) throw new Error("expected ok");

    const opened = openChat(withSecond.value.state, "c1");
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const deleted = deleteChat(opened.value.state, "c1");
    expect(deleted).toEqual({
      ok: true,
      value: {
        state: {
          activeId: "c2",
          chats: [
            {
              id: "c2",
              name: "Second",
              titleSource: "auto",
              provider: "claude",
              unread: 0,
              lastAt: 2000,
              history: [],
            },
          ],
        },
        effects: [
          {
            t: "chats",
            active: "c2",
            list: [
              {
                id: "c2",
                name: "Second",
                provider: "claude",
                lastAt: 2000,
                running: false,
                unread: 0,
              },
            ],
          },
        ],
      },
    });
  });

  it("delete refuses while an ask is running on that chat", () => {
    const result = created("c1", "Quests", "claude", 1000);
    const begun = beginAsk(result.state, "c1", "ask-1", "hello", 1001);
    if (!begun.ok) throw new Error("expected ok");

    expect(deleteChat(begun.value.state, "c1")).toEqual({ ok: false, error: "busy" });
  });

  it("reset clears history and session id but keeps name and provider", () => {
    const result = created("c1", "Quests", "claude", 1000, "user");
    const begun = beginAsk(result.state, "c1", "ask-1", "hello", 1001);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const completed = completeAsk(
      begun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: "hi" },
      1002,
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    const reset = resetChat(completed.value.state, "c1");
    expect(reset.ok).toBe(true);
    if (reset.ok) {
      const chat = reset.value.state.chats[0];
      expect(chat?.sessionId).toBeUndefined();
      expect(chat?.history).toEqual([]);
      expect(chat?.name).toBe("Quests");
      expect(chat?.provider).toBe("claude");
    }
  });

  it("reset while the chat is running returns busy", () => {
    const result = created("c1", "Quests", "claude", 1000);
    const begun = beginAsk(result.state, "c1", "ask-1", "hello", 1001);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    expect(resetChat(begun.value.state, "c1")).toEqual({ ok: false, error: "busy" });
  });

  it("cancel keeps the chat busy without emitting anything itself; failAsk('cancelled') sends the only terminal error and never bumps unread", () => {
    const withFirst = created("c1", "Quests", "claude", 1000);
    const withSecond = createChat(withFirst.state, "c2", "Second", "claude", 1001);
    if (!withSecond.ok) throw new Error("expected ok");
    const opened = openChat(withSecond.value.state, "c2");
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const begun = beginAsk(opened.value.state, "c1", "ask-1", "hello", 1002);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const cancelled = cancelChat(begun.value.state, "c1");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.value.askId).toBe("ask-1");
    expect(cancelled.value.state.chats.find((c) => c.id === "c1")?.runningAsk?.id).toBe("ask-1");
    expect(cancelled.value.effects.filter((e) => e.t === "error")).toHaveLength(0);

    const failed = failAsk(cancelled.value.state, "c1", "ask-1", "cancelled", 1003);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.effects.filter((e) => e.t === "error")).toHaveLength(1);
    expect(failed.value.effects).toContainEqual({
      t: "error",
      id: "ask-1",
      chat: "c1",
      code: "cancelled",
      message: "cancelled",
    });
    expect(failed.value.state.chats.find((c) => c.id === "c1")?.runningAsk).toBeUndefined();
    expect(failed.value.state.chats.find((c) => c.id === "c1")?.unread).toBe(0);
  });

  it("cancelling a chat with no running ask is a no-op and returns no askId", () => {
    const result = created("c1", "Quests", "claude", 1000);

    const cancelled = cancelChat(result.state, "c1");
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.value.askId).toBeUndefined();
      expect(cancelled.value.effects.filter((e) => e.t === "error")).toHaveLength(0);
    }
  });

  it("history keeps only the last 200 lines", () => {
    let state = created("c1", "Quests", "claude", 0).state;
    for (let i = 0; i < 210; i += 1) {
      const begun = beginAsk(state, "c1", `ask-${i}`, `q${i}`, i);
      if (!begun.ok) throw new Error("expected ok");
      const completed = completeAsk(
        begun.value.state,
        "c1",
        `ask-${i}`,
        { sessionId: "s", text: `a${i}` },
        i,
      );
      if (!completed.ok) throw new Error("expected ok");
      state = completed.value.state;
    }

    const history = state.chats[0]?.history ?? [];
    expect(history).toHaveLength(200);
    expect(history[0]).toEqual({ who: "you", text: "q110", at: 110 });
  });

  it("open reprints history (last 200 lines) and the next ask resumes the stored session id", () => {
    const result = created("c1", "Quests", "claude", 1000);
    const begun = beginAsk(result.state, "c1", "ask-1", "hello", 1001);
    if (!begun.ok) throw new Error("expected ok");
    const completed = completeAsk(
      begun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: "hi" },
      1002,
    );
    if (!completed.ok) throw new Error("expected ok");

    const opened = openChat(completed.value.state, "c1");
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value.effects.find((e) => e.t === "history")).toEqual({
        t: "history",
        chat: "c1",
        lines: [
          { who: "you", text: "hello", at: 1001 },
          { who: "claude", text: "hi", at: 1002 },
        ],
      });
    }

    const nextAsk = beginAsk(completed.value.state, "c1", "ask-2", "again", 1003);
    expect(nextAsk).toEqual({
      ok: true,
      value: {
        state: expect.anything(),
        effects: expect.anything(),
        sessionId: "s1",
      },
    });
  });

  it("a session the provider no longer knows starts fresh with a transcript summary and a notice line, without releasing the lock or repeating the question", () => {
    const result = created("c1", "Quests", "claude", 1000);
    const begun = beginAsk(result.state, "c1", "ask-1", "hello", 1001);
    if (!begun.ok) throw new Error("expected ok");
    const completed = completeAsk(
      begun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: "hi" },
      1002,
    );
    if (!completed.ok) throw new Error("expected ok");

    const begunAgain = beginAsk(completed.value.state, "c1", "ask-2", "again", 1003);
    if (!begunAgain.ok) throw new Error("expected ok");
    expect(begunAgain.value.sessionId).toBe("s1");

    const failed = failAsk(begunAgain.value.state, "c1", "ask-2", "session_unknown", 1004);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.retry).toEqual({
      askId: "ask-2",
      text: "again",
      transcriptSummary: "you: hello\nclaude: hi",
    });
    const chat = failed.value.state.chats[0];
    expect(chat?.sessionId).toBeUndefined();
    expect(chat?.runningAsk?.id).toBe("ask-2");
    expect(chat?.history.at(-1)).toEqual({
      who: "claude",
      text: "session expired, starting a new one",
      at: 1004,
      kind: "notice",
    });
    expect(chat?.history.filter((line) => line.text === "again")).toHaveLength(1);

    const stolen = beginAsk(failed.value.state, "c1", "ask-4", "steal the lock", 1005);
    expect(stolen).toEqual({ ok: false, error: "busy" });

    const retried = completeAsk(
      failed.value.state,
      "c1",
      "ask-2",
      { sessionId: "s2", text: "hi again" },
      1006,
    );
    expect(retried.ok).toBe(true);
    if (retried.ok) {
      expect(retried.value.state.chats[0]?.runningAsk).toBeUndefined();
      expect(retried.value.state.chats[0]?.sessionId).toBe("s2");
    }
  });

  it("a second session_unknown with no session id left to lose ends in a terminal error instead of retrying forever", () => {
    const result = created("c1", "Quests", "claude", 1000);
    const begun = beginAsk(result.state, "c1", "ask-1", "hello", 1001);
    if (!begun.ok) throw new Error("expected ok");
    const completed = completeAsk(
      begun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: "hi" },
      1002,
    );
    if (!completed.ok) throw new Error("expected ok");

    const begunAgain = beginAsk(completed.value.state, "c1", "ask-2", "again", 1003);
    if (!begunAgain.ok) throw new Error("expected ok");

    const firstFail = failAsk(begunAgain.value.state, "c1", "ask-2", "session_unknown", 1004);
    expect(firstFail.ok).toBe(true);
    if (!firstFail.ok) return;
    expect(firstFail.value.retry).toBeDefined();
    expect(firstFail.value.state.chats[0]?.sessionId).toBeUndefined();

    const secondFail = failAsk(firstFail.value.state, "c1", "ask-2", "session_unknown", 1005);
    expect(secondFail.ok).toBe(true);
    if (!secondFail.ok) return;
    expect(secondFail.value.retry).toBeUndefined();
    expect(secondFail.value.effects).toContainEqual(
      expect.objectContaining({ t: "error", id: "ask-2", code: "session_unknown" }),
    );
    expect(secondFail.value.state.chats[0]?.runningAsk).toBeUndefined();
  });

  it("beginAsk always sets the running ask's text alongside its id: retry never falls back to an empty question", () => {
    const result = created("c1", "Quests", "claude", 1000);
    const begun = beginAsk(result.state, "c1", "ask-1", "hello", 1001);
    if (!begun.ok) throw new Error("expected ok");
    const completed = completeAsk(
      begun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: "hi" },
      1002,
    );
    if (!completed.ok) throw new Error("expected ok");
    const begunAgain = beginAsk(completed.value.state, "c1", "ask-2", "again", 1003);
    if (!begunAgain.ok) throw new Error("expected ok");

    const failed = failAsk(begunAgain.value.state, "c1", "ask-2", "session_unknown", 1004);
    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.value.retry?.text).toBe("again");
    }
  });

  it("a reply summary is shorter than the full text for a long multi-line reply, and a reply starting with a blank line still gets a non-empty summary", () => {
    const result = created("c1", "Quests", "claude", 1000);
    const begun = beginAsk(result.state, "c1", "ask-1", "hello", 1001);
    if (!begun.ok) throw new Error("expected ok");

    const longLine = "a".repeat(220);
    const completed = completeAsk(
      begun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: `${longLine}\nmore lines follow` },
      1002,
    );
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      const reply = completed.value.effects.find((e) => e.t === "reply");
      expect(reply).toMatchObject({ summary: `${"a".repeat(200)}…` });
      if (reply?.t === "reply") {
        expect(reply.summary.length).toBeLessThan(reply.full.length);
      }
    }

    const secondBegun = beginAsk(
      completed.ok ? completed.value.state : result.state,
      "c1",
      "ask-2",
      "again",
      1003,
    );
    if (!secondBegun.ok) throw new Error("expected ok");
    const secondCompleted = completeAsk(
      secondBegun.value.state,
      "c1",
      "ask-2",
      { sessionId: "s1", text: "\n\nreal answer" },
      1004,
    );
    expect(secondCompleted.ok).toBe(true);
    if (secondCompleted.ok) {
      const reply = secondCompleted.value.effects.find((e) => e.t === "reply");
      expect(reply).toMatchObject({ summary: "real answer" });
    }
  });

  it("a chat-only settings message that switches provider labels the next reply with the new provider once setChatProvider is applied", () => {
    const providers: ProviderOption[] = [
      { id: "claude", enabled: true, models: ["claude-sonnet-5"], efforts: [] },
      { id: "codex", enabled: true, models: ["gpt-5-codex"], efforts: [] },
    ];
    const settings: Settings = {
      global: { provider: "claude", model: "claude-sonnet-5" },
      perChat: {},
    };
    const result = created("c1", "Quests", "claude", 1000);

    const applied = apply(
      settings,
      { t: "settings", provider: "codex", model: "gpt-5-codex", chat: "c1" },
      providers,
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const providerChange = applied.value.providerChange;
    expect(providerChange).toEqual({ chatId: "c1", provider: "codex" });
    if (providerChange === undefined) return;

    const switched = setChatProvider(result.state, "c1", providerChange.provider);
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;

    const begun = beginAsk(switched.value.state, "c1", "ask-1", "hello", 1001);
    if (!begun.ok) throw new Error("expected ok");
    const completedAsk = completeAsk(
      begun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: "hi" },
      1002,
    );
    expect(completedAsk.ok).toBe(true);
    if (completedAsk.ok) {
      const reply = completedAsk.value.effects.find((e) => e.t === "reply");
      expect(reply).toMatchObject({ provider: "codex" });
    }
  });
});

describe("chats.providerErrors", () => {
  const providerErrors: readonly ProviderError[] = [
    "provider_missing",
    "provider_auth",
    "provider_disabled",
    "provider_failed",
    "session_unknown",
    "timeout",
    "cancelled",
  ];

  it.each(providerErrors)(
    "failAsk(%s) ends the ask with that code and a non-empty message",
    (error) => {
      const begun = beginAsk(
        created("c1", "Quests", "claude", 1000).state,
        "c1",
        "ask-1",
        "hi",
        1001,
      );
      if (!begun.ok) throw new Error("expected ok");

      const failed = failAsk(begun.value.state, "c1", "ask-1", error, 1002);

      expect(failed.ok).toBe(true);
      if (!failed.ok) return;
      const terminal = failed.value.effects.find((e) => e.t === "error");
      expect(terminal).toMatchObject({ t: "error", id: "ask-1", code: error });
      expect(terminal?.t === "error" && terminal.message.length > 0).toBe(true);
      expect(failed.value.state.chats[0]?.runningAsk).toBeUndefined();
    },
  );

  it("provider_failed is worded as a provider failure", () => {
    const begun = beginAsk(
      created("c1", "Quests", "claude", 1000).state,
      "c1",
      "ask-1",
      "hi",
      1001,
    );
    if (!begun.ok) throw new Error("expected ok");

    const failed = failAsk(begun.value.state, "c1", "ask-1", "provider_failed", 1002);

    expect(failed.ok && failed.value.effects).toContainEqual({
      t: "error",
      id: "ask-1",
      chat: "c1",
      code: "provider_failed",
      message: "provider failed",
    });
  });

  it("stamps lastAt and history lines in the injected whole seconds", () => {
    const begun = beginAsk(
      created("c1", "Quests", "claude", 1_700_000_000).state,
      "c1",
      "ask-1",
      "hi",
      1_700_000_005,
    );
    if (!begun.ok) throw new Error("expected ok");

    expect(begun.value.state.chats[0]?.lastAt).toBe(1_700_000_005);
    expect(begun.value.state.chats[0]?.history[0]?.at).toBe(1_700_000_005);
  });
});

describe("chats.crossCheck", () => {
  function withSession(provider: "claude" | "codex" | "cursor") {
    const begun = beginAsk(
      created("c1", "Quests", provider, 1000).state,
      "c1",
      "ask-1",
      "hi",
      1001,
    );
    if (!begun.ok) throw new Error("expected ok");
    const done = completeAsk(
      begun.value.state,
      "c1",
      "ask-1",
      { sessionId: "s1", text: "yo" },
      1002,
    );
    if (!done.ok) throw new Error("expected ok");
    return done.value.state;
  }

  it("setChatProvider to the provider the chat already has keeps state and sessionId unchanged", () => {
    const state = withSession("claude");

    const same = setChatProvider(state, "c1", "claude");

    expect(same.ok && same.value.state).toEqual(state);
    expect(same.ok && same.value.state.chats[0]?.sessionId).toBe("s1");
    expect(same.ok && same.value.effects).toEqual([]);
  });

  it("setChatProvider to another provider still drops the session", () => {
    const changed = setChatProvider(withSession("claude"), "c1", "codex");

    expect(changed.ok && changed.value.state.chats[0]?.sessionId).toBeUndefined();
    expect(changed.ok && changed.value.state.chats[0]?.provider).toBe("codex");
  });

  it("a session_unknown result on a cancelling ask never retries: it ends as cancelled and releases the lock", () => {
    const begun = beginAsk(withSession("claude"), "c1", "ask-2", "again", 1003);
    if (!begun.ok) throw new Error("expected ok");
    const cancelled = cancelChat(begun.value.state, "c1");
    if (!cancelled.ok) throw new Error("expected ok");

    const failed = failAsk(cancelled.value.state, "c1", "ask-2", "session_unknown", 1004);

    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.retry).toBeUndefined();
    expect(failed.value.state.chats[0]?.runningAsk).toBeUndefined();
    expect(failed.value.state.chats[0]?.unread).toBe(0);
    expect(failed.value.effects.filter((e) => e.t === "error")).toEqual([
      { t: "error", id: "ask-2", chat: "c1", code: "cancelled", message: "cancelled" },
    ]);
  });

  it("the history message carries only who, text and at, even for the session-expired notice", () => {
    const begun = beginAsk(withSession("claude"), "c1", "ask-2", "again", 1003);
    if (!begun.ok) throw new Error("expected ok");
    const failed = failAsk(begun.value.state, "c1", "ask-2", "session_unknown", 1004);
    if (!failed.ok) throw new Error("expected ok");

    const history = failed.value.effects.find((e) => e.t === "history");

    expect(history?.t === "history" && history.lines.at(-1)).toEqual({
      who: "claude",
      text: "session expired, starting a new one",
      at: 1004,
    });
    for (const line of history?.t === "history" ? history.lines : []) {
      expect(Object.keys(line).sort()).toEqual(["at", "text", "who"]);
    }
    expect(failed.value.state.chats[0]?.history.at(-1)?.kind).toBe("notice");
  });
});
