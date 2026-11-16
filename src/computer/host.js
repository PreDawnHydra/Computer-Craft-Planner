// Runs one Computer and talks to the page over a message port (a Worker's self,
// or an in-thread fake port when Workers are unavailable).
import { Computer } from './computer.js';
import rom from '../generated/rom.json';
import { loadDrive, saveEntry, loadMeta, saveMeta } from './storage.js';

export function runHost(port) {
  let computer = null;
  port.onmessage = async (e) => {
    const msg = e.data;
    if (msg.type === 'boot') {
      const drive = 'computer/' + msg.id;
      const [hdd, meta] = await Promise.all([loadDrive(drive), loadMeta(drive)]);
      computer = new Computer({
        id: msg.id,
        label: meta?.label ?? msg.label ?? null,
        colour: msg.colour !== false,
        rom,
        hdd,
        onFsChange: (p, v) => saveEntry(drive, p, v),
        onTerminal: (snap) => port.postMessage({ type: 'term', snap }),
        onState: (st) => {
          saveMeta(drive, { label: st.label });
          port.postMessage({ type: 'state', ...st });
        },
      });
      if (msg.autoOn) computer.turnOn();
      else port.postMessage({ type: 'state', on: false, label: computer.label, id: computer.id });
      port.postMessage({ type: 'term', snap: computer.terminal.snapshot() });
    } else if (!computer) {
      return;
    } else if (msg.type === 'event') {
      computer.queueEvent(msg.name, msg.args || []);
    } else if (msg.type === 'power') {
      if (msg.action === 'on') computer.turnOn();
      else if (msg.action === 'shutdown') computer.shutdown();
      else if (msg.action === 'reboot') { if (computer.on) computer.reboot(); else computer.turnOn(); }
    }
  };
}
