// The world simulation: every computer and peripheral in one place, like ComputerCraft's
// computer thread, so peripheral calls between blocks are synchronous. Runs in a Worker.
// It mirrors the page's block map (sent as 'load'/'set' messages) and reports terminal
// snapshots, computer state, monitor layouts and block state changes back with post().
import { Computer } from '../computer/computer.js';
import { MemoryMount } from '../computer/filesystem.js';
import { Terminal } from '../computer/terminal.js';
import { makeTermApi } from '../computer/termapi.js';
import { LuaError, argNum, argStr } from '../computer/luabridge.js';
import { loadDrive, saveEntry, loadMeta, saveMeta } from '../computer/storage.js';
import { BLOCKS, DIRS, OPPOSITE } from '../world/blocks.js';

const key = (x, y, z) => x + ',' + y + ',' + z;
const add = (p, d) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg = (a) => [-a[0], -a[1], -a[2]];
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const UP = [0, 1, 0];

// World-space direction of each CC side for a block facing `facing` (index into DIRS)
export function sideVectors(facing = 4) {
  const fwd = DIRS[facing];
  const left = cross(UP, fwd);
  return { front: fwd, back: neg(fwd), top: UP, bottom: [0, -1, 0], left, right: neg(left) };
}

const MONITOR_MAX_W = 8, MONITOR_MAX_H = 6;
// TileMonitor: RENDER_BORDER 2/16, RENDER_MARGIN 0.5/16, RENDER_PIXEL_SCALE 1/64
function monitorTermSize(w, h, scale) {
  const inner = 2 * (2 / 16 + 0.5 / 16);
  return [
    Math.max(1, Math.round((w - inner) / (scale * 6 / 64))),
    Math.max(1, Math.round((h - inner) / (scale * 9 / 64))),
  ];
}

const MODEM_RANGE = 64, MODEM_MAX_RANGE = 384;
const modemRange = (y) => y <= 96 ? MODEM_RANGE : Math.min(MODEM_MAX_RANGE, MODEM_RANGE + (MODEM_MAX_RANGE - MODEM_RANGE) * (y - 96) / 160);

export class Simulation {
  constructor(post, { rom, httpProxy = null } = {}) {
    this.post = post;
    this.rom = rom;
    this.httpProxy = httpProxy;
    this.blocks = new Map();
    this.computers = new Map();   // id -> entry { id, computer, pos, sides: {side: peripheral} }
    this.peripherals = new Map(); // block key -> peripheral object
    this.groups = new Map();      // monitor group key -> group
    this.disks = new Map();       // disk id -> { id, label, mount, loading }
    this.diskMeta = { next: 0, labels: {} };
    this.ready = loadMeta('disks').then((m) => { if (m) this.diskMeta = m; });
    this.flushTimer = setInterval(() => this.flushMonitors(), 50);
  }

  // ---------- messages from the page ----------

  async handle(msg) {
    await this.ready;
    switch (msg.t) {
      case 'load':
        for (const [x, y, z, b] of msg.blocks) this.setBlock(x, y, z, b, true);
        this.regroupMonitors();
        for (const [x, y, z] of msg.blocks) this.rewire([x, y, z]);
        this.updateRedstone();
        this.postDisks();
        break;
      case 'set':
        this.setBlock(msg.x, msg.y, msg.z, msg.block, false);
        break;
      case 'event': this.computers.get(msg.id)?.computer.queueEvent(msg.name, msg.args || []); break;
      case 'power': {
        const c = this.computers.get(msg.id)?.computer;
        if (!c) break;
        if (msg.action === 'on') c.turnOn();
        else if (msg.action === 'shutdown') c.shutdown();
        else if (msg.action === 'reboot') { if (c.on) c.reboot(); else c.turnOn(); }
        break;
      }
      case 'disk': {
        const p = this.peripherals.get(key(msg.x, msg.y, msg.z));
        if (!(p instanceof DiskDrive)) break;
        if (msg.action === 'eject') p.eject();
        else p.insert(msg.diskId === 'new' || msg.diskId == null ? this.newDisk() : msg.diskId);
        break;
      }
      case 'touch': {
        const g = this.groupAt(key(msg.x, msg.y, msg.z));
        if (g) g.touch(msg.u, msg.v);
        break;
      }
      case 'config':
        this.httpProxy = msg.httpProxy || null;
        for (const e of this.computers.values()) if (e.computer) e.computer.opts.httpProxy = this.httpProxy;
        break;
    }
  }

  get(p) { return this.blocks.get(key(p[0], p[1], p[2])) || null; }

  setBlock(x, y, z, block, loading) {
    const k = key(x, y, z);
    const old = this.blocks.get(k) || null;
    if (block) this.blocks.set(k, block); else this.blocks.delete(k);
    const sameThing = old && block && old.type === block.type && old.id === block.id && old.facing === block.facing;
    if (sameThing) { if (block.type === 'lever') this.updateRedstone(); return; } // state change from the page (lever) or an echo
    if (old) this.removeThing(k, old);
    if (block) this.addThing(k, [x, y, z], block);
    if (loading) return;
    if ((old && isMonitor(old)) || (block && isMonitor(block))) this.regroupMonitors();
    this.rewire([x, y, z]);
    this.updateRedstone();
  }

  addThing(k, pos, block) {
    const def = BLOCKS[block.type];
    if (!def) return;
    if (def.computer) this.spawnComputer(block, pos);
    if (isMonitor(block)) this.peripherals.set(k, new MonitorBlock(this, pos, block));
    else if (block.type === 'disk_drive') {
      const d = new DiskDrive(this, pos, block);
      this.peripherals.set(k, d);
      if (block.disk != null) d.insert(block.disk, true);
    } else if (block.type === 'modem') this.peripherals.set(k, new WirelessModem(this, pos, block));
  }

  removeThing(k, old) {
    const def = BLOCKS[old.type];
    if (def?.computer) {
      const e = this.computers.get(old.id);
      if (e) {
        for (const [side, p] of Object.entries(e.sides)) p?.detach?.(e, side);
        e.computer.shutdown();
        this.computers.delete(old.id);
      }
    }
    const p = this.peripherals.get(k);
    if (p) { p.destroy?.(); this.peripherals.delete(k); }
  }

  // ---------- computers ----------

  async spawnComputer(block, pos) {
    const id = block.id;
    if (this.computers.has(id)) return;
    const entry = { id, pos, facing: block.facing ?? 4, sides: {}, wrappers: {}, computer: null };
    this.computers.set(id, entry);
    const drive = 'computer/' + id;
    const [hdd, meta] = await Promise.all([loadDrive(drive), loadMeta(drive)]);
    if (this.computers.get(id) !== entry) return; // removed while loading
    const sim = this;
    const def = BLOCKS[block.type];
    entry.computer = new Computer({
      id, label: meta?.label ?? block.label ?? null, colour: def.computer !== 'normal',
      rom: this.rom, hdd, httpProxy: this.httpProxy,
      onFsChange: (p, v) => saveEntry(drive, p, v),
      onTerminal: (snap) => this.post({ t: 'term', id, snap }),
      onState: (st) => { saveMeta(drive, { label: st.label }); this.post({ t: 'state', id, ...st }); },
      host: {
        getPeripheral: (side) => sim.wrapperFor(entry, side),
        onRedstone: () => sim.updateRedstone(),
        onBundled: () => {},
      },
    });
    this.rewire(pos, true);
    this.updateRedstone();
    this.post({ t: 'state', id, on: false, label: entry.computer.label });
    this.post({ t: 'term', id, snap: entry.computer.terminal.snapshot() });
    if (block.on) entry.computer.turnOn();
  }

  wrapperFor(entry, side) {
    const p = entry.sides[side];
    if (!p) return null;
    const w = entry.wrappers[side];
    if (w && w.target === p) return w;
    const methods = {};
    const impl = p.methods(entry, side);
    for (const name of Object.keys(impl)) methods[name] = impl[name];
    const wrapper = { type: p.type, methods, target: p };
    entry.wrappers[side] = wrapper;
    return wrapper;
  }

  // What peripheral (if any) a computer at `pos` sees in direction `dir`
  peripheralSeen(pos, dir) {
    const np = add(pos, dir);
    const b = this.get(np);
    if (!b) return null;
    const k = key(...np);
    if (BLOCKS[b.type]?.computer) {
      const e = this.computers.get(b.id);
      return e ? (e.asPeripheral ||= new ComputerPeripheral(e)) : null;
    }
    const p = this.peripherals.get(k) || null;
    if (p instanceof WirelessModem && !eq(add(np, DIRS[b.facing ?? 0]), pos)) return null; // modem only serves the block it is mounted on
    return p;
  }

  // Recompute peripheral attachments for computers at or next to pos
  rewire(pos, quiet = false) {
    const spots = [pos, ...DIRS.map((d) => add(pos, d))];
    for (const sp of spots) {
      const b = this.get(sp);
      if (!b || !BLOCKS[b.type]?.computer) continue;
      const e = this.computers.get(b.id);
      if (!e || !e.computer) continue;
      const vecs = sideVectors(e.facing);
      for (const side of Object.keys(vecs)) {
        const now = this.peripheralSeen(e.pos, vecs[side]);
        const before = e.sides[side] || null;
        if (now === before) continue;
        if (before) { before.detach?.(e, side); if (!quiet) e.computer.queueEvent('peripheral_detach', [side]); }
        e.sides[side] = now;
        if (now) { now.attach?.(e, side); if (!quiet) e.computer.queueEvent('peripheral', [side]); }
      }
    }
  }

  // ---------- redstone ----------

  updateRedstone() {
    clearTimeout(this.rsTimer);
    this.rsTimer = setTimeout(() => this.computeRedstone(), 0);
  }

  // Power reaching block `pos` from the neighbour in direction `dir`
  powerFrom(pos, dir) {
    const np = add(pos, dir);
    const b = this.get(np);
    if (!b) return 0;
    if (b.type === 'redstone_block') return 15;
    if (b.type === 'lever' && b.on) return 15;
    if (BLOCKS[b.type]?.computer) {
      const e = this.computers.get(b.id);
      if (!e?.computer) return 0;
      const vecs = sideVectors(e.facing);
      const back = neg(dir);
      for (const [side, v] of Object.entries(vecs)) if (eq(v, back)) return e.computer.redstoneOut[side] || 0;
    }
    return 0;
  }

  computeRedstone() {
    for (const e of this.computers.values()) {
      if (!e.computer) continue;
      const vecs = sideVectors(e.facing);
      for (const [side, v] of Object.entries(vecs)) e.computer.setRedstoneInput(side, this.powerFrom(e.pos, v));
    }
    for (const [k, b] of this.blocks) {
      if (b.type !== 'redstone_lamp') continue;
      const pos = k.split(',').map(Number);
      const lit = DIRS.some((d) => this.powerFrom(pos, d) > 0);
      if (!!b.on !== lit) this.patch(pos, { on: lit });
    }
  }

  // Change a block's state here and tell the page
  patch(pos, fields) {
    const b = this.get(pos);
    if (!b) return;
    Object.assign(b, fields);
    this.post({ t: 'patch', x: pos[0], y: pos[1], z: pos[2], patch: fields });
  }

  // ---------- monitors ----------

  groupAt(k) { return this.peripherals.get(k)?.group || null; }

  regroupMonitors() {
    const old = this.groups;
    this.groups = new Map();
    const cells = new Map(); // plane id -> Map(col,row -> pos)
    for (const [k, b] of this.blocks) {
      if (!isMonitor(b)) continue;
      const pos = k.split(',').map(Number);
      const f = b.facing ?? 4;
      const fwd = DIRS[f], right = cross(UP, fwd);
      const plane = `${b.type}|${f}|${dot(pos, fwd)}`;
      if (!cells.has(plane)) cells.set(plane, { type: b.type, facing: f, right, map: new Map() });
      cells.get(plane).map.set(dot(pos, right) + ',' + pos[1], pos);
    }
    for (const plane of cells.values()) {
      const used = new Set();
      const sorted = [...plane.map.entries()].map(([ck, pos]) => { const [c, r] = ck.split(',').map(Number); return { c, r, pos }; })
        .sort((a, b) => a.r - b.r || a.c - b.c);
      const has = (c, r) => plane.map.has(c + ',' + r) && !used.has(c + ',' + r);
      for (const cell of sorted) {
        if (used.has(cell.c + ',' + cell.r)) continue;
        let w = 1; while (w < MONITOR_MAX_W && has(cell.c + w, cell.r)) w++;
        let h = 1;
        while (h < MONITOR_MAX_H) {
          let full = true;
          for (let i = 0; i < w; i++) if (!has(cell.c + i, cell.r + h)) { full = false; break; }
          if (!full) break;
          h++;
        }
        const members = [];
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          used.add((cell.c + i) + ',' + (cell.r + j));
          members.push({ col: i, row: h - 1 - j, pos: plane.map.get((cell.c + i) + ',' + (cell.r + j)) });
        }
        // top-left block as seen from the front
        const tl = members.find((m) => m.col === 0 && m.row === 0).pos;
        const gk = `${plane.type}:${plane.facing}:${key(...tl)}:${w}x${h}`;
        const g = old.get(gk) || new MonitorGroup(this, gk, plane.type, plane.facing, w, h, tl);
        g.members = members;
        this.groups.set(gk, g);
        for (const m of members) {
          const p = this.peripherals.get(key(...m.pos));
          if (p) p.group = g;
        }
      }
    }
    // computers attached to monitors whose group changed get monitor_resize
    for (const [gk, g] of old) if (!this.groups.has(gk)) g.dead = true;
    for (const e of this.computers.values()) {
      for (const [side, p] of Object.entries(e.sides)) {
        if (p instanceof MonitorBlock && p.lastGroup !== p.group) e.computer?.queueEvent('monitor_resize', [side]);
      }
    }
    for (const p of this.peripherals.values()) if (p instanceof MonitorBlock) p.lastGroup = p.group;
    this.post({
      t: 'monitors',
      groups: [...this.groups.values()].map((g) => ({
        key: g.key, type: g.type, facing: g.facing, w: g.w, h: g.h, origin: g.origin,
        cells: g.members.map((m) => [...m.pos, connSuffix(g, m)]),
      })),
    });
    for (const g of this.groups.values()) this.post({ t: 'monitorTerm', key: g.key, snap: g.terminal.snapshot() });
  }

  flushMonitors() {
    for (const g of this.groups.values()) {
      if (g.terminal.dirty) { g.terminal.dirty = false; this.post({ t: 'monitorTerm', key: g.key, snap: g.terminal.snapshot() }); }
    }
  }

  // computers attached (on some side) to any block of a monitor group
  *attachedToGroup(g) {
    for (const e of this.computers.values()) {
      for (const [side, p] of Object.entries(e.sides)) if (p instanceof MonitorBlock && p.group === g) yield [e, side];
    }
  }

  // ---------- disks ----------

  newDisk() {
    const id = this.diskMeta.next++;
    saveMeta('disks', this.diskMeta);
    this.postDisks();
    return id;
  }

  async getDisk(id) {
    if (!this.disks.has(id)) {
      const d = { id, mount: null };
      d.loading = loadDrive('disk/' + id).then((entries) => {
        d.mount = new MemoryMount({ label: 'disk', capacity: 125000, entries, onChange: (p, v) => saveEntry('disk/' + id, p, v) });
      });
      this.disks.set(id, d);
    }
    const d = this.disks.get(id);
    await d.loading;
    return d;
  }

  diskLabel(id) { return this.diskMeta.labels[id] ?? null; }
  setDiskLabel(id, label) {
    if (label) this.diskMeta.labels[id] = label; else delete this.diskMeta.labels[id];
    saveMeta('disks', this.diskMeta);
    this.postDisks();
  }

  postDisks() {
    const list = [];
    for (let i = 0; i < this.diskMeta.next; i++) list.push({ id: i, label: this.diskMeta.labels[i] ?? null });
    const inDrives = new Set([...this.peripherals.values()].filter((p) => p instanceof DiskDrive && p.disk != null).map((p) => p.disk));
    this.post({ t: 'disks', list: list.map((d) => ({ ...d, inDrive: inDrives.has(d.id) })) });
  }

  // ---------- modems ----------

  *modems() { for (const p of this.peripherals.values()) if (p instanceof WirelessModem) yield p; }
}

function isMonitor(b) { return b.type === 'monitor' || b.type === 'monitor_advanced'; }

// "l", "r", "u", "d" neighbours inside the group, for ComputerCraft's connected monitor textures
function connSuffix(g, m) {
  return (m.col > 0 ? 'l' : '') + (m.col < g.w - 1 ? 'r' : '') + (m.row > 0 ? 'u' : '') + (m.row < g.h - 1 ? 'd' : '');
}

// ---------- peripherals ----------

class ComputerPeripheral {
  constructor(entry) { this.entry = entry; this.type = 'computer'; }
  methods() {
    const c = () => this.entry.computer;
    return {
      turnOn: () => { c()?.turnOn(); },
      shutdown: () => { c()?.shutdown(); },
      reboot: () => { const x = c(); if (x) { if (x.on) x.reboot(); else x.turnOn(); } },
      getID: () => this.entry.id,
    };
  }
}

class MonitorGroup {
  constructor(sim, k, type, facing, w, h, origin) {
    this.sim = sim; this.key = k; this.type = type; this.facing = facing;
    this.w = w; this.h = h; this.origin = origin;
    this.colour = type === 'monitor_advanced';
    this.textScale = 1;
    const [tw, th] = monitorTermSize(w, h, 1);
    this.terminal = new Terminal(tw, th);
  }
  setTextScale(s) {
    this.textScale = s;
    const [tw, th] = monitorTermSize(this.w, this.h, s);
    this.terminal.resize(tw, th);
    for (const [e, side] of this.sim.attachedToGroup(this)) e.computer?.queueEvent('monitor_resize', [side]);
  }
  touch(u, v) {
    if (!this.colour) return;
    // u, v: 0..1 across the whole front, from the top-left
    const border = (2 / 16 + 0.5 / 16);
    const x = Math.floor(((u * this.w - border) / (this.w - 2 * border)) * this.terminal.width) + 1;
    const y = Math.floor(((v * this.h - border) / (this.h - 2 * border)) * this.terminal.height) + 1;
    const cx = Math.min(Math.max(x, 1), this.terminal.width), cy = Math.min(Math.max(y, 1), this.terminal.height);
    for (const [e, side] of this.sim.attachedToGroup(this)) e.computer?.queueEvent('monitor_touch', [side, cx, cy]);
  }
}

class MonitorBlock {
  constructor(sim, pos, block) { this.sim = sim; this.pos = pos; this.type = 'monitor'; this.group = null; this.block = block; }
  methods() {
    const g = () => {
      if (!this.group || this.group.dead) throw new LuaError('Monitor is not connected');
      return this.group;
    };
    // term API over whichever group this block currently belongs to
    const api = makeTermApi(new Proxy({}, {
      get: (_, k) => { const t = g().terminal; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; },
      set: (_, k, v) => { g().terminal[k] = v; return true; },
    }), () => g().colour);
    api.setTextScale = (a) => {
      const s = argNum(a, 0, 'number');
      if (s < 0.5 || s > 5 || Math.round(s * 2) !== s * 2) throw new LuaError('Expected number in range 0.5-5');
      g().setTextScale(s);
    };
    return api;
  }
}

class DiskDrive {
  constructor(sim, pos, block) {
    this.sim = sim; this.pos = pos; this.type = 'drive';
    this.disk = null; this.attached = new Map(); // entry -> { side, mountPath }
  }
  mountFor(e) {
    const a = this.attached.get(e);
    if (!a || this.disk == null || !this.mount) return;
    if (a.mountPath) return;
    let name = 'disk', n = 2;
    while (e.computer.extraMounts.has(name)) name = 'disk' + n++;
    e.computer.mount(name, this.mount);
    a.mountPath = name;
  }
  unmountFor(e) {
    const a = this.attached.get(e);
    if (a?.mountPath) { e.computer.unmount(a.mountPath); a.mountPath = null; }
  }
  attach(e, side) { this.attached.set(e, { side, mountPath: null }); this.mountFor(e); }
  detach(e) { this.unmountFor(e); this.attached.delete(e); }
  async insert(id, quiet = false) {
    if (this.disk != null) return;
    this.disk = id;
    const d = await this.sim.getDisk(id);
    if (this.disk !== id) return;
    this.mount = d.mount;
    for (const [e, a] of this.attached) { this.mountFor(e); if (!quiet) e.computer.queueEvent('disk', [a.side]); }
    if (!quiet) this.sim.patch(this.pos, { disk: id });
    this.sim.postDisks();
  }
  eject() {
    if (this.disk == null) return;
    for (const [e, a] of this.attached) { this.unmountFor(e); e.computer.queueEvent('disk_eject', [a.side]); }
    this.disk = null; this.mount = null;
    this.sim.patch(this.pos, { disk: null });
    this.sim.postDisks();
  }
  destroy() { for (const e of [...this.attached.keys()]) this.detach(e); }
  methods(e) {
    const present = () => this.disk != null;
    return {
      isDiskPresent: () => present(),
      getDiskLabel: () => (present() ? this.sim.diskLabel(this.disk) : null),
      setDiskLabel: (a) => {
        if (!present()) return;
        const l = a[0];
        if (l !== null && l !== undefined && typeof l !== 'string') throw new LuaError('Expected string');
        this.sim.setDiskLabel(this.disk, l ? l.slice(0, 32) : null);
      },
      hasData: () => present(),
      getMountPath: () => this.attached.get(e)?.mountPath ?? null,
      hasAudio: () => false,
      getAudioTitle: () => (present() ? false : null),
      playAudio: () => {},
      stopAudio: () => {},
      ejectDisk: () => { this.eject(); },
      getDiskID: () => (present() ? this.disk : null),
    };
  }
}

class WirelessModem {
  constructor(sim, pos, block) {
    this.sim = sim; this.pos = pos; this.type = 'modem';
    this.channels = new Set(); this.attached = new Map(); // entry -> side
  }
  attach(e, side) { this.attached.set(e, side); }
  detach(e) { this.attached.delete(e); }
  destroy() { this.channels.clear(); }
  light() {
    const on = this.channels.size > 0;
    if (!!this.sim.get(this.pos)?.on !== on) this.sim.patch(this.pos, { on });
  }
  methods() {
    const ch = (a, i, sig) => {
      const c = Math.floor(argNum(a, i, sig));
      if (c < 0 || c > 65535) throw new LuaError('Expected number in range 0-65535');
      return c;
    };
    return {
      isOpen: (a) => this.channels.has(ch(a, 0, 'number')),
      open: (a) => {
        const c = ch(a, 0, 'number');
        if (!this.channels.has(c) && this.channels.size >= 128) throw new LuaError('Too many open channels');
        this.channels.add(c); this.light();
      },
      close: (a) => { this.channels.delete(ch(a, 0, 'number')); this.light(); },
      closeAll: () => { this.channels.clear(); this.light(); },
      transmit: (a) => {
        const c = ch(a, 0, 'number, number, value'), reply = ch(a, 1, 'number, number, value');
        this.transmit(c, reply, a[2] ?? null);
      },
      isWireless: () => true,
    };
  }
  transmit(channel, reply, message) {
    const range = modemRange(this.pos[1]);
    for (const other of this.sim.modems()) {
      if (other === this || !other.channels.has(channel)) continue;
      const d = Math.hypot(other.pos[0] - this.pos[0], other.pos[1] - this.pos[1], other.pos[2] - this.pos[2]);
      if (d > Math.max(range, modemRange(other.pos[1]))) continue;
      for (const [e, side] of other.attached) e.computer?.queueEvent('modem_message', [side, channel, reply, message, d]);
    }
  }
}

export { OPPOSITE };
