// Page-side connection to the world simulation (one Worker for all computers),
// with a ComputerHandle-like proxy per computer for the terminal GUI.
export class SimClient {
  constructor() {
    this.listeners = new Map(); // type -> Set(fn)
    this.proxies = new Map();
    try {
      this.port = new Worker(new URL('./simWorker.js', import.meta.url), { type: 'module' });
      this.port.onmessage = (e) => this.receive(e.data);
      this.port.onerror = (e) => { console.warn('Simulation worker failed, running in page', e); this.fallback(); };
    } catch (e) {
      console.warn('Workers unavailable, running simulation in page', e);
      this.fallback();
    }
    this.queue = [];
  }

  async fallback() {
    if (this.inPage) return;
    this.inPage = true;
    try { this.port?.terminate?.(); } catch (e) { /* ignore */ }
    const [{ Simulation }, rom] = await Promise.all([import('./sim.js'), import('../generated/rom.json')]);
    const sim = new Simulation((m) => setTimeout(() => this.receive(m), 0), { rom: rom.default });
    this.port = { postMessage: (m) => setTimeout(() => sim.handle(m), 0), terminate() {} };
    for (const m of this.sent || []) this.port.postMessage(m); // replay what the dead worker may have missed
  }

  send(msg) {
    (this.sent ||= []).push(msg);
    if (this.sent.length > 2000) this.sent = null; // only kept for an early fallback
    this.port.postMessage(msg);
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }

  receive(msg) {
    if (msg.t === 'term' || msg.t === 'state') this.computer(msg.id).receive(msg);
    for (const fn of this.listeners.get(msg.t) || []) fn(msg);
  }

  computer(id) {
    if (!this.proxies.has(id)) this.proxies.set(id, new ComputerProxy(this, id));
    return this.proxies.get(id);
  }
}

class ComputerProxy {
  constructor(sim, id) {
    this.sim = sim; this.id = id;
    this.listeners = { term: [], state: [] };
    this.state = { on: false, label: null, id };
    this.lastSnap = null;
  }
  receive(msg) {
    if (msg.t === 'term') { this.lastSnap = msg.snap; for (const fn of this.listeners.term) fn(msg.snap); }
    else { this.state = { on: msg.on, label: msg.label, id: this.id }; for (const fn of this.listeners.state) fn(this.state); }
  }
  on(type, fn) {
    this.listeners[type].push(fn);
    return () => { this.listeners[type] = this.listeners[type].filter((f) => f !== fn); };
  }
  queueEvent(name, ...args) { this.sim.send({ t: 'event', id: this.id, name, args }); }
  turnOn() { this.sim.send({ t: 'power', id: this.id, action: 'on' }); }
  shutdown() { this.sim.send({ t: 'power', id: this.id, action: 'shutdown' }); }
  reboot() { this.sim.send({ t: 'power', id: this.id, action: 'reboot' }); }
}
