# wow-companion-v1 / 13 — game link: slots, signals, Lua transport, setup

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — **Reply slot**, **GameLink** (interface, guarantees), `## Client behaviour facts`, `## The point everything turns on` (2).

## Lane key
wow-companion-v1-13-game-link

## Depends on
06 (codec)

## Shared files
Fills `addon/WoWCompanion/Inbox.lua`, `tests/lua/stubs/transport.lua` (replaces the seed stub with the real test double), `tests/lua/globals/transport.lua`, `docs/client-facts.md` section "Transport".

## Scope
Owned: `apps/companion/src/transport/{slots,screen-link,capture}.ts`, `addon/WoWCompanion/Inbox.lua`, `scripts/setup.ts`, `apps/companion/test/transport/**`, `tests/lua/inbox_test.lua`. Also `tests/lua/stubs/transport.lua` and `tests/lua/globals/transport.lua`.

## Code shape
- `createScreenLink(config): GameLink` — parent GameLink paragraph, all guarantees (batching, stale `progress` dropped, ack/re-paint, `slotsLeft`). Frame source is an internal seam (screen grab | grid file).
- `slots.ts`: `writeSlot(n, msgs) → Result<void, "too_large" | "slots_exhausted">` — Lua literal escaping `]]`, `\`, quotes, newlines; 64 KB cap; signal flip after the file is complete.
- `Inbox.lua`: `ns.Transport.send(tbl)` and `ns.Transport.onMessage(fn)` (parent lane interface; `send` queues and re-paints until acked), `WoWCompanion_Deliver` (the one allowed global), slot polling via `PlaySoundFile` on `sig/nnn.wav`, 20-left warning, exhausted → ask for `/reload`.
- `setup.ts`: install/junction the addon into `{wowPath}\Interface\AddOns\`, generate 200 `WoWCompanion_Rnnn` slot addons + `sig/` signal files (the `alive/` heartbeat is dropped, PM decision 2026-09-27).

## Tests first
- `slots.write`, `slots.exhausted` — parent — AC 5
- `link.batch`, `link.ack` — parent — AC 5, AC 4
- `inbox.deliver` (Lua) — `WoWCompanion_Deliver({msg, msg})` dispatches each in order; an `ack` stops the matching re-paint — AC 5

## Must not change
- Parent `## Must not change`: no input sent to the game, no memory reads.

## Must refuse
- Reply over 64 KB → `too_large` error, not truncated (parent Must refuse). 201st delivery → `slots_exhausted`.

## The point everything turns on
`sig/*.wav` readiness on this client is unverified from source. Check against: client-facts Transport section says "unverified — confirm in client" with the exact in-client check for the post-deploy list; `holdMs` default stated there.

## Acceptance Criteria
1. `[file]` Parent AC 5, incl. `link.batch`. Fixture: none
2. `[file]` Parent AC 4, `link.ack` part. Fixture: grid frame source
3. `[file]` `scripts/setup.ts` against a temp AddOns dir creates the addon, 200 slot addons, and `sig/` files. Fixture: temp dir
4. `[file]` Parent AC 6, Transport part: `PlaySoundFile` readiness ("unverified — confirm in client"), `holdMs` default, the D10 exemption for codec cells. Fixture: none

## Open questions
none
