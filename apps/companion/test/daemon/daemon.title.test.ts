import { afterEach, describe, expect, it } from "vitest";
import type { CompanionToGame, ProviderError, Result } from "@wow-companion/contracts";
import { emptyChatsState } from "../../src/core/chats.ts";
import { fakeProvider, hello, makeSnapshot, startDaemon, waitFor, waitForSent } from "./helpers.ts";
import type { Harness, RunFn, RunInput } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

type RunResult = Result<{ sessionId: string; text: string }, ProviderError>;

type Deferred = { promise: Promise<RunResult>; resolve: (value: RunResult) => void };

function deferred(): Deferred {
  let resolve: (value: RunResult) => void = () => {};
  const promise = new Promise<RunResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function chatNames(harness: Harness): (string | undefined)[] {
  return harness.link
    .sent()
    .filter((msg): msg is Extract<CompanionToGame, { t: "chats" }> => msg.t === "chats")
    .map((msg) => msg.list.find((chat) => chat.id === "default")?.name);
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

async function connected(
  run: RunFn,
  logs: string[] = [],
  overrides: Parameters<typeof startDaemon>[0] = {},
): Promise<Harness> {
  const harness = startDaemon({
    initialChats: emptyChatsState,
    providers: new Map([["claude", fakeProvider("claude", run)]]),
    log: (line) => logs.push(line),
    ...overrides,
  });
  cleanups.push(harness.stop);
  harness.link.push(hello());
  harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
  await waitForSent(harness.link, 3);
  return harness;
}

function answering(titleOutcome: () => Promise<RunResult>, seen: RunInput[] = []): RunFn {
  return async (input) => {
    seen.push(input);
    return input.tools === "none"
      ? titleOutcome()
      : { ok: true, value: { sessionId: "s-1", text: "Gryth Thurden stands at the Great Forge." } };
  };
}

function titled(text: string): () => Promise<RunResult> {
  return async () => ({ ok: true, value: { sessionId: "title-session", text } });
}

describe("chats.title", () => {
  it("titles the chat with the first words at once, then with the provider title after the first reply", async () => {
    const seen: RunInput[] = [];
    const harness = await connected(answering(titled('"Ironforge Flight Master"'), seen));

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "where is the flight master in Ironforge?",
      mentions: [],
    });
    await waitFor(() => chatNames(harness).at(-1) === "Ironforge Flight Master");

    const names = chatNames(harness);
    expect(names).toContain("where is the flight master in");
    expect(names.indexOf("where is the flight master in")).toBeLessThan(
      names.indexOf("Ironforge Flight Master"),
    );
    expect(harness.link.sent().filter((msg) => msg.t === "reply")).toHaveLength(1);

    const titleInput = seen.find((input) => input.tools === "none");
    expect(titleInput?.sessionId).toBeUndefined();
    expect(titleInput?.prompt).toContain("where is the flight master in Ironforge?");
    expect(titleInput?.prompt).toContain("Gryth Thurden stands at the Great Forge.");
    expect(seen.filter((input) => input.tools === undefined)).toHaveLength(1);
  });

  it("is not counted as an ask: no history line, no unread, no session change, no lastAt bump, no busy", async () => {
    const gate = deferred();
    const harness = await connected(answering(() => gate.promise));

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "first question",
      mentions: [],
    });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "reply"));

    harness.link.push({
      t: "ask",
      id: "a2",
      chat: "default",
      text: "second question",
      mentions: [],
    });
    await waitFor(() => harness.link.sent().filter((msg) => msg.t === "reply").length === 2);
    expect(harness.link.sent().some((msg) => msg.t === "error")).toBe(false);

    gate.resolve({ ok: true, value: { sessionId: "title-session", text: "First question topic" } });
    await waitFor(() => chatNames(harness).at(-1) === "First question topic");

    const saved = harness.saves.at(-1)?.chats.find((chat) => chat.id === "default");
    expect(saved?.history.map((line) => line.text)).toEqual([
      "first question",
      "Gryth Thurden stands at the Great Forge.",
      "second question",
      "Gryth Thurden stands at the Great Forge.",
    ]);
    expect(saved?.sessionId).toBe("s-1");
    expect(saved?.runningAsk).toBeUndefined();
    expect(saved?.titleSource).toBe("auto");
  });

  it("a rename while the title run is in flight wins and stops the automatic title", async () => {
    const gate = deferred();
    const harness = await connected(answering(() => gate.promise));

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "first question",
      mentions: [],
    });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "reply"));
    harness.link.push({
      t: "cmd",
      id: "cmd-1",
      chat: "default",
      name: "rename",
      arg: "My own name",
    });
    await waitFor(() => chatNames(harness).at(-1) === "My own name");

    gate.resolve({ ok: true, value: { sessionId: "t", text: "Provider title" } });
    await settle();

    expect(chatNames(harness)).not.toContain("Provider title");
    const saved = harness.saves.at(-1)?.chats.find((chat) => chat.id === "default");
    expect(saved?.name).toBe("My own name");
    expect(saved?.titleSource).toBe("user");
  });

  it("a rename before the first ask keeps the name: no first words, no provider title run", async () => {
    const seen: RunInput[] = [];
    const harness = await connected(answering(titled("Provider title"), seen));

    harness.link.push({ t: "cmd", id: "cmd-1", chat: "default", name: "rename", arg: "Mine" });
    await waitFor(() => chatNames(harness).at(-1) === "Mine");
    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "a question", mentions: [] });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "reply"));
    await settle();

    expect(chatNames(harness).at(-1)).toBe("Mine");
    expect(seen.filter((input) => input.tools === "none")).toHaveLength(0);
  });

  it("a failed title run keeps the first-words title and logs once", async () => {
    const logs: string[] = [];
    const harness = await connected(
      answering(async () => ({ ok: false, error: "provider_failed" })),
      logs,
    );

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "gear for level twenty",
      mentions: [],
    });
    await waitFor(() => logs.some((line) => line.includes("chat title not generated")));
    await settle();

    expect(logs.filter((line) => line.includes("chat title not generated"))).toHaveLength(1);
    expect(chatNames(harness).at(-1)).toBe("gear for level twenty");
    expect(harness.link.sent().some((msg) => msg.t === "error")).toBe(false);
  });

  it("an empty provider title after sanitizing keeps the first-words title", async () => {
    const logs: string[] = [];
    const harness = await connected(answering(titled('""')), logs);

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "gear for level twenty",
      mentions: [],
    });
    await waitFor(() => logs.some((line) => line.includes("chat title not generated")));

    expect(chatNames(harness).at(-1)).toBe("gear for level twenty");
  });

  it("a chat deleted while its title run is in flight stays deleted", async () => {
    const gate = deferred();
    const harness = await connected(answering(() => gate.promise));

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "first question",
      mentions: [],
    });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "reply"));
    harness.link.push({ t: "cmd", id: "cmd-1", chat: "default", name: "new", arg: "Other" });
    await waitFor(() => harness.saves.at(-1)?.chats.length === 2);
    harness.link.push({ t: "cmd", id: "cmd-1", chat: "default", name: "delete" });
    await waitFor(() => harness.saves.at(-1)?.chats.length === 1);

    gate.resolve({ ok: true, value: { sessionId: "t", text: "Late title" } });
    await settle();

    expect(harness.saves.at(-1)?.chats.map((chat) => chat.name)).toEqual(["Other"]);
  });

  it("the title source persists in chats.json and /ai new <name> makes a user title", async () => {
    const harness = await connected(answering(titled("Provider title")));

    harness.link.push({ t: "cmd", id: "cmd-1", chat: "default", name: "new", arg: "Named" });
    harness.link.push({ t: "cmd", id: "cmd-1", chat: "default", name: "new" });
    await waitFor(() => harness.saves.at(-1)?.chats.length === 3);

    const sources = harness.saves.at(-1)?.chats.map((chat) => [chat.name, chat.titleSource]);
    expect(sources).toEqual([
      ["Default", "auto"],
      ["Named", "user"],
      ["Chat 3", "auto"],
    ]);
  });

  it("applying the title touches nothing else of a chat that is off screen: history, unread, lastAt, session, running", async () => {
    const gate = deferred();
    let clock = 1000;
    const harness = await connected(
      answering(() => gate.promise),
      [],
      {
        now: () => {
          clock += 10;
          return clock;
        },
      },
    );

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "first question",
      mentions: [],
    });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "reply"));
    harness.link.push({ t: "cmd", id: "cmd-1", chat: "default", name: "new", arg: "Other" });
    await waitFor(() => harness.saves.at(-1)?.chats.length === 2);
    const before = harness.saves.at(-1)?.chats.find((chat) => chat.id === "default");
    expect(before?.name).toBe("first question");

    gate.resolve({ ok: true, value: { sessionId: "title-session", text: "Provider title" } });
    await waitFor(() => chatNames(harness).at(-1) === "Provider title");

    const after = harness.saves.at(-1)?.chats.find((chat) => chat.id === "default");
    expect(after?.name).toBe("Provider title");
    expect(after?.history).toEqual(before?.history);
    expect(after?.unread).toBe(before?.unread);
    expect(after?.lastAt).toBe(before?.lastAt);
    expect(after?.sessionId).toBe(before?.sessionId);
    expect(after?.sessionId).not.toBe("title-session");
    expect(after?.runningAsk).toBeUndefined();
  });

  it("deleting the only chat mid-run: the re-seeded Default is not given the deleted chat's title", async () => {
    const gate = deferred();
    const harness = await connected(answering(() => gate.promise));

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "first question",
      mentions: [],
    });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "reply"));
    harness.link.push({ t: "cmd", id: "cmd-1", chat: "default", name: "delete" });
    await waitFor(() => harness.saves.at(-1)?.chats[0]?.history.length === 0);
    expect(harness.saves.at(-1)?.chats.map((chat) => chat.name)).toEqual(["Default"]);

    gate.resolve({ ok: true, value: { sessionId: "t", text: "Late title" } });
    await settle();

    expect(harness.saves.at(-1)?.chats.map((chat) => chat.name)).toEqual(["Default"]);
    expect(chatNames(harness)).not.toContain("Late title");
  });

  it("a /ai reset mid-run keeps the chat's name: the title belongs to the old conversation", async () => {
    const gate = deferred();
    const harness = await connected(answering(() => gate.promise));

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "first question",
      mentions: [],
    });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "reply"));
    harness.link.push({ t: "cmd", id: "cmd-1", chat: "default", name: "reset" });
    await waitFor(() => harness.saves.at(-1)?.chats[0]?.history.length === 0);

    gate.resolve({ ok: true, value: { sessionId: "t", text: "Late title" } });
    await settle();

    expect(chatNames(harness)).not.toContain("Late title");
  });

  it("the title prompt pairs the reply with the question it answered, not an earlier failed ask", async () => {
    const seen: RunInput[] = [];
    let first = true;
    const harness = await connected(async (input) => {
      seen.push(input);
      if (input.tools === "none") return { ok: true, value: { sessionId: "t", text: "A title" } };
      if (first) {
        first = false;
        return { ok: false, error: "provider_failed" };
      }
      return { ok: true, value: { sessionId: "s-1", text: "the real answer" } };
    });

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "failed one", mentions: [] });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "error"));
    harness.link.push({ t: "ask", id: "a2", chat: "default", text: "the real one", mentions: [] });
    await waitFor(() => chatNames(harness).at(-1) === "A title");

    const titleInput = seen.find((input) => input.tools === "none");
    expect(titleInput?.prompt).toContain("the real one");
    expect(titleInput?.prompt).not.toContain("failed one");
  });
});
