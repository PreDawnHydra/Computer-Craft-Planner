// Helpers for moving values between JS and fengari. Lua strings are treated as
// byte strings: each JS char code is one byte (0-255), like ComputerCraft 1.7.
import { lua, lauxlib } from 'fengari';

export class LuaError extends Error {}

export function toBytes(str) {
  const a = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) & 255;
  return a;
}

export function fromBytes(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return s;
}

// C printf "%.14g", which is how Lua 5.1 prints numbers
export function fmtNum(n) {
  if (n !== n) return 'nan';
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  if (n === 0) return Object.is(n, -0) ? '-0' : '0';
  const m = n.toExponential(13).split('e'), e = parseInt(m[1], 10);
  if (e < -4 || e >= 14) {
    const mant = m[0].replace(/\.?0+$/, '');
    return mant + 'e' + (e < 0 ? '-' : '+') + (Math.abs(e) < 10 ? '0' : '') + Math.abs(e);
  }
  let f = n.toFixed(Math.max(0, 13 - e));
  if (f.indexOf('.') >= 0) f = f.replace(/\.?0+$/, '');
  return f;
}

export function pushString(L, s) {
  lua.lua_pushlstring(L, toBytes(s), s.length);
}

// Push a JS value. Map -> table (keeps key types), Array -> 1-based table,
// plain object -> table with string keys, function -> Lua function via wrapFn.
export function pushValue(L, v, depth = 0) {
  if (depth > 64) { lua.lua_pushnil(L); return; }
  if (v === null || v === undefined) lua.lua_pushnil(L);
  else if (typeof v === 'number') lua.lua_pushnumber(L, v);
  else if (typeof v === 'boolean') lua.lua_pushboolean(L, v);
  else if (typeof v === 'string') pushString(L, v);
  else if (typeof v === 'function') lua.lua_pushcfunction(L, wrapFn(v));
  else if (v instanceof Map) {
    lua.lua_createtable(L, 0, v.size);
    for (const [k, val] of v) { pushValue(L, k, depth + 1); pushValue(L, val, depth + 1); lua.lua_rawset(L, -3); }
  } else if (Array.isArray(v)) {
    lua.lua_createtable(L, v.length, 0);
    for (let i = 0; i < v.length; i++) { pushValue(L, v[i], depth + 1); lua.lua_rawseti(L, -2, i + 1); }
  } else if (typeof v === 'object') {
    lua.lua_createtable(L, 0, 0);
    for (const k of Object.keys(v)) { pushString(L, k); pushValue(L, v[k], depth + 1); lua.lua_rawset(L, -3); }
  } else lua.lua_pushnil(L);
}

// Read a Lua value. Tables become Maps (copied, like CC's Java side does).
// Functions, threads and userdata become null.
export function getValue(L, idx, seen) {
  switch (lua.lua_type(L, idx)) {
    case lua.LUA_TNUMBER: return lua.lua_tonumber(L, idx);
    case lua.LUA_TBOOLEAN: return lua.lua_toboolean(L, idx);
    case lua.LUA_TSTRING: return fromBytes(lua.lua_tolstring(L, idx));
    case lua.LUA_TTABLE: {
      idx = lua.lua_absindex(L, idx);
      seen = seen || new Map();
      const ptr = lua.lua_topointer(L, idx);
      if (seen.has(ptr)) return seen.get(ptr);
      const m = new Map();
      seen.set(ptr, m);
      lua.lua_pushnil(L);
      while (lua.lua_next(L, idx)) {
        const k = getValue(L, -2, seen);
        const v = getValue(L, -1, seen);
        if (k !== null && v !== null) m.set(k, v);
        lua.lua_pop(L, 1);
      }
      return m;
    }
    default: return null;
  }
}

// Wrap a JS function (args: any[]) => any[] | any | undefined as a Lua C function.
// Throwing LuaError reports the message to Lua with the caller's position.
export function wrapFn(fn) {
  return function (L) {
    const n = lua.lua_gettop(L);
    const args = new Array(n);
    for (let i = 0; i < n; i++) args[i] = getValue(L, i + 1);
    let result, err = null;
    try {
      result = fn(args, L);
    } catch (e) {
      if (e instanceof LuaError) err = e.message;
      else { err = 'Java Exception Thrown: ' + (e && e.message || e); console.error(e); }
    }
    if (err !== null) {
      lauxlib.luaL_where(L, 2);
      pushString(L, err);
      lua.lua_concat(L, 2);
      return lua.lua_error(L);
    }
    if (result === undefined) return 0;
    if (!Array.isArray(result)) { pushValue(L, result); return 1; }
    for (const r of result) pushValue(L, r);
    return result.length;
  };
}

// Register a table of JS functions as a global Lua table
export function setGlobalApi(L, name, api) {
  lua.lua_createtable(L, 0, 0);
  for (const k of Object.keys(api)) {
    pushString(L, k);
    lua.lua_pushcfunction(L, wrapFn(api[k]));
    lua.lua_rawset(L, -3);
  }
  lua.lua_setglobal(L, toBytes(name));
}

// Argument checkers that mimic CC's "Expected string, number" style errors.
export function argStr(args, i, sig) {
  const v = args[i];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return fmtNum(v);
  throw new LuaError('Expected ' + sig);
}
export function argNum(args, i, sig) {
  const v = args[i];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  throw new LuaError('Expected ' + sig);
}
export function argBool(args, i, sig) {
  const v = args[i];
  if (typeof v === 'boolean') return v;
  throw new LuaError('Expected ' + sig);
}
