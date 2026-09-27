# wow-companion-v1 / 06 — pixel codec

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — **Pixel frame**, `## The point everything turns on` (1), (3).

## Lane key
wow-companion-v1-06-codec

## Depends on
02, 03

## Shared files
none

## Scope
Owned: `addon/WoWCompanion/Codec.lua` (encode payload → frames → cell colours; paint on a frame at UIParent top-left, scale `768 / physicalScreenHeight`), `apps/companion/src/transport/codec.ts` (cell grid → frames → message; CRC16-CCITT; reassembly), `apps/companion/src/transport/grid.ts` (the cell-grid file format both sides exchange in tests), `tests/lua/codec_test.lua`, `apps/companion/test/codec.test.ts`.

## Code shape
```ts
decodeGrid(grid: CellGrid): Result<Frame, "bad_frame">
reassemble(buf: FrameBuffer, f: Frame): { buf: FrameBuffer; message?: Result<GameToCompanion, "bad_frame" | "too_large"> }
```
Lua: `ns.Codec.encode(tbl) → frames`, `ns.Codec.render(frame) → cells` (pure), `ns.Codec.paint(cells)` (the only function touching frames/textures). Payload cap 16 KB → `too_large` on both sides.

## Tests first
- `codec.roundtrip` — parent Tests first — AC 3
- `codec.rejects` — parent Tests first, plus a 16 KB + 1 payload → `too_large` — AC 4

## Must not change
- Parent `## Must not change`. The codec cells use `SetColorTexture` with each channel exactly 0 or 1: they are the transport's data, not UI colour, so D10 does not apply to them. That reason goes into this slice's `HANDOFF-INTENT.md`; slice 13 records it in the Transport section of `docs/client-facts.md`.

## Must refuse
- Parent `## Must refuse` bullets 1-2 for the game direction.

## The point everything turns on
The TS decoder reads grids produced by the real Lua encoder under 5.1.5, never by a TS re-implementation. Check against: `codec.roundtrip` shells `.tools/lua51/lua` to write the grid.

## Acceptance Criteria
1. `[file]` Parent AC 3. Fixture: `.tools/lua51`
2. `[file]` Parent AC 4, codec part (game-direction oversize → `too_large`). Fixture: none

## Open questions
none
