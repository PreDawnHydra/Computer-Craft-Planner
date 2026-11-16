// One ComputerCraft computer: a fengari Lua state running bios.lua, an event queue,
// and the native APIs (term, fs, os, peripheral, redstone, bit, http).
// It has no DOM dependencies, so it runs in a Web Worker, the main thread, or Node.
import { lua, lauxlib, lualib } from 'fengari';
import {
  LuaError, toBytes, pushValue, setGlobalApi, argStr, argNum, argBool, fmtNum,
} from './luabridge.js';
import { Terminal } from './terminal.js';
import { FileSystem, MemoryMount, FSError, sanitizePath, getName, getDir, openHandle } from './filesystem.js';
import preludeSrc from './prelude.lua?raw';

export const SIDES = ['bottom', 'top', 'back', 'front', 'right', 'left'];
export const CC_VERSION = '1.75';
export const MC_VERSION = '1.7.10';
const TIMEOUT_MS = 7000;
const HARD_TIMEOUT_MS = 8500;

// Shared world clock: Minecraft ticks, 20 per second. 6000 = noon, 0 = 6am.
const worldStart = Date.now();
export const worldClock = { startTicks: 6000, ticksPerMs: 0.02 };
function worldTicks() { return worldClock.startTicks + (Date.now() - worldStart) * worldClock.ticksPerMs; }

export class Computer {
  /**
   * opts: { id, label, colour, rom: {bios, files}, hdd: Map, width, height,
   *         onTerminal(snapshot), onState({on, label}), onFsChange(path, value), host: {getPeripheral(side), onRedstone(side, value)} }
   */
  constructor(opts) {
    this.id = opts.id || 0;
    this.label = opts.label ?? null;
    this.colour = opts.colour !== false; // advanced computer
    this.rom = opts.rom;
    this.opts = opts;
    this.host = opts.host || {};
    this.terminal = new Terminal(opts.width || 51, opts.height || 19);
    this.hdd = new MemoryMount({ label: 'hdd', capacity: opts.capacity || 1000000, entries: opts.hdd || new Map(), onChange: opts.onFsChange });
    this.romMount = this.buildRomMount();
    this.on = false;
    this.L = null;
    this.queue = [];
    this.timers = new Map();
    this.alarms = new Map();
    this.nextTimer = 0;
    this.redstoneOut = Object.fromEntries(SIDES.map(s => [s, 0]));
    this.bundledOut = Object.fromEntries(SIDES.map(s => [s, 0]));
    this.redstoneIn = Object.fromEntries(SIDES.map(s => [s, 0]));
    this.bundledIn = Object.fromEntries(SIDES.map(s => [s, 0]));
    this.extraMounts = new Map(); // path -> mount (disk drives later)
    this.pending = false;
    this.stopRequest = null; // 'shutdown' | 'reboot'
  }

  buildRomMount() {
    const entries = new Map();
    for (const [p, v] of Object.entries(this.rom.files)) entries.set(p, v);
    return new MemoryMount({ readOnly: true, label: 'rom', entries });
  }

  // ---------- lifecycle ----------

  turnOn() {
    if (this.on) return;
    this.on = true;
    this.stopRequest = null;
    this.terminal.reset();
    this.clockStart = Date.now();
    this.fs = new FileSystem();
    this.fs.mount('', this.hdd);
    this.fs.mount('rom', this.romMount);
    for (const [p, m] of this.extraMounts) this.fs.mount(p, m);
    try {
      this.createState();
    } catch (e) {
      this.crash(String(e && e.message || e));
      return;
    }
    this.emitState();
    this.queue = [];
    this.resume([]); // first resume starts the bios
    this.flush();
  }

  shutdown() {
    if (!this.on) return;
    this.on = false;
    for (const t of this.timers.values()) clearTimeout(t);
    for (const t of this.alarms.values()) clearTimeout(t);
    this.timers.clear(); this.alarms.clear();
    this.queue = [];
    this.L = null; this.co = null;
    for (const s of SIDES) { this.redstoneOut[s] = 0; this.bundledOut[s] = 0; }
    this.host.onRedstone?.(null);
    this.terminal.reset();
    this.emitState();
    this.flush();
  }

  reboot() {
    this.shutdown();
    setTimeout(() => this.turnOn(), 50);
  }

  crash(msg) {
    // Print the error like CC's bios crash screen, then halt.
    const t = this.terminal;
    if (this.colour) t.textColour = 14; // red
    const lines = String(msg).match(/.{1,51}/g) || [''];
    for (const line of lines) {
      t.setCursorPos(0, t.cursorY);
      t.write(line);
      if (t.cursorY + 1 >= t.height) t.scroll(1); else t.cursorY++;
    }
    t.textColour = 0;
    this.L = null; this.co = null;
    this.halted = true;
    this.flush();
  }

  emitState() { this.opts.onState?.({ on: this.on, label: this.label, id: this.id }); }

  flush() {
    if (this.terminal.dirty) {
      this.terminal.dirty = false;
      this.opts.onTerminal?.(this.terminal.snapshot());
    }
  }

  // ---------- events ----------

  queueEvent(name, args = []) {
    if (!this.on || !this.L) return;
    if (this.queue.length >= 256) return; // CC drops events when the queue is full
    this.queue.push([name, ...args]);
    this.schedule();
  }

  schedule() {
    if (this.pending) return;
    this.pending = true;
    setTimeout(() => this.drain(), 0);
  }

  drain() {
    this.pending = false;
    const start = Date.now();
    while (this.queue.length && this.L && Date.now() - start < 50) {
      const ev = this.queue.shift();
      if (this.filter && ev[0] !== this.filter && ev[0] !== 'terminate') continue;
      this.resume(ev);
    }
    this.flush();
    if (this.stopRequest) {
      const r = this.stopRequest; this.stopRequest = null;
      if (r === 'reboot') this.reboot(); else this.shutdown();
      return;
    }
    if (this.queue.length) this.schedule();
  }

  resume(args) {
    const co = this.co;
    if (!co) return;
    for (const a of args) pushValue(co, a);
    this.resumeStart = Date.now();
    this.softAborted = false;
    let status;
    try {
      status = lua.lua_resume(co, this.L, args.length);
    } catch (e) {
      console.error(e);
      this.crash('Internal error: ' + (e && e.message || e));
      return;
    }
    this.resumeStart = 0;
    if (status === lua.LUA_YIELD) {
      const n = lua.lua_gettop(co);
      this.filter = n > 0 && lua.lua_type(co, 1) === lua.LUA_TSTRING ? lua.lua_tojsstring(co, 1) : null;
      lua.lua_settop(co, 0);
    } else if (status === lua.LUA_OK) {
      // bios returned: CC treats this as the computer stopping
      this.stopRequest = this.stopRequest || 'shutdown';
      this.co = null;
    } else {
      const msg = lua.lua_type(co, -1) === lua.LUA_TSTRING ? lua.lua_tojsstring(co, -1) : 'error';
      this.crash(msg);
    }
  }

  // ---------- Lua state ----------

  createState() {
    const L = lauxlib.luaL_newstate();
    this.L = L;
    this.halted = false;
    // Only the libraries CC exposes; debug is passed to the prelude then dropped.
    for (const [name, fn] of [['_G', lualib.luaopen_base], ['coroutine', lualib.luaopen_coroutine],
      ['table', lualib.luaopen_table], ['string', lualib.luaopen_string], ['math', lualib.luaopen_math],
      ['debug', lualib.luaopen_debug]]) {
      lauxlib.luaL_requiref(L, toBytes(name), fn, 1);
      lua.lua_pop(L, 1);
    }
    // prelude(debug)
    if (lauxlib.luaL_loadbuffer(L, toBytes(preludeSrc), preludeSrc.length, toBytes('=prelude')) !== lua.LUA_OK)
      throw new Error(lua.lua_tojsstring(L, -1));
    lua.lua_getglobal(L, toBytes('debug'));
    if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));

    // Globals CC sets from Java
    pushValue(L, CC_VERSION); lua.lua_setglobal(L, toBytes('_CC_VERSION'));
    pushValue(L, MC_VERSION); lua.lua_setglobal(L, toBytes('_MC_VERSION'));

    setGlobalApi(L, 'term', this.termApi());
    setGlobalApi(L, 'fs', this.fsApi());
    setGlobalApi(L, 'os', this.osApi());
    setGlobalApi(L, 'peripheral', this.peripheralApi());
    const rs = this.redstoneApi();
    setGlobalApi(L, 'redstone', rs);
    setGlobalApi(L, 'rs', rs);
    setGlobalApi(L, 'bit', this.bitApi());
    if (this.opts.http !== false) setGlobalApi(L, 'http', this.httpApi());

    // "Too long without yielding": count hook checks wall time since the last resume
    lua.lua_sethook(L, (L2) => {
      if (!this.resumeStart) return;
      const t = Date.now() - this.resumeStart;
      if (t > HARD_TIMEOUT_MS || (t > TIMEOUT_MS && !this.softAborted)) {
        this.softAborted = true;
        lauxlib.luaL_error(L2, toBytes('Too long without yielding'));
      }
    }, lua.LUA_MASKCOUNT, 1000);

    const co = lua.lua_newthread(L);
    this.coRef = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    const bios = this.rom.bios;
    if (lauxlib.luaL_loadbuffer(co, toBytes(bios), bios.length, toBytes('@bios')) !== lua.LUA_OK)
      throw new Error(lua.lua_tojsstring(co, -1));
    this.co = co;
    this.filter = null;
  }

  // ---------- APIs ----------

  parseColour(args, i) {
    const c = argNum(args, i, 'number');
    if (c <= 0) throw new LuaError('Colour out of range');
    const idx = Math.floor(Math.log2(c));
    if (idx < 0 || idx > 15) throw new LuaError('Colour out of range');
    return idx;
  }

  termApi() {
    const t = this.terminal;
    const self = this;
    const setText = (a) => {
      const c = self.parseColour(a, 0);
      if (!self.colour && c !== 0 && c !== 15) throw new LuaError('Colour not supported');
      t.textColour = c;
    };
    const setBack = (a) => {
      const c = self.parseColour(a, 0);
      if (!self.colour && c !== 0 && c !== 15) throw new LuaError('Colour not supported');
      t.backgroundColour = c;
    };
    const isColour = () => self.colour;
    const getText = () => 1 << t.textColour;
    const getBack = () => 1 << t.backgroundColour;
    return {
      write: (a) => {
        let s = a[0];
        s = s === null || s === undefined ? '' : (typeof s === 'number' ? fmtNum(s) : String(s));
        t.write(s.replace(/[\t]/g, ' '));
      },
      blit: (a) => {
        const s = argStr(a, 0, 'string, string, string');
        const fg = argStr(a, 1, 'string, string, string');
        const bg = argStr(a, 2, 'string, string, string');
        if (fg.length !== s.length || bg.length !== s.length) throw new LuaError('Arguments must be the same length');
        t.blit(s, fg.toLowerCase(), bg.toLowerCase());
      },
      scroll: (a) => { t.scroll(Math.floor(argNum(a, 0, 'number'))); },
      setCursorPos: (a) => {
        const x = Math.floor(argNum(a, 0, 'number, number')), y = Math.floor(argNum(a, 1, 'number, number'));
        t.setCursorPos(x - 1, y - 1);
      },
      setCursorBlink: (a) => { t.setCursorBlink(argBool(a, 0, 'boolean')); },
      getCursorPos: () => [t.cursorX + 1, t.cursorY + 1],
      getSize: () => [t.width, t.height],
      clear: () => { t.clear(); },
      clearLine: () => { t.clearLine(); },
      setTextColour: setText, setTextColor: setText,
      setBackgroundColour: setBack, setBackgroundColor: setBack,
      isColour, isColor: isColour,
      getTextColour: getText, getTextColor: getText,
      getBackgroundColour: getBack, getBackgroundColor: getBack,
    };
  }

  fsApi() {
    const fs = () => this.fs;
    const wrap = (fn) => (a) => {
      try { return fn(a); } catch (e) {
        if (e instanceof LuaError) throw e;
        throw new LuaError(String(e.message || e));
      }
    };
    return {
      list: wrap((a) => [fs().list(argStr(a, 0, 'string'))]),
      combine: wrap((a) => {
        const x = argStr(a, 0, 'string, string'), y = argStr(a, 1, 'string, string');
        return sanitizePath(x + '/' + y, true);
      }),
      getName: wrap((a) => getName(argStr(a, 0, 'string'))),
      getDir: wrap((a) => getDir(argStr(a, 0, 'string'))),
      getSize: wrap((a) => fs().getSize(argStr(a, 0, 'string'))),
      exists: wrap((a) => { try { return fs().exists(argStr(a, 0, 'string')); } catch (e) { if (e instanceof FSError) return false; throw e; } }),
      isDir: wrap((a) => { try { return fs().isDir(argStr(a, 0, 'string')); } catch (e) { if (e instanceof FSError) return false; throw e; } }),
      isReadOnly: wrap((a) => { try { return fs().isReadOnly(argStr(a, 0, 'string')); } catch (e) { if (e instanceof FSError) return false; throw e; } }),
      makeDir: wrap((a) => { fs().makeDir(argStr(a, 0, 'string')); }),
      move: wrap((a) => { fs().move(argStr(a, 0, 'string, string'), argStr(a, 1, 'string, string')); }),
      copy: wrap((a) => { fs().copy(argStr(a, 0, 'string, string'), argStr(a, 1, 'string, string')); }),
      delete: wrap((a) => { fs().delete(argStr(a, 0, 'string')); }),
      open: wrap((a) => {
        const p = argStr(a, 0, 'string, string'), m = argStr(a, 1, 'string, string');
        return openHandle(fs(), p, m);
      }),
      getDrive: wrap((a) => { try { return fs().getDrive(argStr(a, 0, 'string')); } catch (e) { if (e instanceof FSError) return null; throw e; } }),
      getFreeSpace: wrap((a) => fs().getFreeSpace(argStr(a, 0, 'string'))),
      find: wrap((a) => [fs().find(argStr(a, 0, 'string'))]),
    };
  }

  osApi() {
    const self = this;
    return {
      queueEvent: (a) => {
        const name = argStr(a, 0, 'string');
        self.queueEvent(name, a.slice(1));
      },
      startTimer: (a) => {
        const secs = argNum(a, 0, 'number');
        const id = self.nextTimer++;
        // timers fire on Minecraft ticks (50ms)
        const ms = Math.max(0, Math.ceil(secs * 20) * 50);
        self.timers.set(id, setTimeout(() => { self.timers.delete(id); self.queueEvent('timer', [id]); }, ms));
        return id;
      },
      cancelTimer: (a) => {
        const id = argNum(a, 0, 'number');
        clearTimeout(self.timers.get(id)); self.timers.delete(id);
      },
      setAlarm: (a) => {
        const time = argNum(a, 0, 'number');
        if (time < 0 || time >= 24) throw new LuaError('Number out of range');
        const id = self.nextTimer++;
        const now = ((worldTicks() + 6000) % 24000) / 1000;
        let hours = time - now; if (hours <= 0) hours += 24;
        const ms = hours * 1000 / worldClock.ticksPerMs;
        self.alarms.set(id, setTimeout(() => { self.alarms.delete(id); self.queueEvent('alarm', [id]); }, ms));
        return id;
      },
      cancelAlarm: (a) => {
        const id = argNum(a, 0, 'number');
        clearTimeout(self.alarms.get(id)); self.alarms.delete(id);
      },
      shutdown: () => { self.stopRequest = 'shutdown'; },
      reboot: () => { self.stopRequest = 'reboot'; },
      getComputerID: () => self.id,
      computerID: () => self.id,
      getComputerLabel: () => self.label,
      computerLabel: () => self.label,
      setComputerLabel: (a) => {
        const l = a[0];
        if (l !== null && l !== undefined && typeof l !== 'string') throw new LuaError('Expected string or nil');
        self.label = l ? l.slice(0, 32) : null;
        self.emitState();
      },
      clock: () => Math.floor((Date.now() - self.clockStart) / 50) * 0.05,
      time: () => (((worldTicks() + 6000) % 24000) / 1000),
      day: () => Math.floor((worldTicks() + 6000) / 24000) + 1,
    };
  }

  // Peripherals are supplied by the host: getPeripheral(side) -> { type, methods: { name(args) } } | null
  getPeripheral(side) { return this.host.getPeripheral ? this.host.getPeripheral(side) : null; }

  peripheralApi() {
    const self = this;
    const side = (a, sig) => {
      const s = argStr(a, 0, sig);
      return SIDES.includes(s) ? s : null;
    };
    return {
      isPresent: (a) => { const s = side(a, 'string'); return !!(s && self.getPeripheral(s)); },
      getType: (a) => { const s = side(a, 'string'); const p = s && self.getPeripheral(s); return p ? p.type : null; },
      getMethods: (a) => {
        const s = side(a, 'string'); const p = s && self.getPeripheral(s);
        return p ? [Object.keys(p.methods)] : null;
      },
      call: (a) => {
        const s = side(a, 'string, string');
        const m = argStr(a, 1, 'string, string');
        const p = s && self.getPeripheral(s);
        if (!p) throw new LuaError('No peripheral attached');
        const fn = p.methods[m];
        if (!fn) throw new LuaError('No such method ' + m);
        return fn(a.slice(2), self);
      },
    };
  }

  // Called by the host when a peripheral appears or disappears on a side
  peripheralChanged(side, attached) {
    this.queueEvent(attached ? 'peripheral' : 'peripheral_detach', [side]);
  }

  redstoneApi() {
    const self = this;
    const side = (a, sig) => {
      const s = argStr(a, 0, sig);
      if (!SIDES.includes(s)) throw new LuaError('Invalid side.');
      return s;
    };
    const setOut = (s, v) => {
      if (self.redstoneOut[s] !== v) { self.redstoneOut[s] = v; self.host.onRedstone?.(s, v); }
    };
    const getAnalogOut = (a) => self.redstoneOut[side(a, 'string')];
    const getAnalogIn = (a) => self.redstoneIn[side(a, 'string')];
    const setAnalog = (a) => {
      const s = side(a, 'string, number');
      const v = Math.floor(argNum(a, 1, 'string, number'));
      if (v < 0 || v > 15) throw new LuaError('Expected number in range 0-15');
      setOut(s, v);
    };
    return {
      getSides: () => [SIDES.slice()],
      setOutput: (a) => { const s = side(a, 'string, boolean'); setOut(s, argBool(a, 1, 'string, boolean') ? 15 : 0); },
      getOutput: (a) => self.redstoneOut[side(a, 'string')] > 0,
      getInput: (a) => self.redstoneIn[side(a, 'string')] > 0,
      setBundledOutput: (a) => {
        const s = side(a, 'string, number');
        self.bundledOut[s] = Math.floor(argNum(a, 1, 'string, number')) & 0xffff;
        self.host.onBundled?.(s, self.bundledOut[s]);
      },
      getBundledOutput: (a) => self.bundledOut[side(a, 'string')],
      getBundledInput: (a) => self.bundledIn[side(a, 'string')],
      testBundledInput: (a) => {
        const s = side(a, 'string, number');
        const m = Math.floor(argNum(a, 1, 'string, number'));
        return (self.bundledIn[s] & m) === m;
      },
      setAnalogOutput: setAnalog, setAnalogueOutput: setAnalog,
      getAnalogOutput: getAnalogOut, getAnalogueOutput: getAnalogOut,
      getAnalogInput: getAnalogIn, getAnalogueInput: getAnalogIn,
    };
  }

  setRedstoneInput(side, level, bundled) {
    let changed = false;
    if (level !== undefined && this.redstoneIn[side] !== level) { this.redstoneIn[side] = level; changed = true; }
    if (bundled !== undefined && this.bundledIn[side] !== bundled) { this.bundledIn[side] = bundled; changed = true; }
    if (changed) this.queueEvent('redstone', []);
  }

  bitApi() {
    const int = (a, i, sig) => {
      const v = argNum(a, i, sig);
      // Java: (int)(long) -> wrap to 32 bits
      return Number(BigInt.asIntN(32, BigInt(Math.trunc(isFinite(v) ? v : 0))));
    };
    const u = (n) => n >>> 0;
    return {
      bnot: (a) => u(~int(a, 0, 'number')),
      band: (a) => u(int(a, 0, 'number, number') & int(a, 1, 'number, number')),
      bor: (a) => u(int(a, 0, 'number, number') | int(a, 1, 'number, number')),
      bxor: (a) => u(int(a, 0, 'number, number') ^ int(a, 1, 'number, number')),
      brshift: (a) => u(int(a, 0, 'number, number') >> int(a, 1, 'number, number')),
      blshift: (a) => u(int(a, 0, 'number, number') << int(a, 1, 'number, number')),
      blogic_rshift: (a) => u(int(a, 0, 'number, number') >>> int(a, 1, 'number, number')),
    };
  }

  httpApi() {
    const self = this;
    const check = (url) => {
      let u;
      try { u = new URL(url); } catch (e) { return 'URL malformed'; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'URL not http';
      return null;
    };
    return {
      request: (a) => {
        const url = argStr(a, 0, 'string');
        const post = a[1] === null || a[1] === undefined ? null : argStr(a, 1, 'string');
        const headers = a[2] instanceof Map ? a[2] : null;
        const err = check(url);
        if (err) throw new LuaError(err);
        const init = { method: post !== null ? 'POST' : 'GET', headers: {} };
        if (headers) for (const [k, v] of headers) if (typeof k === 'string') init.headers[k] = String(v);
        if (post !== null) init.body = toBytes(post);
        const proxy = self.opts.httpProxy; // optional CORS proxy prefix
        fetch(proxy ? proxy + encodeURIComponent(url) : url, init).then(async (res) => {
          const buf = new Uint8Array(await res.arrayBuffer());
          let data = '';
          for (let i = 0; i < buf.length; i += 8192) data += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
          let pos = 0, closed = false;
          const handle = {
            readLine: () => {
              if (closed || pos >= data.length) return null;
              let nl = data.indexOf('\n', pos), line;
              if (nl < 0) { line = data.slice(pos); pos = data.length; } else { line = data.slice(pos, nl); pos = nl + 1; }
              return line.replace(/\r$/, '');
            },
            readAll: () => { if (closed || pos >= data.length) return null; const s = data.slice(pos); pos = data.length; return s; },
            read: () => (closed || pos >= data.length) ? null : data.charCodeAt(pos++),
            close: () => { closed = true; },
            getResponseCode: () => res.status,
          };
          if (res.ok) self.queueEvent('http_success', [url, handle]);
          else self.queueEvent('http_failure', [url, 'Could not connect']);
        }).catch(() => self.queueEvent('http_failure', [url, 'Could not connect']));
        return true;
      },
      checkURL: (a) => {
        const url = argStr(a, 0, 'string');
        const err = check(url);
        return err ? [false, err] : true;
      },
    };
  }
}
