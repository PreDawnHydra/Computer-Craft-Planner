import { Simulation } from './sim.js';
import rom from '../generated/rom.json';

let sim = null;
self.onmessage = (e) => {
  if (!sim) sim = new Simulation((m) => self.postMessage(m), { rom });
  sim.handle(e.data);
};
