// Block storage for the world: a sparse map of "x,y,z" -> { type, facing, id, on }.
export class World {
  constructor() {
    this.blocks = new Map();
    this.listeners = new Set();
    this.nextComputerId = 0;
  }
  key(x, y, z) { return x + ',' + y + ',' + z; }
  get(x, y, z) { return this.blocks.get(this.key(x, y, z)) || null; }
  set(x, y, z, block) {
    const k = this.key(x, y, z);
    const old = this.blocks.get(k) || null;
    if (block) this.blocks.set(k, block); else this.blocks.delete(k);
    for (const fn of this.listeners) fn(x, y, z, block, old);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  *entries() {
    for (const [k, b] of this.blocks) { const [x, y, z] = k.split(',').map(Number); yield [x, y, z, b]; }
  }
  toJSON() {
    return { version: 1, nextComputerId: this.nextComputerId, blocks: [...this.entries()].map(([x, y, z, b]) => [x, y, z, b]) };
  }
  load(data) {
    for (const [x, y, z] of [...this.entries()]) this.set(x, y, z, null);
    this.nextComputerId = data.nextComputerId || 0;
    for (const [x, y, z, b] of data.blocks) this.set(x, y, z, b);
  }
}

export function defaultWorld(world) {
  for (let x = -12; x < 12; x++) for (let z = -12; z < 12; z++) {
    world.set(x, -1, z, { type: 'stone' });
    world.set(x, 0, z, { type: 'grass' });
  }
  // a small starter setup: advanced computer with a 3x2 advanced monitor on top,
  // a disk drive on its right and a redstone lamp on its left
  world.set(0, 1, -3, { type: 'computer_advanced', facing: 4, id: world.nextComputerId++ });
  world.set(-1, 1, -3, { type: 'disk_drive', facing: 4 });
  world.set(1, 1, -3, { type: 'redstone_lamp' });
  for (let x = -1; x <= 1; x++) for (let y = 2; y <= 3; y++) world.set(x, y, -3, { type: 'monitor_advanced', facing: 4 });
}
