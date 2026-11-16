// Voxel ray traversal (Amanatides & Woo). Returns the first solid block hit and the face normal.
export function raycast(world, origin, dir, maxDist = 6) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const inv = (d) => (d === 0 ? Infinity : Math.abs(1 / d));
  const tdx = inv(dir.x), tdy = inv(dir.y), tdz = inv(dir.z);
  const frac = (o, s) => (s > 0 ? Math.floor(o) + 1 - o : o - Math.floor(o));
  let tmx = dir.x === 0 ? Infinity : frac(origin.x, sx) * tdx;
  let tmy = dir.y === 0 ? Infinity : frac(origin.y, sy) * tdy;
  let tmz = dir.z === 0 ? Infinity : frac(origin.z, sz) * tdz;
  let normal = [0, 0, 0], t = 0;
  while (t <= maxDist) {
    if (world.get(x, y, z)) return { pos: [x, y, z], normal, dist: t };
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; normal = [-sx, 0, 0]; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; normal = [0, -sy, 0]; }
    else { z += sz; t = tmz; tmz += tdz; normal = [0, 0, -sz]; }
  }
  return null;
}
