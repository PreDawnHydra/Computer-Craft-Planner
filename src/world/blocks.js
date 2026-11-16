// Block registry. Texture ids: "mc:name" -> Minecraft blocks/name.png, "cc:name" -> ComputerCraft blocks/name.png.
// Faces: top, bottom, side (default for all four sides), and optionally front/back for blocks with a facing.
const WOOL = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'silver', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const WOOL_NAMES = ['White', 'Orange', 'Magenta', 'Light Blue', 'Yellow', 'Lime', 'Pink', 'Gray', 'Light Gray', 'Cyan', 'Purple', 'Blue', 'Brown', 'Green', 'Red', 'Black'];
export const GRASS_TINT = '#91bd59'; // plains biome grass colour

export const BLOCKS = {
  computer: {
    name: 'Computer', group: 'ComputerCraft', facing: true, computer: 'normal',
    faces: { top: 'cc:computerTop', bottom: 'cc:computerTop', side: 'cc:computerSide', front: 'cc:computerFront' },
    onFaces: { front: 'cc:computerFrontOn' },
  },
  computer_advanced: {
    name: 'Advanced Computer', group: 'ComputerCraft', facing: true, computer: 'advanced',
    faces: { top: 'cc:computerTopAdvanced', bottom: 'cc:computerTopAdvanced', side: 'cc:computerSideAdvanced', front: 'cc:computerFrontAdvanced' },
    onFaces: { front: 'cc:computerFrontOnAdvanced' },
  },
  monitor: {
    name: 'Monitor', group: 'ComputerCraft', facing: true, monitor: 'monitor',
    faces: { front: 'cc:monitor15', side: 'cc:monitor4', top: 'cc:monitor0', back: 'cc:monitor4' },
  },
  monitor_advanced: {
    name: 'Advanced Monitor', group: 'ComputerCraft', facing: true, monitor: 'advMonitor',
    faces: { front: 'cc:advMonitor15', side: 'cc:advMonitor4', top: 'cc:advMonitor0', back: 'cc:advMonitor4' },
  },
  disk_drive: {
    name: 'Disk Drive', group: 'ComputerCraft', facing: true,
    faces: { front: 'cc:diskDriveFront', side: 'cc:diskDriveSide', top: 'cc:diskDriveTop', bottom: 'cc:diskDriveTop' },
    stateFaces: (b) => (b.disk != null ? { front: 'cc:diskDriveFrontAccepted' } : null),
  },
  modem: {
    name: 'Wireless Modem', group: 'ComputerCraft', model: 'plate', attach: true,
    faces: { front: 'cc:wirelessModemFace', back: 'cc:modemBack', side: 'cc:wirelessModemFace' },
    onFaces: { front: 'cc:wirelessModemFaceOn', side: 'cc:wirelessModemFaceOn' },
  },
  lever: {
    name: 'Lever', group: 'Redstone', model: 'lever', attach: true,
    faces: { side: 'mc:cobblestone', stick: 'mc:lever' },
  },
  grass: { name: 'Grass Block', group: 'Building', faces: { top: 'mc:grass_top#tint', bottom: 'mc:dirt', side: 'mc:grass_side#overlay' } },
  dirt: { name: 'Dirt', group: 'Building', faces: { side: 'mc:dirt' } },
  stone: { name: 'Stone', group: 'Building', faces: { side: 'mc:stone' } },
  cobblestone: { name: 'Cobblestone', group: 'Building', faces: { side: 'mc:cobblestone' } },
  stonebrick: { name: 'Stone Bricks', group: 'Building', faces: { side: 'mc:stonebrick' } },
  planks_oak: { name: 'Oak Wood Planks', group: 'Building', faces: { side: 'mc:planks_oak' } },
  planks_spruce: { name: 'Spruce Wood Planks', group: 'Building', faces: { side: 'mc:planks_spruce' } },
  planks_birch: { name: 'Birch Wood Planks', group: 'Building', faces: { side: 'mc:planks_birch' } },
  log_oak: { name: 'Oak Wood', group: 'Building', faces: { top: 'mc:log_oak_top', bottom: 'mc:log_oak_top', side: 'mc:log_oak' } },
  brick: { name: 'Bricks', group: 'Building', faces: { side: 'mc:brick' } },
  sandstone: { name: 'Sandstone', group: 'Building', faces: { top: 'mc:sandstone_top', bottom: 'mc:sandstone_bottom', side: 'mc:sandstone_normal' } },
  sand: { name: 'Sand', group: 'Building', faces: { side: 'mc:sand' } },
  glass: { name: 'Glass', group: 'Building', transparent: true, faces: { side: 'mc:glass' } },
  bookshelf: { name: 'Bookshelf', group: 'Building', faces: { top: 'mc:planks_oak', bottom: 'mc:planks_oak', side: 'mc:bookshelf' } },
  quartz_block: { name: 'Block of Quartz', group: 'Building', faces: { top: 'mc:quartz_block_top', bottom: 'mc:quartz_block_bottom', side: 'mc:quartz_block_side' } },
  obsidian: { name: 'Obsidian', group: 'Building', faces: { side: 'mc:obsidian' } },
  bedrock: { name: 'Bedrock', group: 'Building', faces: { side: 'mc:bedrock' } },
  iron_block: { name: 'Block of Iron', group: 'Building', faces: { side: 'mc:iron_block' } },
  gold_block: { name: 'Block of Gold', group: 'Building', faces: { side: 'mc:gold_block' } },
  diamond_block: { name: 'Block of Diamond', group: 'Building', faces: { side: 'mc:diamond_block' } },
  glowstone: { name: 'Glowstone', group: 'Building', faces: { side: 'mc:glowstone' } },
  redstone_block: { name: 'Block of Redstone', group: 'Redstone', faces: { side: 'mc:redstone_block' } },
  redstone_lamp: { name: 'Redstone Lamp', group: 'Redstone', faces: { side: 'mc:redstone_lamp_off' }, onFaces: { side: 'mc:redstone_lamp_on' } },
};
WOOL.forEach((c, i) => {
  BLOCKS['wool_' + c] = { name: WOOL_NAMES[i] + ' Wool', group: 'Wool', faces: { side: 'mc:wool_colored_' + c } };
});

export const DEFAULT_HOTBAR = ['computer_advanced', 'monitor_advanced', 'disk_drive', 'modem', 'redstone_lamp', 'lever', 'stone', 'planks_oak', 'glass'];

// ComputerCraft's connected monitor textures: suffix (l/r/u/d neighbours) -> [front, side, top, back] texture numbers
export const MONITOR_CONN = { '': [16, 4, 0, 4], d: [20, 36, 0, 36], l: [19, 4, 1, 33], ld: [31, 7, 1, 45], lr: [18, 4, 2, 34], lrd: [30, 7, 2, 46], lru: [24, 38, 2, 40], lrud: [27, 37, 2, 43], lu: [25, 38, 1, 39], lud: [28, 37, 1, 42], r: [17, 4, 3, 35], rd: [29, 7, 3, 47], ru: [23, 38, 3, 41], rud: [26, 37, 3, 44], u: [22, 38, 0, 38], ud: [21, 37, 0, 37] };

// Face directions in BoxGeometry material order: +x, -x, +y, -y, +z, -z
export const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// Horizontal facings (index into DIRS): 0 east(+x), 1 west(-x), 4 south(+z), 5 north(-z)
export const OPPOSITE = [1, 0, 3, 2, 5, 4];

// Texture id for each of the 6 box faces of a block (or of an item icon when block is omitted)
export function faceTextures(def, block = {}) {
  const facing = block.facing ?? 4;
  const f = { ...def.faces, ...(block.on && def.onFaces ? def.onFaces : {}), ...(def.stateFaces?.(block) || {}) };
  if (def.monitor && block.conn !== undefined) {
    const [front, side, top, back] = MONITOR_CONN[block.conn] || MONITOR_CONN[''];
    const t = (n) => 'cc:' + def.monitor + n;
    Object.assign(f, { front: t(front), side: t(side), top: t(top), bottom: t(top), back: t(back) });
  }
  const side = f.side;
  const out = [];
  for (let i = 0; i < 6; i++) {
    if (i === 2) out.push(f.top || side);
    else if (i === 3) out.push(f.bottom || side);
    else if (def.facing && i === facing) out.push(f.front || side);
    else if (def.facing && i === OPPOSITE[facing]) out.push(f.back || side);
    else out.push(side);
  }
  return out;
}
