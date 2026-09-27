Facts about the WoW Forever client, each recorded with its source. Owned by area: each section below is filled and later edited only by the slice named in its heading (`SHARED-FILES.md`).

## Client

- `## Interface: 16001`. Source: parent spec `docs/specs/wow-companion-v1.md` `## Metadata` — "confirmed in client 2026-09-26".
- `wowPath` is the flavour folder that holds `WowB.exe` (the `_classic_beta_` folder), not the top-level install directory. Client executable: `WowB.exe`. Source: spec metadata, user-reported 2026-09-26; unverified in client.
- AddOns path shape: `{wowPath}\Interface\AddOns\`, where `{wowPath}` is the flavour folder above. Source: standard Blizzard client directory layout (every Blizzard game client uses `<flavour folder>\Interface\AddOns\`) combined with the game-folder name recorded in the parent spec; the exact path on the maintainer's machine is unverified — confirm in client.
- Lua `bit` library 32-bit semantics: unverified — confirm in client: `/dump bit.bnot(0), bit.lshift(1,31)`. Until confirmed, every addon `bit` operation stays on operands and results below `2^31`, where the client's signed and unsigned interpretations agree; `tests/lua/bit_shim.lua` (this slice) implements unsigned 32-bit wraparound only over that range, no signed/unsigned branch above it, and enforces the constraint itself: it raises a Lua error whenever an operand or result would land at or above `2^31`, instead of silently returning an unverified value.

## Transport (13)

Not yet filled; owned by slice 13 (game-link).

## Items and waypoint (07)

Not yet filled; owned by slice 07 (addon-context).

## Chat window and edit box (09)

Not yet filled; owned by slice 09 (addon-window).

## Settings and report (10)

Not yet filled; owned by slice 10 (addon-panels).

## Providers (08)

Not yet filled; owned by slice 08 (providers).
