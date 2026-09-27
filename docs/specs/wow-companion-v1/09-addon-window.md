# wow-companion-v1 / 09 — addon chat window, routing, chats dropdown

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — D1, D8 (UI half), D10, D11; `## UX / flow` window, chats, input, `@` bullets.

## Lane key
wow-companion-v1-09-addon-window

## Depends on
02, 03, 07 (`ns.Mention`). Uses `ns.Transport` (13, same wave) through `tests/lua/stubs/transport.lua` until it merges.

## Shared files
Fills `addon/WoWCompanion/{Core,AiWindow}.lua`, `tests/lua/stubs/chat.lua`, `tests/lua/globals/chat.lua`, `docs/client-facts.md` section "Chat window and edit box".

## Scope
Owned: the two Lua files above, `tests/lua/{aiwindow_create,ai_route,reply_route,more_link,sanitize_chat,chats_dropdown}_test.lua`. Also `tests/lua/stubs/chat.lua` and `tests/lua/globals/chat.lua`.

## Code shape
- `Core.lua`: `ADDON_LOADED`, `WoWCompanionDB` init, `/ai` slash command and sub-commands (`new`, `chat`, `settings`, `report`, `reset`, `cancel`, `help`, `context`), dispatch of `ns.Transport.onMessage` by `t` to the owning module; `ns.Settings.open()` and `ns.Report.open()` called by name (slice 10).
- `AiWindow.lua`: the "Claude" floating chat window, printing (`sanitize` then `AddMessage`), `[more]` link, status lines, chats dropdown, `/r` routing, the `@` popup and ghost text rendering over `ns.Mention.match`, the gear button calling `ns.Settings.open()`.
- `sanitize(text) → string` pure: every `|` doubled so `|c`, `|H`, `|T`, `|K` print literally.

## Tests first
- `aiwindow.create`, `ai.route`, `reply.route`, `more.link` — parent AC 16 bullets — AC 16
- `sanitize.chat` — parent — AC 12
- `chats.dropdown` — parent AC 22 — AC 22

## Must not change
- Parent `## Must not change` (no `ChatFrame_*`/`ChatEdit_*`, no `SendChatMessage`, no custom art/colour literals); no `SetScript` on Blizzard edit boxes (parent AC 6).

## Must refuse
- Reply text with WoW escapes → literal (AC 12). Ask on a running chat → `busy` line (AC 8, message from the companion).
- No untainted mechanism for `/r` redirection or Tab-accept found in the `forever` source → stop and report to the PM, never replace handlers (parent AC 6).

## The point everything turns on
`/r` redirection and Tab-accept on Blizzard's edit box without taint. Check against: the mechanism cited by `forever` path:line in client-facts, and `reply.route` showing real whispers keep normal `/r`.

## Acceptance Criteria
1. `[file]` Parent AC 12. Fixture: `.tools/lua51`
2. `[file]` Parent AC 16: `aiwindow.create`, `ai.route`, `reply.route`, `more.link`. Fixture: `tests/lua/wow_stubs.lua`
3. `[file]` Parent AC 22, `chats.dropdown`. Fixture: as 2
4. `[file]` Parent AC 6, Chat window part: `ChatFrameUtil` names, floating undocked window creation, every template/atlas used, the `/r` and Tab-accept mechanism. Fixture: wow-ui-source `forever` clone

## Open questions
none
