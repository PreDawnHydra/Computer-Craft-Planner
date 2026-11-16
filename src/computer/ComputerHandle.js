// Page-side handle for a computer. Prefers a module Worker so a runaway program can't
// freeze the page; falls back to running in the main thread.
export class ComputerHandle {
  constructor({ id = 0, label = null, colour = true, autoOn = true } = {}) {
    this.id = id;
    this.listeners = { term: [], state: [] };
    this.state = { on: false, label, id };
    const boot = { type: 'boot', id, label, colour, autoOn };
    try {
      this.port = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.port.onmessage = (e) => this.receive(e.data);
      this.port.onerror = (e) => { console.warn('Computer worker failed, running in page', e); this.fallback(boot); };
      this.port.postMessage(boot);
    } catch (e) {
      console.warn('Workers unavailable, running computer in page', e);
      this.fallback(boot);
    }
  }

  async fallback(boot) {
    if (this.inPage) return;
    this.inPage = true;
    try { this.port?.terminate?.(); } catch (e) { /* ignore */ }
    const { runHost } = await import('./host.js');
    // Two linked fake ports
    const self = this;
    const hostPort = { postMessage: (data) => setTimeout(() => self.receive(data), 0), onmessage: null };
    this.port = { postMessage: (data) => setTimeout(() => hostPort.onmessage?.({ data }), 0), terminate() {} };
    runHost(hostPort);
    this.port.postMessage(boot);
  }

  receive(msg) {
    if (msg.type === 'state') this.state = { on: msg.on, label: msg.label, id: msg.id };
    for (const fn of this.listeners[msg.type] || []) fn(msg.type === 'term' ? msg.snap : this.state);
  }

  on(type, fn) { this.listeners[type].push(fn); }
  queueEvent(name, ...args) { this.port.postMessage({ type: 'event', name, args }); }
  turnOn() { this.port.postMessage({ type: 'power', action: 'on' }); }
  shutdown() { this.port.postMessage({ type: 'power', action: 'shutdown' }); }
  reboot() { this.port.postMessage({ type: 'power', action: 'reboot' }); }
  destroy() { this.port.terminate?.(); }
}
