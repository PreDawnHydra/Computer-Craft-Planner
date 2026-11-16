// A mount-based filesystem modelled on dan200.computercraft.core.filesystem.FileSystem.
// File contents are byte strings (one char per byte).
import { LuaError } from './luabridge.js';

export class FSError extends LuaError {}

// Normalise a path the way CC's FileSystem.sanitizePath does.
export function sanitizePath(path, allowWildcards = false) {
  path = path.replace(/\\/g, '/');
  // Strip characters CC disallows
  const bad = allowWildcards ? /[":<>?|\x00-\x1f]/g : /["*:<>?|\x00-\x1f]/g;
  path = path.replace(bad, '');
  const out = [];
  for (const part of path.split('/')) {
    if (part.length === 0 || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
    } else if (/^\.{3,}$/.test(part)) {
      // "..." and similar are invalid, CC drops them
      continue;
    } else out.push(part.length > 255 ? part.slice(0, 255) : part);
  }
  return out.join('/');
}

export function getName(p) {
  p = sanitizePath(p, true);
  if (p === '') return 'root';
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

export function getDir(p) {
  p = sanitizePath(p, true);
  if (p === '') return '..';
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

// In-memory mount. entries: Map<path, string|null>, null = directory. '' is the mount root.
export class MemoryMount {
  constructor({ readOnly = false, capacity = Infinity, label = 'hdd', entries = null, onChange = null } = {}) {
    this.readOnly = readOnly;
    this.capacity = capacity;
    this.label = label;
    this.entries = entries || new Map();
    this.entries.set('', null);
    this.onChange = onChange;
  }
  exists(p) { return this.entries.has(p); }
  isDir(p) { return this.entries.has(p) && this.entries.get(p) === null; }
  list(p) {
    const prefix = p === '' ? '' : p + '/';
    const res = [];
    for (const k of this.entries.keys()) {
      if (k !== '' && k.startsWith(prefix) && k.indexOf('/', prefix.length) < 0) res.push(k.slice(prefix.length));
    }
    return res;
  }
  size(p) { const v = this.entries.get(p); return typeof v === 'string' ? v.length : 0; }
  used() { let n = 0; for (const v of this.entries.values()) n += typeof v === 'string' ? v.length + 500 : 500; return n; }
  freeSpace() { return this.readOnly ? 0 : Math.max(0, this.capacity - this.used()); }
  read(p) { return this.entries.get(p); }
  ensureParents(p) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!this.entries.has(d)) { this.entries.set(d, null); this.changed(d, null); }
    }
  }
  write(p, data) {
    if (this.capacity !== Infinity) {
      const old = this.entries.has(p) ? this.size(p) + 500 : 0;
      if (this.used() - old + data.length + 500 > this.capacity) throw new FSError('Out of space');
    }
    this.ensureParents(p);
    this.entries.set(p, data);
    this.changed(p, data);
  }
  makeDir(p) { this.ensureParents(p + '/x'); }
  delete(p) {
    const prefix = p + '/';
    for (const k of [...this.entries.keys()]) {
      if (k === p || k.startsWith(prefix) || (p === '' && k !== '')) {
        if (k === '') continue;
        this.entries.delete(k);
        this.changed(k, undefined);
      }
    }
  }
  changed(p, v) { if (this.onChange) this.onChange(p, v); }
}

export class FileSystem {
  constructor() { this.mounts = []; }

  mount(path, mount) {
    path = sanitizePath(path);
    if (path.startsWith('..')) throw new FSError('Cannot mount below the root');
    this.unmount(path);
    this.mounts.push({ path, mount });
    // longest paths first so lookups find the deepest mount
    this.mounts.sort((a, b) => b.path.length - a.path.length);
  }

  unmount(path) { this.mounts = this.mounts.filter(m => m.path !== path); }

  resolve(path) {
    path = sanitizePath(path);
    if (path === '..' || path.startsWith('../')) throw new FSError('Invalid Path');
    for (const m of this.mounts) {
      if (m.path === '' || path === m.path || path.startsWith(m.path + '/')) {
        const local = m.path === '' ? path : path.slice(m.path.length + 1);
        return { mount: m.mount, local, path, mountPath: m.path };
      }
    }
    throw new FSError('Invalid Path');
  }

  exists(p) { const r = this.resolve(p); return r.mount.exists(r.local); }
  isDir(p) { const r = this.resolve(p); return r.mount.isDir(r.local); }
  isReadOnly(p) { const r = this.resolve(p); return r.mount.readOnly; }
  getDrive(p) { const r = this.resolve(p); return r.mount.exists(r.local) ? r.mount.label : null; }
  getFreeSpace(p) { const r = this.resolve(p); return r.mount.freeSpace(); }

  getSize(p) {
    const r = this.resolve(p);
    if (!r.mount.exists(r.local)) throw new FSError('No such file');
    return r.mount.size(r.local);
  }

  list(p) {
    const r = this.resolve(p);
    if (!r.mount.isDir(r.local)) throw new FSError('Not a directory');
    const set = new Set(r.mount.list(r.local));
    // mount points directly inside this directory
    for (const m of this.mounts) {
      if (m.path === '' || m.path === r.path) continue;
      const parent = getDir(m.path);
      if (parent === r.path) set.add(getName(m.path));
    }
    return [...set].sort();
  }

  makeDir(p) {
    const r = this.resolve(p);
    if (r.mount.readOnly) throw new FSError('Access denied');
    if (r.mount.exists(r.local)) {
      if (!r.mount.isDir(r.local)) throw new FSError('File exists');
      return;
    }
    r.mount.makeDir(r.local);
  }

  delete(p) {
    const r = this.resolve(p);
    if (r.mount.readOnly || (r.local === '' && r.mountPath !== '')) throw new FSError('Access denied');
    if (r.local === '' && r.mountPath === '') {
      // deleting the root removes everything on the hdd
      r.mount.delete('');
      return;
    }
    r.mount.delete(r.local);
  }

  copyRecursive(src, dst) {
    const s = this.resolve(src), d = this.resolve(dst);
    if (!s.mount.exists(s.local)) return;
    if (s.mount.isDir(s.local)) {
      d.mount.makeDir(d.local);
      for (const child of this.list(s.path)) this.copyRecursive(s.path + '/' + child, d.path + '/' + child);
    } else {
      d.mount.write(d.local, s.mount.read(s.local));
    }
  }

  copy(src, dst) {
    const s = this.resolve(src), d = this.resolve(dst);
    if (d.mount.readOnly) throw new FSError('Access denied');
    if (!s.mount.exists(s.local)) throw new FSError('No such file');
    if (d.mount.exists(d.local)) throw new FSError('File exists');
    if (d.path === s.path || d.path.startsWith(s.path + '/') || s.path === '') throw new FSError("Can't copy a directory inside itself");
    this.copyRecursive(s.path, d.path);
  }

  move(src, dst) {
    const s = this.resolve(src), d = this.resolve(dst);
    if (s.mount.readOnly || d.mount.readOnly || s.local === '') throw new FSError('Access denied');
    if (!s.mount.exists(s.local)) throw new FSError('No such file');
    if (d.mount.exists(d.local)) throw new FSError('File exists');
    if (d.path.startsWith(s.path + '/')) throw new FSError("Can't move a directory inside itself");
    this.copyRecursive(s.path, d.path);
    s.mount.delete(s.local);
  }

  readFile(p) {
    const r = this.resolve(p);
    if (!r.mount.exists(r.local)) throw new FSError('No such file');
    if (r.mount.isDir(r.local)) throw new FSError('No such file');
    return r.mount.read(r.local);
  }

  writeFile(p, data, append = false) {
    const r = this.resolve(p);
    if (r.mount.readOnly) throw new FSError('Access denied');
    if (r.mount.isDir(r.local)) throw new FSError('Cannot write to directory');
    const old = append && r.mount.exists(r.local) ? r.mount.read(r.local) : '';
    r.mount.write(r.local, old + data);
  }

  // Wildcard search, like fs.find
  find(pattern) {
    pattern = sanitizePath(pattern, true);
    const parts = pattern.split('/');
    let results = [''];
    for (const part of parts) {
      if (part === '') continue;
      const re = new RegExp('^' + part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      const next = [];
      for (const base of results) {
        if (!this.isDir(base)) continue;
        for (const name of this.list(base)) if (re.test(name)) next.push(base === '' ? name : base + '/' + name);
      }
      results = next;
    }
    return pattern === '' ? [] : results.sort();
  }
}

// Open file handles, returned to Lua as tables of functions.
export function openHandle(fs, path, mode) {
  const p = sanitizePath(path);
  const checkOpen = (h) => { if (h.closed) throw new LuaError('attempt to use a closed file'); };
  if (mode === 'r' || mode === 'rb') {
    let data;
    try {
      if (!fs.exists(p) || fs.isDir(p)) return null;
      data = fs.readFile(p);
    } catch (e) { return null; }
    const h = { closed: false, pos: 0 };
    if (mode === 'r') {
      return {
        readLine: () => {
          checkOpen(h);
          if (h.pos >= data.length) return null;
          let nl = data.indexOf('\n', h.pos);
          let line;
          if (nl < 0) { line = data.slice(h.pos); h.pos = data.length; }
          else { line = data.slice(h.pos, nl); h.pos = nl + 1; }
          if (line.endsWith('\r')) line = line.slice(0, -1);
          return line;
        },
        readAll: () => {
          checkOpen(h);
          if (h.pos >= data.length) return h.pos === 0 ? '' : null;
          const s = data.slice(h.pos).replace(/\r\n/g, '\n'); h.pos = data.length; return s;
        },
        close: () => { h.closed = true; },
      };
    }
    return {
      read: () => { checkOpen(h); return h.pos < data.length ? data.charCodeAt(h.pos++) : null; },
      close: () => { h.closed = true; },
    };
  }
  if (mode === 'w' || mode === 'a' || mode === 'wb' || mode === 'ab') {
    try {
      if (fs.isReadOnly(p) || fs.isDir(p)) return null;
      // create / truncate immediately like Java would
      if (mode[0] === 'w') fs.writeFile(p, '');
      else fs.writeFile(p, '', true);
    } catch (e) { return null; }
    const h = { closed: false, buf: '' };
    const flush = () => { if (h.buf) { const b = h.buf; h.buf = ''; fs.writeFile(p, b, true); } };
    const str = (v) => (v === null || v === undefined) ? '' : (typeof v === 'number' ? fmtNumLazy(v) : String(v));
    const common = {
      flush: () => { checkOpen(h); flush(); },
      close: () => { checkOpen(h); flush(); h.closed = true; },
    };
    if (mode === 'w' || mode === 'a') {
      return {
        write: (a) => { checkOpen(h); h.buf += str(a[0]); },
        writeLine: (a) => { checkOpen(h); h.buf += str(a[0]) + '\n'; },
        ...common,
      };
    }
    return {
      write: (a) => { checkOpen(h); if (typeof a[0] === 'number') h.buf += String.fromCharCode(a[0] & 255); },
      ...common,
    };
  }
  throw new LuaError('Unsupported mode');
}

import { fmtNum as fmtNumLazy } from './luabridge.js';
