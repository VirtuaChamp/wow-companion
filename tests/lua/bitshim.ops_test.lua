local bit = dofile("tests/lua/bit_shim.lua")

assert(bit.band(0, 0) == 0, "band(0,0)")
assert(bit.band(1, 1) == 1, "band(1,1)")
assert(bit.band(0xFFFF, 0xFFFF) == 0xFFFF, "band(0xFFFF,0xFFFF)")
assert(bit.band(0xFFFF, 0) == 0, "band(0xFFFF,0)")

assert(bit.bor(0, 0) == 0, "bor(0,0)")
assert(bit.bor(0, 1) == 1, "bor(0,1)")
assert(bit.bor(0x00FF, 0x0F00) == 0x0FFF, "bor(0x00FF,0x0F00)")

assert(bit.bxor(0, 0) == 0, "bxor(0,0)")
assert(bit.bxor(0xFFFF, 0xFFFF) == 0, "bxor(0xFFFF,0xFFFF)")
assert(bit.bxor(1, 1) == 0, "bxor(1,1)")
assert(bit.bxor(0x0F0F, 0xF0F0) == 0xFFFF, "bxor(0x0F0F,0xF0F0)")

assert(bit.lshift(1, 0) == 1, "lshift(1,0)")
assert(bit.lshift(1, 1) == 2, "lshift(1,1)")
assert(bit.lshift(1, 16) == 0x10000, "lshift(1,16)")
assert(bit.lshift(0xFF, 8) == 0xFF00, "lshift(0xFF,8)")

assert(bit.rshift(1, 0) == 1, "rshift(1,0)")
assert(bit.rshift(0xFFFF, 8) == 0xFF, "rshift(0xFFFF,8)")
assert(bit.rshift(0x7FFFFFFF, 16) == 0x7FFF, "rshift(0x7FFFFFFF,16)")

local okBandOperand = pcall(bit.band, 0x80000000, 0)
assert(not okBandOperand, "band operand at 2^31 must raise")

local okBorOperand = pcall(bit.bor, 0, 0x80000000)
assert(not okBorOperand, "bor operand at 2^31 must raise")

local okLshiftResult = pcall(bit.lshift, 1, 31)
assert(not okLshiftResult, "lshift result at 2^31 must raise")

local okLshiftOperand = pcall(bit.lshift, 0x80000000, 0)
assert(not okLshiftOperand, "lshift operand at 2^31 must raise")

local okRshiftOperand = pcall(bit.rshift, 0x80000000, 0)
assert(not okRshiftOperand, "rshift operand at 2^31 must raise")

print("bitshim.ops: all assertions passed")
