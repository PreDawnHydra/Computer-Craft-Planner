// Headless test of the world simulation: peripherals between computers, without a browser.
import { Simulation } from '../src/sim/sim.js';
import rom from '../src/generated/rom.json';
const snaps = new Map(), msgs = [];
const sim = new Simulation((m) => { if (m.t === 'term') snaps.set(m.id, m.snap); else msgs.push(m); if (m.t === 'state') console.log('state', JSON.stringify(m)); }, { rom });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const blocks = [
  [0, 1, -3, { type: 'computer_advanced', facing: 4, id: 0, on: true }],
  [-1, 1, -3, { type: 'disk_drive', facing: 4 }],
  [1, 1, -3, { type: 'redstone_lamp' }],
  [0, 1, -4, { type: 'modem', facing: 4 }],
  [5, 1, -3, { type: 'computer', facing: 4, id: 1, on: true }],
  [5, 1, -4, { type: 'modem', facing: 4 }],
];
for (let x = -1; x <= 1; x++) for (let y = 2; y <= 3; y++) blocks.push([x, y, -3, { type: 'monitor_advanced', facing: 4 }]);
sim.handle({ t: 'load', blocks });
await wait(800);
const type = async (id, line) => {
  const t0 = Date.now();
  for (const ch of line) sim.handle({ t: 'event', id, name: 'char', args: [ch] });
  sim.handle({ t: 'event', id, name: 'key', args: [28] });
  await wait(300);
  console.log(`  [${id}] typed in ${Date.now() - t0}ms: ${line.slice(0, 40)}`);
};
const screen = (id) => snaps.get(id).text.map((l) => l.trimEnd()).filter(Boolean).join('\n');
await type(1, 'lua');
await type(1, 'rednet.open("back") id, msg = rednet.receive(20) print("got", id, msg)');
await type(0, 'lua');
await type(0, 'm = peripheral.wrap("top") m.setTextScale(1) m.setBackgroundColor(colors.blue) m.clear() m.setCursorPos(2,2) m.write("Hello from CraftOS!") return m.getSize()');
await type(0, 'rs.setOutput("left", true) return peripheral.getType("top"), peripheral.getType("right"), peripheral.getType("back")');
sim.handle({ t: 'disk', x: -1, y: 1, z: -3, action: 'insert', diskId: 'new' });
await wait(500);
await type(0, 'local f = fs.open("disk/hello", "w") f.write("on a floppy") f.close() return disk.isPresent("right"), disk.getMountPath("right"), disk.getID("right"), fs.exists("disk/hello")');
await type(0, 'rednet.open("back") return rednet.send(1, "ping over rednet")');
await wait(500);
console.log('--- computer 0 ---\n' + screen(0));
console.log('--- computer 1 ---\n' + screen(1));
const mon = msgs.filter((m) => m.t === 'monitorTerm').pop();
console.log('--- monitor ---\n' + mon.snap.text.map((l) => '|' + l).join('\n'));
console.log('patches:', JSON.stringify(msgs.filter((m) => m.t === 'patch')));
process.exit(0);
