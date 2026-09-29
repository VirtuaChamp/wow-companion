local contentPath = assert(arg[1], "usage: run_deliver_chunk.lua <contentPath>")

local M = dofile("scripts/build-db/json-encode.lua")

local captured

function WoWCompanion_Deliver(session, msgs)
  captured = { session = session, msgs = msgs }
end

dofile(contentPath)

io.write(M.encode(captured))
