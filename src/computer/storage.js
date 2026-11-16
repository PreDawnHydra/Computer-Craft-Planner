// IndexedDB persistence for computer drives and labels. Works in windows and workers;
// falls back to memory-only when IndexedDB is unavailable (Node, private mode).
const DB_NAME = 'ccemu', VERSION = 1;
let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB_NAME, VERSION); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (!db.objectStoreNames.contains('computers')) db.createObjectStore('computers');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  return dbPromise;
}

const prefix = (drive) => drive + '\u0000';

// drive is a string key like "computer/0" or "disk/3"
export async function loadDrive(drive) {
  const entries = new Map();
  const db = await openDb();
  if (!db) return entries;
  return new Promise((resolve) => {
    const tx = db.transaction('files', 'readonly');
    const range = IDBKeyRange.bound(prefix(drive), prefix(drive) + '￿');
    const req = tx.objectStore('files').openCursor(range);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(entries); return; }
      entries.set(cur.key.slice(prefix(drive).length), cur.value);
      cur.continue();
    };
    req.onerror = () => resolve(entries);
  });
}

// Batches writes: value === undefined deletes
const pending = new Map();
let flushTimer = null;
export function saveEntry(drive, path, value) {
  pending.set(prefix(drive) + path, value);
  if (!flushTimer) flushTimer = setTimeout(flushPending, 250);
}

async function flushPending() {
  flushTimer = null;
  const db = await openDb();
  const batch = [...pending]; pending.clear();
  if (!db || !batch.length) return;
  const tx = db.transaction('files', 'readwrite');
  const store = tx.objectStore('files');
  for (const [k, v] of batch) { if (v === undefined) store.delete(k); else store.put(v, k); }
}

export async function loadMeta(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction('computers', 'readonly').objectStore('computers').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function saveMeta(key, value) {
  const db = await openDb();
  if (!db) return;
  db.transaction('computers', 'readwrite').objectStore('computers').put(value, key);
}
