-- Runs before bios.lua. Fengari is Lua 5.3; this makes the global environment look
-- like ComputerCraft 1.7's LuaJ (Lua 5.1). It receives the debug library as an argument
-- because debug is removed from the globals, as in CC.
local debug = ...
local getupvalue, upvaluejoin, getinfo = debug.getupvalue, debug.upvaluejoin, debug.getinfo
local type, error, rawget, select, floor = type, error, rawget, select, math.floor
local G = _G

local function findEnvUpvalue(f)
  local i = 1
  while true do
    local name = getupvalue(f, i)
    if name == nil then return nil end
    if name == "_ENV" then return i end
    i = i + 1
  end
end

local function resolveLevel(f, fname)
  if type(f) == "number" then
    if f < 0 then error("bad argument #1 to '" .. fname .. "' (level must be non-negative)", 3) end
    if f == 0 then return nil end
    local info = getinfo(f + 2, "f")
    if not info then error("bad argument #1 to '" .. fname .. "' (invalid level)", 3) end
    return info.func
  elseif type(f) == "function" then
    return f
  elseif f == nil then
    local info = getinfo(3, "f")
    return info and info.func
  end
  error("bad argument #1 to '" .. fname .. "' (number expected, got " .. type(f) .. ")", 3)
end

function getfenv(f)
  local fn = resolveLevel(f == nil and 1 or f, "getfenv")
  if fn == nil then return G end
  local i = findEnvUpvalue(fn)
  if not i then return G end
  local _, env = getupvalue(fn, i)
  return env
end

function setfenv(f, t)
  if type(t) ~= "table" then
    error("bad argument #2 to 'setfenv' (table expected, got " .. type(t) .. ")", 2)
  end
  local fn = resolveLevel(f, "setfenv")
  if fn == nil then return end
  local i = findEnvUpvalue(fn)
  if i then
    upvaluejoin(fn, i, function() return t end, 1)
  end
  return fn
end

local nativeload = load
function loadstring(s, name)
  if type(s) ~= "string" then
    error("bad argument #1 to 'loadstring' (string expected, got " .. type(s) .. ")", 2)
  end
  if name == nil then
    name = s
  elseif type(name) == "string" and not name:find("^[=@]") then
    name = "=" .. name
  end
  return nativeload(s, name, "t")
end

-- 5.1 load: load(func [, chunkname]). Also accept strings (handy, harmless).
function load(x, name, mode, env)
  if type(name) == "string" and not name:find("^[=@]") then name = "=" .. name end
  if env ~= nil then return nativeload(x, name, "t", env) end
  return nativeload(x, name, "t")
end

unpack = table.unpack
table.getn = function(t) return #t end
table.setn = function() error("'setn' is obsolete", 2) end
table.maxn = function(t)
  local n = 0
  for k in pairs(t) do
    if type(k) == "number" and k > n then n = k end
  end
  return n
end
table.pack = nil
table.unpack = nil
table.move = nil

math.pow = function(a, b) return a ^ b end
math.log10 = function(x) return math.log(x, 10) end
local nativelog = math.log
math.log = function(x) return nativelog(x) end
math.ldexp = function(m, e) return m * 2.0 ^ e end
math.frexp = function(x)
  if x == 0 or x ~= x or x == math.huge or x == -math.huge then return x, 0 end
  local e = floor(nativelog(math.abs(x), 2)) + 1
  local m = x / 2.0 ^ e
  if math.abs(m) >= 1 then m = m / 2; e = e + 1 elseif math.abs(m) < 0.5 then m = m * 2; e = e - 1 end
  return m, e
end
math.cosh = function(x) return (math.exp(x) + math.exp(-x)) / 2 end
math.sinh = function(x) return (math.exp(x) - math.exp(-x)) / 2 end
math.tanh = function(x) local a, b = math.exp(x), math.exp(-x) return (a - b) / (a + b) end
math.mod = math.fmod
math.tointeger = nil
math.type = nil
math.ult = nil
math.maxinteger = nil
math.mininteger = nil
local nativerandom = math.random
math.random = function(m, n)
  if m == nil then return nativerandom() end
  if n == nil then return nativerandom(floor(m)) end
  return nativerandom(floor(m), floor(n))
end

string.gfind = string.gmatch
string.pack = nil
string.unpack = nil
string.packsize = nil

-- Lua 5.3 adds __index-free utf8 and these, which LuaJ does not have
utf8 = nil
coroutine.isyieldable = nil
rawlen = nil

-- Removed in ComputerCraft
collectgarbage = nil
dofile = nil
loadfile = nil
module = nil
require = nil
package = nil
io = nil
os = nil
print = nil
debug = nil
newproxy = nil

_VERSION = "Lua 5.1"
