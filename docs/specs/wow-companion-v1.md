# wow-companion-v1

## Metadata

| Field | Value |
|---|---|
| Status | Draft |
| Area | whole repo (new) |
| Parts | `addon/WoWCompanion` (Lua), `apps/companion/` + `apps/mcp/` (Node LTS, TS), `packages/contracts/` (shared protocol types), `scripts/` |
| Client | WoW Forever `_classic_beta_`, build 1.60.1.70009, `## Interface: 16001` (confirmed in client 2026-09-26), exe `WowB.exe` |
| Repository | https://github.com/VirtuaChamp/wow-companion (public) |
| PR / Branch | — |

## Motivation
Ask an AI (Claude, Codex or Cursor, on the user's own CLI login) questions from inside WoW Forever — "I'm stuck on @quest", "is @item worth keeping", "how do I get better gear" — with the AI seeing character, position, quests, bags and gear, able to look up the Forever world database, and able to set a map waypoint.

## Decisions (ask-then-build pass, 2026-09-26)
| # | Decision |
|---|---|
| D1 | UI is a separate floating window "Claude", addon-owned and built from Blizzard templates (ButtonFrameTemplate; a chat sidebar on the left and a message list of chat bubbles on the right, the AI's on the left and the user's on the right; movable, resizable; not a chat frame, so it takes no chat-frame slot; user choice 2026-09-27; sidebar and bubbles: user choice 2026-09-29); `/ai <text>` typed in any chat box opens that window if hidden and the exchange happens there; the Claude window has its own input line (an addon-owned edit box) where typing talks to the companion; `/r` keeps its normal Blizzard meaning (routing it to the companion would taint Blizzard's whisper list; user choice 2026-09-27); replies show their full text in the bubble, and a right-click "Copy text" opens a copyable box (user choice 2026-09-29) |
| D2 | Written from scratch: no third-party code, identifiers or formats; client behaviour comes from the facts below and Blizzard's `forever` UI source |
| D3 | World knowledge: local SQLite built from QuestieDB `data/Forever/*` (never committed; no licence), web search as fallback |
| D4 | Map: built-in user waypoint + super-track in v1; own pin layer / routes / navigator in v2 |
| D5 | Companion in Node (Active LTS, D16) TypeScript strict; providers `claude` (Agent SDK), `codex` (`codex app-server`), `cursor` (`cursor-agent` headless) behind one interface; all share one stdio MCP server |
| D6 | Repo `C:\GITDev\wow-companion` |
| D7 | Item slot/stats/quality come from the game client (`C_Item`), fetched on demand over the transport; QuestieDB only proposes candidates |
| D8 | `@` mentions: quests in the log + items in bags/equipped, popup list plus inline ghost completion (Tab accepts) in the Claude window's own input line (Blizzard's chat edit boxes offer no untainted hook; user choice 2026-09-27); inline completion also for `/ai` sub-commands there; `/ai <text>` still works from any chat box |
| D9 | Settings (provider, model, effort, "this chat only") live in the native Blizzard Settings panel (Options > AddOns > WoW Companion), opened also by `/ai settings` and a gear button on the Claude window; lists come from the companion; effort greyed out for providers without it |
| D11 | Several chats, each its own provider session, running in parallel; one Claude window with a chat sidebar on its left: a "New chat" button, then every chat newest first (title, provider, last activity, running mark, unread count); clicking one shows its history and resumes that session; right-click on a chat opens Rename / Delete; chat titles are set automatically (the first words of the first question at once, then a 3-5 word title the chat's provider generates after the first reply) until the user renames the chat, which stops automatic titling for it (user choice 2026-09-29); a reply in a chat not shown prints a clickable notice; `/ai new <name>`, `/ai chat <name>` (autocompleted) do the same by typing; old conversations stay resumable |
| D12 | Repository `VirtuaChamp/wow-companion`, public: no secrets or personal values committed; `.example` files for anything configurable |
| D13 | Licence MIT, `Copyright (c) 2026 VirtuaChamp` |
| D15 | Branching (trunk; user choice 2026-09-26): one long-lived branch `master`, the GitHub default. `feature/*`, `fix/*` branch from `master` and return by PR, squash merge, conventional-commit PR title. Every merge produces a test build (zips as a CI run artifact). Versions are automatic: release-please keeps one release PR open on `master` computed from the PR titles (`feat` → minor, `fix` → patch, `!`/`BREAKING CHANGE` → major); merging it bumps `package.json` + the `.toc` `## Version`, writes `CHANGELOG.md`, tags `vX.Y.Z` and publishes the GitHub Release, which runs the release build. Nothing reaches `master` except through a PR with green CI, enforced by GitHub rulesets kept in `.github/rulesets/*.json` |
| D16 | Latest stable everything, looked up live at scaffold time, never from memory: Node = newest Active LTS (from `https://nodejs.org/dist/index.json`), every npm dependency at its current `latest` dist-tag (`npm view <pkg> version`), every GitHub Action at its newest major pinned to a full commit SHA with the version in a comment; the builder writes the resolved versions into `docs/versions.md`. Where `latest` is younger than the D18 `minimumReleaseAge`, the newest version at least 3 days old is taken instead, and `docs/versions.md` records both with the reason (user choice 2026-09-27). Exception: `@types/node` follows the runtime's major (the Active LTS), newest version in that major, forced workspace-wide by a pnpm override (user choice 2026-09-27) |
| D17 | Dependency updates by Dependabot: `npm` (root, pnpm workspaces and catalog) and `github-actions`, weekly, PRs into `master`, `cooldown` 7 days before proposing a new version (security updates skip it; verify the key at scaffold time), minor+patch grouped per ecosystem, majors as separate PRs, conventional-commit titles (`chore(deps)`) so release-please reads them. pnpm `minimumReleaseAge` (D18) is the second net |
| D18 | Engineering baseline: pnpm workspaces `apps/*` + `packages/*` with a pnpm catalog pinning every shared dependency once and `minimumReleaseAge` 3 days (new releases wait 3 days — supply-chain delay); protocol types of `## API / interface` live in `packages/contracts` (types + parsers, no I/O) and both apps import them; oxlint + oxfmt, knip (unused code/deps) in CI; tsconfig `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`; `AGENTS.md` is the single instruction file for AI contributors and `CLAUDE.md` contains only `@AGENTS.md`; squash merges with conventional PR titles. Not taken: review bots, PR-size/vouch labelers, multi-channel releases, custom lint plugin |
| D14 | AI tools are read-only: game tools (state, lookups, waypoint) and web lookups limited to wowhead.com, warcraft.wiki.gg and icy-veins.com (and their subdomains), enforced per domain for Claude; Codex, whose web tool cannot be limited by domain, has no web access (user choice 2026-09-29); no shell, no file writes, for every provider. Codex meets this with `--disable shell_tool` plus isolation (ignores the user's codex config, extra features disabled, empty workspace, read-only sandbox, only the wowc tools auto-approved) and ships enabled (user choice 2026-09-27, after the shell-off switch was verified). An edit tool a provider cannot remove (codex apply_patch) is acceptable only when the provider's read-only sandbox policy (codex: `-s read-only`, approval never) refuses it, proven by a recorded run in which a write attempt is refused and leaves the file unchanged (user choice 2026-09-27; an OS-level denial is not required). Cursor ships disabled (headless MCP not loaded, verified 2026-09-27) |
| D10 | Every UI/UX element matches the WoW Forever UI: Blizzard templates, fonts, colours, atlases and sounds only; no custom art, fonts or colour palettes |

## Scope
**In scope**: floating AI chat window; `@` mentions + completion; settings panel (provider/model/effort); state snapshot (character, zone/subzone/coords, quest log with objectives and completion, equipped slots 1-19 with ilvl, bags, money, professions, talents) sent as deltas; pixel-out / slot-in transport with readiness signal; item-detail lookup round trip; waypoint; companion daemon with provider switch per chat and in config; MCP server with tools below; QuestieDB → SQLite build script; setup script that installs the addon and generates the slot pool.
**Out of scope**: route/pin layer, navigator arrow, herb/ore nodes (v2); combat data of any kind; any input sent to the game; Linux/Wine; multi-user or hosted use.

## Data model
- `data/questie.sqlite` (gitignored), built by `scripts/build-db.ts` from a local QuestieDB checkout path given on the command line. Tables: `npc(id, name, sub_name, min_level, max_level, faction_id, friendly_to)`, `npc_spawn(npc_id, zone_id, ui_map_id, x, y)`, `quest(id, name, required_level, quest_level, zone_or_sort, objectives_text, next_in_chain)`, `quest_start(quest_id, kind, entity_id)`, `quest_end(quest_id, kind, entity_id)`, `object(id, name)`, `object_spawn(object_id, zone_id, ui_map_id, x, y)`, `item(id, name, item_level, required_level, class, sub_class)`, `item_source(item_id, kind{npc_drop,object_drop,quest_reward,vendor}, entity_id)`. `ui_map_id` resolved through `support/Forever/Zones/areaIdToUiMapId.lua`. Export runs the Lua tables under a Lua 5.1.5 from `.tools/lua51`, never by regex.
- `apps/companion/state/` (gitignored): `chats.json` (chat id → provider, session id, transcript), `settings.json` (the global choice and each chat's model/effort, so a settings change survives a companion restart; config.json gives the first values), `game.json` (last snapshot) — survives the beta's SavedVariables wipes.
- `config.json` (gitignored; `config.example.json` committed): `wowPath`, `provider` (`claude|codex|cursor`), `providers.<id>.{enabled, model, effort, models}` (provider binaries are found on PATH) (`models` only a fallback when the provider cannot list its own), `companionPort` (47831), `slotCount` (200), `timeoutMs` (600000).

## Client behaviour facts (Forever 1.60.1)
- Addon files are discovered at client launch only; a file created later is invisible until restart. `/reload` re-reads Lua of loaded addons; a LoadOnDemand addon's files are read when it is first loaded, once per UI session.
- SavedVariables are written only on `/reload` or logout; the beta client sometimes wipes them.
- `ReloadUI()` needs a hardware event (key or click), never a timer.
- Screen capture sees only 8 pure colours reliably (each RGB channel fully on or off); intermediate levels shift with gamma. Exclusive fullscreen blocks capture; windowed and borderless work.
- `PlaySoundFile(path)` answers whether the file exists, not whether it has content: an existing file returns `true, handle` even when empty, a missing one returns nothing. The client only sees files that existed when it launched: for those, deleting the file makes the next call return nothing and re-creating it makes it return `true` again, live, without `/reload`; a file first created after launch is never seen until the client restarts (in-client `/dump`, Forever 1.60.1, 2026-09-28). This is the one-bit readiness signal, by presence.
- Modern chat API lives in `ChatFrameUtil`; the old `ChatFrame_*`/`ChatEdit_*` names are deprecated aliases gated by the `loadDeprecationFallbacks` CVar.

## API / interface
No public API. Three internal contracts, written down so lanes build in parallel:

**Pixel frame (game → companion).** A thin line at the very top edge of the screen (user choice 2026-09-29, after research into how other open-source addons export data): cells of 1 physical pixel wide with a 1-pixel gap between cells, in at most 3 rows of 2 physical pixels each, starting at the top-left of UIParent; the frame is counter-scaled (`SetScale(1 / UIParent:GetEffectiveScale())`) and sizes cells and rows in multiples of Blizzard's pixel factor (`PixelUtil.GetPixelToUIUnitFactor()`, 768 / physical height) so a cell is exactly one physical pixel; both are re-applied on `UI_SCALE_CHANGED` and `DISPLAY_SIZE_CHANGED`; each cell one of 8 pure colours = 3 bits. The cell pitch is fixed at 2 physical pixels (1 px cell, 1 px gap; a row at that pitch already spans the screen width). Each row begins with a fixed anchor pattern the reader scans for to find the line's horizontal offset, and a capture whose frame passes the CRC is accepted as is; when no single capture decodes, the reader takes the value seen most often per data cell across its samples (PM decision 2026-09-29). `ask` and `cmd` messages carry an `id` the addon mints, and the companion handles each id once, so a message re-sent under a new `seq` (after a resolution change) never runs twice. The handled ids are kept on disk (the last 500) and recorded only after the ask or command has taken effect and its state is saved: game-to-companion delivery is at-least-once, never lossy; a companion crash between the effect and the record can at worst repeat that one ask or command (PM decision 2026-09-29). The line is painted only while there is something to send: each frame is held at least 200 ms (and repainted until acked for acked types), then the line is cleared; when nothing is queued it is hidden. While the companion is not running (its control file still present), the addon paints nothing, not even `hello`; once it runs, an unacked `hello` repaints continuously, and after 20 s without an ack only at each 10 s tick (PM decision 2026-09-29). If the companion is running (its control file is gone) but the addon's `hello` is not acked within 20 s, the addon prints a short warning (at most two lines) naming the video settings that break reading and that the line can be moved to the bottom edge (anti-aliasing, render scale other than 100%, screen filters or overlays such as Discord, GeForce or Steam, f.lux), once per load; the companion logs undecodable frames to its console (a notice cannot reach the game before a `hello` decodes). Frame bytes: `magic 0x57 0x43 | version u8 | seq u16 | total u8 | index u8 | length u16 | payload | crc16-CCITT u16` (big-endian). A message longer than one frame is split (`total`/`index`). Payload is UTF-8 JSON.

**Reply slot (companion → game).** 200 LoadOnDemand addons `WoWCompanion_Rnnn` generated at setup, each with one file `r.lua` whose only statement is `WoWCompanion_Deliver(<lua table literal>)`. Each slot call is `WoWCompanion_Deliver(<session>, <lua table literal>)`: `session` is the token the addon generated at load and sent in `hello`, and the addon ignores a delivery whose token is not its current one, so a slot left over from before a `/reload` is never applied (PM decision 2026-09-27). The addon paints `hello` at load and repaints it, carrying its current next-slot index in `slot`, until the companion acks it; on every decoded `hello` the companion moves its slot allocator to `slot` and empties the signals from there on, and it writes no slot before the first `hello` (outgoing messages wait). Because the addon keeps reporting its real position, both sides converge after a `/reload` even if stale slots were passed (PM decision 2026-09-27). After the ack the addon still re-announces `hello` every `helloIntervalSec` (10 s, a named constant) with `again: true`, painted once and never acked (so an idle game uses no slot): the companion re-syncs (allocator to `slot`, signals emptied from there) on a `hello` whose `session` differs from a session it holds or whose `slot` is ahead of its allocator; a companion that holds no session (its own start or restart while the game keeps running) adopts the `hello`'s session, empties no signal, and sets its allocator to the first slot at or after `slot` whose signal is not ready, so replies an earlier companion process wrote and the addon has not read yet are still delivered in order and nothing is written behind the addon (the slot files are the durable record; PM decision 2026-09-28); a re-sync whose signal reset fails in any slot is aborted and retried, and releases nothing until every required signal is empty; and otherwise writes nothing for it (a `slot` behind the allocator only means slots are written but not yet read); a `hello` without `again` is acked; the ack of a re-sync goes alone into the re-sync slot, and the rest is flushed only after a later frame from that session shows the ack was read. Delivery is at-least-once: on a new session the companion re-queues every message it wrote that no decoded `hello` has yet shown as read (slots below the reporting `hello.slot` count as read only for the session that reported it), and the addon ignores a `reply` whose `id` it has already shown (every other companion message replaces state, so a repeat is harmless) (PM decision 2026-09-28), so a companion restarted while the game keeps running learns the addon's position within one interval (PM decision 2026-09-27). Readiness by presence (in-client, 2026-09-28): setup creates all `sig/nnn.wav` files before the client starts; a present file = not ready, an absent one = ready. The companion deletes `sig/nnn.wav` after writing slot nnn's `r.lua`, and re-creates it to empty a signal (a re-sync, or before reusing a slot); it never creates a signal path that setup did not create. A companion without a session takes the first slot at or after `hello.slot` whose signal file is present as its allocator position; Pool exhausted → the addon asks the user to `/reload` (hardware event required).

**Messages** (JSON in frames; Lua tables in slots):
```ts
type GameToCompanion =
  | { t: "hello"; v: 1; build: string; iface: number; session: string; slot: number; again?: true }
  | { t: "state"; seq: number; delta: Partial<Snapshot> }
  | { t: "ask"; id: string; chat: string; text: string; mentions: Mention[] }
  | { t: "items"; req: string; items: ItemDetail[] }
  | { t: "cmd"; id: string; chat: string; name: "new" | "open" | "rename" | "delete" | "reset" | "cancel"; arg?: string }
  | { t: "settings"; chat?: string; provider: ProviderId; model: string; effort?: Effort };
type CompanionToGame =
  | { t: "chats"; active: string; list: { id: string; name: string; provider: ProviderId; lastAt: number; running: boolean; unread: number }[] }
  | { t: "history"; chat: string; lines: { who: "you" | ProviderId; text: string; at: number }[] }
  | { t: "options"; providers: { id: ProviderId; installed: boolean; enabled: boolean; reason?: string;
      models: string[]; efforts: Effort[]; current: { model: string; effort?: Effort } }[]; active: Choice; chat?: { id: string } & Choice; companionVersion?: string }
  | { t: "progress"; id: string; status: "queued" | "thinking" | "tool"; detail?: string }
  | { t: "reply"; id: string; chat: string; provider: ProviderId; summary: string; full: string; waypoint?: Waypoint }
  | { t: "itemreq"; req: string; ids: number[] }
  | { t: "ack"; seq: number }
  | { t: "error"; id?: string; code: ErrorCode; message: string };
type Choice = { provider: ProviderId; model: string; effort?: Effort };
// every `at` and `lastAt` on the wire is whole seconds since the Unix epoch (PM decision 2026-09-28)
type Mention = { kind: "quest"; questId: number } | { kind: "item"; itemId: number; bag?: number; slot?: number; equipSlot?: number };
type Waypoint = { uiMapId: number; x: number; y: number; label: string };
type Snapshot = {
  character: { name: string; level: number; classId: number; raceId: number; faction: "Alliance" | "Horde"; xp: number; xpMax: number };
  position: { uiMapId: number; zone: string; subzone: string; x: number; y: number };
  money: number;
  quests: { questId: number; title: string; level: number; complete: boolean;
    objectives: { text: string; done: boolean; have: number; need: number }[] }[];
  equipped: { slot: number; itemId: number; itemLevel: number }[];
  bags: { bag: number; slot: number; itemId: number; count: number }[];
  professions: { name: string; rank: number; max: number }[];
  talents: { tab: string; points: number }[];
};
type ItemDetail = { itemId: number; name: string; quality: number; itemLevel: number; requiredLevel: number;
  equipLoc: string; classId: number; subClassId: number; stats: Record<string, number> };
type Upgrade = { slot: number; current?: ItemDetail; candidate: ItemDetail;
  source: { kind: "npc_drop" | "object_drop" | "quest_reward" | "vendor"; entityId: number }; delta: Record<string, number> };
type McpLaunch = { command: string; args: string[]; env: Record<string, string> };
```
`state.delta: Partial<Snapshot>` is shallow: a key present replaces that whole field; no deep merge. A state still queued in the addon when a newer one is sent is merged into it (newer keys win, keys only the older one carries are kept), never discarded; if the merged payload is too large both stay queued. The addon sends a full snapshot after every hello ack and every 60 s; a companion that adopted a session on its own restart treats state as not live (GET /state answers not_connected) until the next full snapshot (PM decision 2026-09-28). `character.name` is transport-only: never logged, never in `/ai report` (AC 20). `equipLoc` and `stats` are what the client's `C_Item` call returns, named in `docs/client-facts.md` (AC 6).

**GameLink (companion transport port).** The companion core reaches the game only through this interface, implemented by slice 13 (game-link), typed in `packages/contracts` by slice 03:
```ts
interface GameLink {
  messages(): AsyncIterable<GameToCompanion>;
  send(msg: CompanionToGame): Result<void, LinkError>;
  status(): { connected: boolean; build?: string; slotsLeft: number; badFrames: number };
}
```
Behind it: capture loop, cell decode, CRC, multi-frame reassembly, `seq` de-duplication, `bad_frame` counting, `hello` handshake with slot-position sync, slot allocation, Lua literal writing, signal-file flips, batching. Adapters: `createScreenLink(config)` (production) and `createMemoryLink()` (tests; `push(GameToCompanion)` and `sent(): CompanionToGame[]` live on the adapter only, not on the interface). Internal seam, not on the interface: a frame source (production = screen grab, tests = cell-grid file written by the Lua encoder).
Guarantees: `send` batches every message queued since the last delivered slot into one slot (one slot = one `WoWCompanion_Deliver({msg, msg, …})` call); a `progress` superseded by a later one for the same `id` is dropped from the batch, never delivered stale. Game → companion: each frame stays on screen until a delivered slot carries `{t:"ack", seq}` or for `holdMs` (config; value written into `docs/client-facts.md` after the in-client measurement), whichever comes first; `ask`, `items` and `cmd` are re-painted until acked, `state` is not (the next delta supersedes it). `status().slotsLeft` is exposed and the addon warns at 20 left, before exhaustion forces a `/reload`.

**Local API (MCP server → companion daemon)**, HTTP on `127.0.0.1:{companionPort}` only: `GET /state`, `POST /items {ids}` (→ game round trip, 10 s timeout), `POST /waypoint {Waypoint}` (attached to the reply of the ask named by the run id). Each `Provider.run` launches the MCP server with `env.WOWC_RUN = <ask id>` through `McpLaunch.env` (env support in each provider's MCP server config verified into `docs/client-facts.md`); the MCP server sends it as header `X-Wowc-Run` on every local API call. `POST /waypoint` with no running ask for that id → `409`, the tool returns `no_active_ask`. MCP tools: `get_game_state`, `find_npc(name|id)`, `find_quest(name|id)`, `find_object(name)`, `suggest_gear_upgrades(slot?)`, `set_waypoint(uiMapId,x,y,label)`.

## Code shape
```ts
type ProviderId = "claude" | "codex" | "cursor";
type Effort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
type ProviderError = "provider_missing" | "provider_auth" | "provider_disabled" | "provider_failed" | "session_unknown" | "timeout" | "cancelled";
type LinkError = "too_large" | "slots_exhausted";
type ToolError = "not_connected" | "item_timeout" | "no_active_ask" | "no_waypoint_map" | "too_large" | "forbidden" | "unsupported_media_type" | "bad_request" | "daemon_error"; // local API: 403 forbidden (Host not loopback or an Origin header), 415 unsupported_media_type, 400/404/405 bad_request, 413 too_large, 500 daemon_error (PM decision 2026-09-28)
type ErrorCode = ProviderError | LinkError | ToolError | "busy" | "bad_frame" | "bad_settings";
type ProviderConfig = { cwd: string; mcp: (runId: string) => McpLaunch; timeoutMs: number; models: readonly string[] };
interface Provider {
  id: ProviderId;
  describe(): Promise<{ installed: boolean; enabled: boolean; reason?: string; models: string[]; efforts: Effort[] }>;
  run(input: { runId: string; prompt: string; system: string; sessionId?: string; model: string; effort?: Effort; signal: AbortSignal },
      onEvent: (e: ProviderEvent) => void): Promise<Result<{ sessionId: string; text: string }, ProviderError>>;
}
type CreateProvider = (config: ProviderConfig) => Provider;
type ProviderEvent = { kind: "text"; delta: string } | { kind: "tool"; name: string; failure?: string } | { kind: "session"; id: string };
```
`ProviderConfig.models` is `config.json` `providers.<id>.models` (possibly empty), the fallback when the provider cannot list its own; an adapter never hardcodes a model list (PM decision 2026-09-27). `ErrorCode` is the wire union inside `{t:"error"}`; each module returns only its own slice. `cwd`, the MCP launch and the read-only tool policy are fixed at construction; only the run id varies per call.
Paths:
```
ask:  AiWindow /ai → Mention.resolve(text) : Mention[] → Transport.send({t:"ask"}) : Result<seq, "busy">
      → GameLink.messages() : GameToCompanion → Chats.enqueue(ask) : Result<void,"busy">
      → Prompt.build(snapshot, mentions) : string → Provider.run({runId: ask.id, …}) : Result<{sessionId,text}, ProviderError>
        → [MCP tool, X-Wowc-Run] → LocalApi → Game/Db : Result<T, ToolError>
      → GameLink.send({t:"reply"}) : Result<void, LinkError> → WoWCompanion_Deliver → AiWindow.print (Waypoint.set only on the player's click)
gear: suggest_gear_upgrades → Db.candidates(level, zone, class) : ItemId[] → POST /items → {t:"itemreq"}
      → game C_Item lookup → {t:"items"} → compare(equipped, candidates) : Upgrade[]
```
- Providers run with the chat's cwd = `apps/companion/workspace/` and **read-only tools**: claude `allowedTools: ["mcp__wowc__*","WebSearch","WebFetch"]`, no Bash/Edit/Write; codex `sandboxMode: "read-only"`; cursor without `--force`. Spawned through `cross-spawn`.
- Lua: no globals except `WoWCompanion_Deliver`, `WoWCompanionDB` (SavedVariables), slash commands, and frames named with the `WoWCompanion` prefix (any of the addon's own frames; the ones Esc closes join `UISpecialFrames`; PM decisions 2026-09-27 and 2026-09-29); chat via `ChatFrameUtil.*` and `chatFrame:AddMessage`, never `ChatFrame_*`/`ChatEdit_*`; no `hooksecurefunc` and no Blizzard StaticPopup (guard rule; taint log 2026-09-29); `[open]` and other addon links via the Blizzard-registered `addon` link type through `EventRegistry` `SetItemRef`.

## Tests first
- `codec.roundtrip` — Lua encoder (under Lua 5.1.5) → rendered cell grid → TS decoder yields identical bytes for 0, 1, 500, 5000-byte payloads, multi-frame — AC 3
- `codec.rejects` — flipped bit, wrong magic, truncated, wrong crc, an index at or above `total`, the same `seq` with a different `total` → `bad_frame`, never a partial message; frames may arrive in any order and repeated captures of a frame or of a completed message are ignored (PM decision 2026-09-27, slice 06) — AC 4
- `slots.write` — writes a valid Lua literal escaping `]]`, `\`, quotes, newlines; round-trips through Lua 5.1.5 `loadstring` — AC 5
- `slots.exhausted` — 201st delivery → `slots_exhausted` — AC 5
- `link.batch` — through `GameLink`: messages sent while a slot is pending land in one slot; a superseded `progress` for the same `id` is dropped — AC 5
- `link.ack` — through `GameLink` with a grid frame source: an `ask` frame is re-read until acked, a `state` frame is not; a duplicate `seq` is delivered once — AC 4
- `provider.<id>.stream` — recorded stream fixture per provider → text deltas, tool events, session id; missing binary → `provider_missing`; auth error text → `provider_auth` — AC 7
- `provider.<id>.cancel` — aborting `signal` → `cancelled`, child process gone — AC 7
- `provider.<id>.session_unknown` — recorded "no such session" output → `session_unknown` — AC 7, 22
- `api.waypoint_run` — two running asks; `POST /waypoint` with each run id lands in that ask's `reply`; unknown run id → `no_active_ask` — AC 9
- `provider.<id>.describe` — installed/missing/disabled detection, model list from the provider (Agent SDK model listing, codex `app-server` model list, cursor model listing — each verified, else `config.models`), efforts per provider (cursor → `[]`) — AC 17
- `settings.apply` — `{t:"settings"}` global vs chat-only; next run receives that model/effort; unknown model or unsupported effort → `error`, previous settings kept — AC 17
- `chats.lifecycle` — new/open/rename/delete update `chats.json` and emit `chats`; `open` emits `history` (last 200 lines) and the next ask resumes the stored provider session id; a session the provider no longer knows starts fresh with a transcript summary in the prompt and a notice line — AC 22
- `chats.busy` — second ask on a running chat → `busy`; other chat runs in parallel — AC 8
- `mcp.<tool>` — each tool against `fixtures/mini.sqlite` and a stub local API — AC 9
- `mcp.not_connected` — tools needing the game return `not_connected` when the daemon has no hello — AC 9
- `gear.compare` — equipped vs candidate details, wrong armour class for the class excluded, slot match — AC 10
- `mention.match` (Lua 5.1.5) — prefix and infix match on quest/item names, max 8, ghost text = top match; no match → no popup — AC 11
- `sanitize.chat` — reply containing `|c`, `|H`, `|T`, `|K` escape sequences prints literally — AC 12
- `builddb.smoke` — build from a 3-row fixture of each Questie table → expected rows, `ui_map_id` resolved — AC 13

## UX / flow
- Window: an addon-owned frame created once on first load, titled "Claude" (ButtonFrameTemplate without portrait, about 680 px wide by default), position and size kept in `WoWCompanionDB`; left: the chat sidebar (about 140 px, inside a Blizzard inset); right: the message list and, below it, the input line. The message list is a Blizzard ScrollBox list of bubbles built on TooltipBackdropTemplate (cite the forever templates): the AI's bubbles on the left with a darker tint and the provider name in small grey text under them, the user's on the right with a lighter tint, each at most about 75% of the list width with wrapped text; a reply always shows its full text in its bubble (no summary, no `[more]`; user choice 2026-09-29); right-click on any bubble offers "Copy text", which opens the copyable box with that message as plain text, and hovering a bubble shows "Right-click: copy text"; waypoint lines stay clickable. Status is a small grey line, not a bubble: `thinking…`, or a plain phrase per tool (for example `looking up an NPC…` for find_npc), falling back to `using <tool>…` for a tool without a phrase. An empty chat shows one grey hint line instead of a blank list. Reply text is rendered from light markdown after sanitizing: `**bold**` and `#` headings in Blizzard gold (NORMAL_FONT_COLOR), `` `code` `` in grey, `- ` items as `• `, numbered items kept, any leftover markdown markers removed; the companion's system prompt asks for short plain text. Text size is a setting (Small, Normal, Large, Larger, each a Blizzard font object; default one step above the original size) in the settings panel, saved in `WoWCompanionDB` and applied at once to bubbles, sidebar rows and the input line (user choice 2026-09-29). A minimap button (Blizzard minimap-button border art and a Blizzard icon, cited) toggles the Claude window on left-click and opens the settings on right-click, shows a tooltip, can be dragged around the minimap edge (angle saved in `WoWCompanionDB`), and can be hidden with a "Show minimap button" setting; if the client has Blizzard's addon compartment, the addon also registers there (user choice 2026-09-29). Enabling hyperlinks on the addon's own frames is allowed: the Must-not-change ban on protected functions covers sending chat, addon messages and macros, not the addon's own display frames (PM decision 2026-09-29). The list follows new messages and scrolls back through the chat's history with the mouse wheel. `/ai <text>` from any edit box shows the window if hidden, adds the question as the user's bubble, and the reply lands there (user choice 2026-09-29).
- Chats (D11): the sidebar lists a "New chat" button, then one two-line row per chat newest first (title; provider · relative time, a running mark, an unread count), the shown chat highlighted; the list scrolls when long; hovering a row shows a native tooltip with the full title, provider · age and a right-click hint. Left-click shows the chat at once from the addon's in-memory copy of that chat (kept from history, replies and asks, including replies in chats not shown) and sends `open`; the `history` that answers replaces the copy and re-renders only if it differs; a chat with no copy yet shows a grey "loading…" line until its history arrives (user request 2026-09-29); right-click opens a native context menu with Rename / Delete, confirmed in the addon's own dialog built from Blizzard templates (never Blizzard's shared StaticPopup, which taints the secure Esc path; taint log 2026-09-29): Rename has a name field (Enter confirms), Delete has no field and needs a click on Delete; Esc cancels both. Titles: the companion sets a chat's title from the first words of its first question at once, then asks that chat's provider once, after the first reply, for a 3-5 word title with no tools; a user rename wins and stops automatic titling for that chat (persisted in `chats.json`; a chat saved before titles existed counts as named by the user unless its name is "Default" or "Chat N") (user choice 2026-09-29). Reply for a chat not shown → `[Claude · <chat>] replied — [open]`.
- Input: `/ai <text>` from any editbox; the Claude window's own input line sends straight to the companion; `/r` is never redirected (user choice 2026-09-27).
- `@`: after `@` + 2 chars in the Claude window's input line, popup above that line, max 8 rows (quest icon / item quality colour), Up/Down move, Tab or Enter accepts, Esc closes; inline grey ghost of the top match, Tab accepts; accepted token shows as `@[Name]`. Sub-commands of `/ai` (`new`, `chat`, `settings`, `report`, `reset`, `cancel`, `help`, `context`) get the same ghost completion.
- Settings: `Settings.RegisterVerticalLayoutCategory("WoW Companion")` (verify the exact Settings API names on the `forever` branch into `docs/client-facts.md`); Provider dropdown (uninstalled/disabled providers shown disabled with `reason` as tooltip), Model dropdown filled from that provider's `models`, Effort dropdown from `efforts` (disabled when empty), checkbox "This chat only". `options` carries the global choice (`active`) and the active chat's own choice when it has one (`chat`); the companion sends `options` on every `hello`, after every `settings` message (applied or refused) and whenever the active chat changes. The checkbox sends nothing: it selects which choice the dropdowns show (`chat` when checked, falling back to `active`; `active` when unchecked) and where the next dropdown change goes. A dropdown change sends `{t:"settings"}` and is pending until the next `options`; the panel always shows the last `options`, never an unconfirmed value. When that `options` confirms the change, the Claude window prints `[Claude] now using <provider> · <model> · <effort>`; an `error` with code `bad_settings` (the only code a refused `settings` message gets; errors of asks carry their `id` and never touch a pending change) is printed there instead; the pending change is confirmed on provider and model, and on effort only when the change set one. The panel only sends a model its provider lists: picking a provider sends that provider's `current.model` when listed, otherwise its first listed model; a provider with no listed model cannot be picked (both through `ns.AiWindow.notice(text)`, owned by slice 09). Before the first `options` message the panel shows "Companion offline" and disables the dropdowns.
- Look and feel (D10): popup = Blizzard tooltip/autocomplete backdrop and `GameFontHighlightSmall`; copy box = Blizzard dialog template with a scrollable read-only editbox; gear button = Blizzard atlas icon; quality colours from `ITEM_QUALITY_COLORS`; sounds from `SOUNDKIT`. The builder lists every template/atlas used in `docs/client-facts.md` with its `forever` source path.
- Waypoint arrives with a reply: a grey line `waypoint: <label> (x, y) [Set waypoint]`; clicking `[Set waypoint]` sets and super-tracks it (never set without the player's click; ADR 0001, PM decision 2026-09-29).
- Disconnected: status line `companion offline` and the ask stays queued client-side until hello.

## Architecture
`addon/` (game, sandboxed) ⇄ pixels/slots ⇄ `apps/companion/` daemon (capture, transport, chats, prompt, providers, local API) ← HTTP ← `apps/mcp/` (stdio server spawned by the provider, queries `data/questie.sqlite` and the daemon). Dependency direction: `apps/companion` and `apps/mcp` → `packages/contracts`; `mcp` reaches the daemon only over the local API; the daemon never imports `mcp`; `packages/contracts` imports nothing from `apps/`. Inside each app: pure core (`src/core/`, no I/O, Result-returning) and adapters at the edge (`src/adapters/` — capture, filesystem, providers, HTTP, SQLite). `scripts/setup.ts` copies/junctions the addon into `{wowPath}\Interface\AddOns\`, generates the slot pool and signal files.

## Risk and rollback
- Screen capture fails (exclusive fullscreen, scaling) → `bad_frame` counts in the daemon log; `/ai context` still prints what would be sent. Rollback = uninstall addon folder + slot addons; nothing else on the machine changes.
- Cursor headless may block on MCP approval or lack login reuse → adapter ships `enabled:false` with the verified reason in `docs/client-facts.md`.
- Beta wipes SavedVariables → transcripts re-sent from `apps/companion/state/chats.json` on hello.

## The point everything turns on
The transport: game → pixels → capture and companion → slot addons → game, without `/reload` per message. Check against: (1) the codec round-trip test driven by the real Lua encoder, not a TS re-implementation; (2) `sig/*.wav` readiness semantics on this client (reported behaviour of this client, not verifiable from Blizzard's Lua source; confirm in the client); (3) the DPI scale and cell size surviving the capture of a borderless window at the user's resolution.

## Must not change
- No third-party source copied into the repo; the gate checks this against a prior-art identifier list kept outside the repo.
- `data/`, `apps/companion/state/`, `config.json` never tracked (`.gitignore`).
- Terms of service (ADR 0001): no game action the addon performs without the player's own click; no code sends input to the game or reads its memory: zero hits of `SendInput`, `keybd_event`, `PostMessage`, `SendKeys`, `ReadProcessMemory`, `robotjs`, `nut-js` in `apps/companion/` and `apps/mcp/`.
- No addon call to `SendChatMessage`, `C_ChatInfo.SendAddonMessage`, `RunMacroText`, protected or `HasRestrictions` functions.
- No deprecated chat globals: zero hits of `ChatFrame_AddMessageEventFilter`, `ChatEdit_`, `ChatFrame_ReplyTell` in `addon/`.
- Local API binds `127.0.0.1` only.
- Public repo (D12): no secret, token, API key, account id, character/realm name or absolute user path in any tracked file; real values only in gitignored `config.json` / `.env`, with committed `config.example.json` / `.env.example` holding placeholders; `pnpm run guard` refuses tracked files matching `WTF[\\/]Account[\\/]\d`, `C:\\Users\\`, `sk-`, `ghp_`, `CLAUDE_CODE_OAUTH_TOKEN=.`, `ANTHROPIC_API_KEY=.`.
- No custom art or fonts: zero `.tga`, `.blp`, `.ttf`, `.otf` files under `addon/`; no hard-coded `SetTextColor`/`SetVertexColor` RGB literals in `addon/` except through Blizzard colour constants.

## Must refuse
- Corrupt/partial frame → dropped, counted, never delivered (AC 4).
- Payload over 16 KB from game or reply over 64 KB → `error` with code `too_large`, not truncated silently (AC 4, 5).
- Ask while the chat is running → `busy` line in the Claude window (AC 8).
- Unknown/disabled/missing provider → `provider_disabled` / `provider_missing` line naming the fix (AC 7).
- `@` with no match → no popup, text stays literal (AC 11).
- Reply text with WoW escape sequences → printed literally (AC 12).
- Waypoint on a map where `C_Map.CanSetUserWaypointOnMap` is false or coords outside 0-100 → `no_waypoint_map` line, no waypoint (AC 14).
- MCP tool with no game connected → `not_connected` (AC 9).
- Settings naming a model the provider does not list, an effort it does not support, or a disabled provider → `error`, previous settings kept (AC 17).
- Item lookup with no answer in 10 s → `item_timeout`, gear answer says details are missing (AC 10).

- Issue form submitted without the required fields (client build, addon version, companion version, provider, steps) → GitHub refuses it (`required: true`) (AC 19).

## Proof of done
Lua runs under real **Lua 5.1.5** (the client's dialect), never a 5.2+ VM: locally `pnpm run lua:setup` downloads LuaBinaries 5.1.5 into `.tools/lua51/` (gitignored); in CI `leafo/gh-actions-lua` with `luaVersion: "5.1.5"`. Tests load `tests/lua/bit_shim.lua`, a pure-Lua `bit` table with the client's `bit.band/bor/bxor/lshift/rshift` semantics. Cross-language tests exchange files: the Lua encoder writes a cell grid, the TS decoder reads it.
```
pnpm install --frozen-lockfile && ppnpm run lint && ppnpm run knip && ppnpm run typecheck && pnpm test && ppnpm run lua:test && ppnpm run lua:lint && ppnpm run guard
```
`typecheck` = `tsc -b`; `test` = vitest; `lua:test` = every `tests/lua/*_test.lua` under Lua 5.1.5; `lua:lint` = luacheck `--std lua51` with a WoW globals file, plus a ban on 5.2+ syntax in `addon/` (`//`, `&`, `|` and `~` as binary operators, `<<`, `>>`, `goto`, `::`); `guard` = `scripts/guard.ts`, the `## Must not change` greps. The prior-art identifier check is kept out of the repo: the gate runs it from `~/.claude/projects/D--Battle-net-World-of-Warcraft/wow-companion-prior-art.txt`, CI from the masked Actions secret `PRIOR_ART_PATTERNS`, set by the user in the GitHub repo settings. This repo has no entry in `rules/verification-gates.md`: this block is its proof-of-done, and it has no sensitive-surface manifest.

## Acceptance Criteria
1. `[file]` `pnpm run typecheck` exits 0; zero `any`, zero `@ts-ignore` in `apps/companion/`, `apps/mcp/`, `scripts/`. Fixture: none
2. `[file]` `pnpm test` and `pnpm run lua:test` exit 0, and every test in `## Tests first` exists by name. Fixture: `.tools/lua51` via `pnpm run lua:setup`
3. `[file]` `codec.roundtrip` passes with the Lua encoder executed under Lua 5.1.5 + `bit_shim.lua`. Fixture: as AC 2
4. `[file]` `codec.rejects` passes; oversize game payload yields an `error` code. Fixture: none
5. `[file]` `slots.write` and `slots.exhausted` pass; a reply over 64 KB yields `error`. Fixture: none
6. `[file]` `docs/client-facts.md` records, each with a source (wow-ui-source `forever` path:line, an in-client `/dump`, or "unverified — confirm in client"): interface 16001 (in-client, 2026-09-26), `WowB.exe`, AddOns path, waypoint and super-track unrestricted, `ChatFrameUtil` names, the `C_Item` stat call, the Settings API names, how the floating Claude window is built from Blizzard templates, every template/atlas used, the `PlaySoundFile` readiness behaviour ("unverified — confirm in client"), and the Claude window's own input line (edit-box template and key handling). No `SetScript` or hook on any Blizzard edit box; `/r` is never redirected (user choice 2026-09-27, after the builder found no untainted hook). Fixture: wow-ui-source `forever` clone
7. `[file]` `provider.<id>.stream` passes for claude, codex, cursor; `docs/client-facts.md` states whether cursor headless MCP works, and the adapter's `enabled` default matches. Fixture: recorded streams under `apps/companion/test/fixtures/`
8. `[file]` `chats.busy` passes. Fixture: none
9. `[file]` every `mcp.<tool>` test and `mcp.not_connected` pass. Fixture: `apps/mcp/test/fixtures/mini.sqlite`
10. `[file]` `gear.compare` passes, including the item-timeout path. Fixture: none
11. `[file]` `mention.match` passes under Lua 5.1.5. Fixture: as AC 2
12. `[file]` `sanitize.chat` passes. Fixture: none
13. `[file]` `builddb.smoke` passes; `.gitignore` covers `data/`, `apps/companion/state/`, `config.json`, `.env`, `.tools/`, `.claude/output/`; `.env.example` and `config.example.json` exist with placeholders only. Fixture: none
14. `[file]` `waypoint.guard` (Lua) passes: `CanSetUserWaypointOnMap` false or coords outside 0-100 → no `SetUserWaypoint` call. Fixture: stubbed `C_Map`/`C_SuperTrack`
15. `[file]` `pnpm run guard` and `pnpm run lua:lint` exit 0. Fixture: none
16. `[file]` Pre-push twins of the in-game checks, Lua tests on stubbed Blizzard globals (`tests/lua/wow_stubs.lua`): `aiwindow.create` (one floating window "Claude", position persisted, not recreated on reload), `ai.route` (`/ai <text>` typed in any chat box shows the AI window if hidden, echoes the question there, reply lands there), `input.route` (text typed in the Claude window's input line goes to the companion; `/r` is never redirected), `copy.box` (every bubble shows the full message; right-click Copy text opens the copy box with that message as plain text), `context.snapshot` (equipped slots 1-19 and bag items present), `settings.panel` (category registered; dropdowns disabled before `options`, filled after). Fixture: `tests/lua/wow_stubs.lua`
17. `[file]` `provider.<id>.describe` and `settings.apply` pass. Fixture: none
18. `[file]` `.github/workflows/ci.yml` runs the proof-of-done on push and pull_request (ubuntu, Node Active LTS, Lua 5.1.5 — pinned to the client dialect, the one exception to D16) plus `gitleaks` over the full history, plus the prior-art check reading the masked Actions secret `PRIOR_ART_PATTERNS` without echoing it (fails closed when unset, so fork PRs wait for a maintainer run); on push to `master` CI also uploads both zips as a run artifact named `test-build-<short sha>` (the test build of D15); `.github/workflows/release.yml` on `release: published` builds `WoWCompanion-<version>.zip` (addon folder only, no slot pool) and `wow-companion-<version>.zip` (companion + mcp + scripts, no `data/`) and attaches both to a GitHub Release; `actionlint` exits 0 on both. Fixture: none
19. `[file]` `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml` are issue forms; the bug form requires client build, addon version, companion version, provider/model/effort, steps, expected/actual, and has a textarea for `/ai report` output; `config.yml` sets `blank_issues_enabled: false`; `CONTRIBUTING.md` and `SECURITY.md` say where to report what. Fixture: none
20. `[file]` `/ai report` (Lua test `report.box`) opens a copyable box holding the repo's new-issue URL plus client build, addon version, companion version and provider/model/effort, with no character name, realm or account path. Fixture: as AC 16
21. `[post-deploy]` In the client, the user runs the list in `HANDOFF-INTENT.md`: the "Claude" window appears as its own movable window; `/ai hello` from the General box opens it and the answer lands there; typing in the Claude window reaches the companion and `/r` still answers real whispers; full replies in bubbles and right-click Copy text; `@Lo` popup + Tab; `/ai context` shows gear and bags; "where is <NPC>" sets a super-tracked waypoint on map and minimap; Options > AddOns > WoW Companion, `/ai settings` and the gear button open settings; switching to Codex labels the next reply `[Codex]`; every new frame beside a stock Blizzard frame looks native. Pre-push twins: AC 3, 11, 14, 16, 17, 20. Fixture: user logged into Forever, companion running
22. `[file]` `chats.lifecycle` passes; Lua tests `chats.sidebar` (on `chats`: rows built newest first with title, provider, age, running mark and unread count; left-click sends `open`; right-click offers Rename / Delete; off-screen reply prints the notice) and `messages.bubbles` (on `history` and `reply`: the AI's bubbles on the left, the user's on the right, status lines not bubbles, full reply text, right-click Copy text); `chats.title` passes (first words at once, provider title after the first reply, a user rename stops it). Fixture: as AC 16
23. `[file]` `.github/rulesets/master.json` and `release-tags.json` are GitHub ruleset exports: `master` requires a pull request (0 required approvals, since a solo maintainer cannot approve their own PR; conversation resolution required), requires status check `ci` in strict mode (branch up to date), blocks force push and deletion, allows squash merges only, requires linear history; `release-tags.json` restricts creating, updating and deleting `v*` tags to the release-please workflow (GitHub Actions bypass actor); the repository-admin bypass is added by the user in the ruleset UI after import, because its numeric role id is not published (PM decision 2026-09-27). `docs/branching.md` describes D15 plus the one-time commands the user runs to apply the rulesets (plain `curl` REST calls or UI steps; `gh` is not assumed installed); `.github/pull_request_template.md` (what, why, how tested; checklist: CI green, no secrets, spec criteria touched) and `.github/CODEOWNERS` (`* @VirtuaChamp`) exist; the release build runs on `release: published` and refuses a tag whose commit is not on `master`. Fixture: none
24. `[file]` Automation files: `.github/workflows/release-please.yml` (on push to `master`, `googleapis/release-please-action`, config `release-please-config.json` with `release-type: node`, `extra-files` bumping `addon/WoWCompanion/WoWCompanion.toc` `## Version`, manifest `.release-please-manifest.json` starting at `0.1.0`); `.github/workflows/pr-title.yml` fails a PR whose title is not a conventional commit; `.github/dependabot.yml` per D17 (`npm` at `/`, `github-actions` at `/`, weekly, `target-branch: master`, `cooldown.default-days: 7`, groups for minor+patch, `commit-message.prefix: chore(deps)`); `docs/versions.md` lists every resolved version with the date and the lookup used; `package.json` `engines.node` matches the resolved Active LTS; every `uses:` is pinned to a 40-character SHA with a `# vX.Y.Z` comment (checked by `pnpm run guard`). Fixture: none
25. `[file]` D18 baseline: `pnpm-workspace.yaml` has the catalog and `minimumReleaseAge`, and every workspace dependency on a shared package uses `catalog:`; `tsconfig.base.json` sets the five strict flags of D18; `pnpm run lint` (oxlint), `pnpm run format:check` (oxfmt) and `pnpm run knip` exit 0; `packages/contracts` has no import from `apps/` and no Node I/O module (`fs`, `net`, `child_process`, `http`); `CLAUDE.md` is exactly `@AGENTS.md`; `AGENTS.md` states the D1-D18 rules builders must keep (read-only AI tools, native UI only, no secrets, Lua 5.1 dialect, conventional PR titles, branch flow). Fixture: none

## Lane cards
Carved by step-02b into 14 slices; cards and mini-specs are one list. Worktree `../worktree/wow-companion/<lane key>`, branch `feature/<lane key>`, lane key `wow-companion-v1-NN-<slice>`. No ports (no web app). Waves and shared files: [SHARED-FILES.md](wow-companion-v1/SHARED-FILES.md).

| NN | Slice | Wave | Depends on | Done when |
|---|---|---|---|---|
| 01 | node-toolchain | 0 | — | AC 13 (.gitignore), 24 (versions), 25 (workspace) |
| 02 | lua-toolchain | 1 | 01 | AC 15; lua:test green; addon + stub seeds |
| 03 | contracts | 1 | 01 | AC 25 (contracts); every parent type exported |
| 04 | repo-meta | 2 | 01, 02 | AC 18, 19, 23, 24 |
| 05 | build-db | 2 | 01, 02 | AC 13 (builddb) |
| 06 | codec | 2 | 02, 03 | AC 3, 4 (codec) |
| 07 | addon-context | 2 | 02, 03 | AC 11, 14, 16 (context.snapshot) |
| 08 | providers | 2 | 03 | AC 7, 17 (describe) |
| 09 | addon-window | 3 | 02, 03, 07 | AC 12, 16, 22 (dropdown) |
| 10 | addon-panels | 3 | 02, 03 | AC 16 (settings.panel), 20 |
| 11 | chats-core | 3 | 03 | AC 8, 17 (settings.apply), 22 (lifecycle) |
| 12 | mcp-server | 3 | 03, 05 | AC 9, 10 |
| 13 | game-link | 3 | 06 | AC 4 (link.ack), 5 |
| 14 | daemon | 4 | 08, 11, 12, 13 | AC 1, 2, 6 (closure), 9 (waypoint_run), 21 |

## Slices
[01](wow-companion-v1/01-node-toolchain.md) node toolchain · [02](wow-companion-v1/02-lua-toolchain.md) lua toolchain, guard, addon seed · [03](wow-companion-v1/03-contracts.md) contracts · [04](wow-companion-v1/04-repo-meta.md) repo automation and policy · [05](wow-companion-v1/05-build-db.md) QuestieDB build · [06](wow-companion-v1/06-codec.md) pixel codec · [07](wow-companion-v1/07-addon-context.md) addon game context · [08](wow-companion-v1/08-providers.md) providers · [09](wow-companion-v1/09-addon-window.md) chat window and routing · [10](wow-companion-v1/10-addon-panels.md) settings and report · [11](wow-companion-v1/11-chats-core.md) chats core · [12](wow-companion-v1/12-mcp-server.md) MCP server · [13](wow-companion-v1/13-game-link.md) game link · [14](wow-companion-v1/14-daemon.md) daemon wiring and closure

## Open questions
none
