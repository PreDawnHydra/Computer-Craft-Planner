// Boots CraftOS headlessly, types commands, and prints the screen.
import { Computer } from '../src/computer/computer.js';
import rom from '../src/generated/rom.json';
const LW = { enter: 28 };
let snap;
const c = new Computer({ id: 1, rom, onTerminal: s => { snap = s; } });
c.turnOn();
const wait = ms => new Promise(r => setTimeout(r, ms));
const type = async (str) => { for (const ch of str) c.queueEvent('char', [ch]); c.queueEvent('key', [LW.enter]); await wait(300); };
await wait(500);
const cmds = process.argv.slice(2);
for (const cmd of cmds) await type(cmd);
await wait(500);
console.log(snap.text.map(l => '|' + l).join('\n'));
c.shutdown();
process.exit(0);
