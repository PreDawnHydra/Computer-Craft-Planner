// Three.js view of the world: one mesh per block with Minecraft-style per-face shading,
// a sky, fog, and the black selection outline.
import * as THREE from 'three';
import { BLOCKS, DIRS, faceTextures } from './blocks.js';
import { getMaterial } from './textures.js';
import { TerminalRenderer } from '../ui/TerminalRenderer.js';

// Minecraft's directional face brightness: top 1.0, bottom 0.5, north/south 0.8, east/west 0.6
const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];

function shadedBox() {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const colors = [];
  // BoxGeometry has 4 vertices per face in material order
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) colors.push(FACE_SHADE[f], FACE_SHADE[f], FACE_SHADE[f]);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.translate(0.5, 0.5, 0.5);
  return geo;
}

// A box from (x0,y0,z0) to (x1,y1,z1) in 1/16ths, block-local, with shaded faces
function partBox(x0, y0, z0, x1, y1, z1) {
  const g = shadedBox();
  g.translate(-0.5, -0.5, -0.5);
  g.scale((x1 - x0) / 16, (y1 - y0) / 16, (z1 - z0) / 16);
  g.translate((x0 + x1) / 32, (y0 + y1) / 32, (z0 + z1) / 32);
  return g;
}

// Block-local object (0..1 cube space) for a block: a cube, a modem-style plate, or a lever
export function buildBlockObject(def, block, cube) {
  const tex = faceTextures(def, block);
  const mat = (id) => getMaterial(id, !!def.transparent);
  if (!def.model) return new THREE.Mesh(cube, tex.map(mat));
  // plate models are built facing -z (attached to the block at -z), then turned toward block.facing
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.set(-0.5, -0.5, -0.5);
  const f = { ...def.faces, ...(block.on && def.onFaces ? def.onFaces : {}) };
  if (def.model === 'plate') {
    const mats = [f.side, f.side, f.side, f.side, f.front, f.back].map(mat);
    inner.add(new THREE.Mesh(partBox(2, 2, 0, 14, 14, 3), mats));
  } else if (def.model === 'lever') {
    inner.add(new THREE.Mesh(partBox(5, 4, 0, 11, 12, 3), mat(f.side)));
    const stick = new THREE.Mesh(partBox(7, 7, 0, 9, 9, 10), mat(f.stick));
    const pivot = new THREE.Group();
    pivot.position.set(8 / 16, 8 / 16, 2 / 16);
    stick.position.set(-8 / 16, -8 / 16, 0);
    pivot.add(stick);
    pivot.rotation.x = block.on ? 0.7 : -0.7;
    inner.add(pivot);
  }
  group.add(inner);
  const dir = new THREE.Vector3(...DIRS[block.facing ?? 5]);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  const outer = new THREE.Group();
  group.position.set(0.5, 0.5, 0.5);
  outer.add(group);
  return outer;
}

const CHUNK = 16;
const chunkKey = (x, y, z) => Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK) + ',' + Math.floor(z / CHUNK);

// Per-face vertex positions, uvs and indices of a unit cube at the origin, in BoxGeometry face order
function faceTemplate() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0.5, 0.5, 0.5);
  const pos = g.attributes.position.array, uv = g.attributes.uv.array, idx = g.index.array;
  return g.groups.map((gr) => {
    const verts = [...new Set(Array.from(idx.slice(gr.start, gr.start + gr.count)))].sort((a, b) => a - b);
    const first = verts[0];
    return {
      pos: verts.flatMap((v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]),
      uv: verts.flatMap((v) => [uv[v * 2], uv[v * 2 + 1]]),
      idx: Array.from(idx.slice(gr.start, gr.start + gr.count)).map((i) => i - first),
    };
  });
}

export class WorldRenderer {
  constructor(canvas, world) {
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    const sky = new THREE.Color('#7ba4ff');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(new THREE.Color('#b7d0ff'), 48, 128);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
    this.geometry = shadedBox();
    this.meshes = new Map();
    this.monitorConn = new Map(); // block key -> connected texture suffix
    this.chunkBlocks = new Map(); // chunk key -> Set(block key)
    this.chunkMeshes = new Map(); // chunk key -> Group
    this.dirty = new Set();
    this.faceTemplate = faceTemplate();
    this.screens = new Map();     // monitor group key -> { mesh, renderer, canvas, texture }

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    edges.translate(0.5, 0.5, 0.5);
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
    this.outline.visible = false;
    this.scene.add(this.outline);

    for (const [x, y, z, b] of world.entries()) this.update(x, y, z, b);
    world.onChange((x, y, z, b) => this.update(x, y, z, b));
  }

  // Cubes are merged into per-chunk meshes (one per texture) with hidden faces culled;
  // only non-cube models (modems, levers) get their own mesh.
  update(x, y, z, block) {
    const k = this.world.key(x, y, z);
    const old = this.meshes.get(k);
    if (old) { this.scene.remove(old); this.meshes.delete(k); }
    const ck = chunkKey(x, y, z);
    if (!this.chunkBlocks.has(ck)) this.chunkBlocks.set(ck, new Set());
    if (block) this.chunkBlocks.get(ck).add(k); else this.chunkBlocks.get(ck).delete(k);
    this.dirty.add(ck);
    // faces of neighbours in other chunks may appear or disappear
    for (const d of DIRS) this.dirty.add(chunkKey(x + d[0], y + d[1], z + d[2]));
    if (!block) return;
    const def = BLOCKS[block.type];
    if (!def || !def.model) return;
    const mesh = buildBlockObject(def, block, this.geometry);
    mesh.position.set(x, y, z);
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    if (def.transparent) mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.meshes.set(k, mesh);
  }

  // Monitor groups from the simulation: connected textures + one screen per group
  setMonitorGroups(groups) {
    const conn = new Map();
    for (const g of groups) for (const [x, y, z, suffix] of g.cells) conn.set(this.world.key(x, y, z), suffix);
    const changed = new Set([...conn.keys(), ...this.monitorConn.keys()].filter((k) => conn.get(k) !== this.monitorConn.get(k)));
    this.monitorConn = conn;
    for (const k of changed) {
      const [x, y, z] = k.split(',').map(Number);
      this.update(x, y, z, this.world.get(x, y, z));
    }
    const keep = new Set(groups.map((g) => g.key));
    for (const [k, s] of this.screens) if (!keep.has(k)) { this.scene.remove(s.mesh); s.texture.dispose(); this.screens.delete(k); }
    this.groups = new Map(groups.map((g) => [g.key, g]));
    for (const g of groups) if (!this.screens.has(g.key)) this.addScreen(g);
  }

  addScreen(g) {
    const canvas = document.createElement('canvas');
    const renderer = new TerminalRenderer(canvas, { scale: 2, colour: g.type === 'monitor_advanced' });
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    const border = 2 / 16;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(g.w - 2 * border, g.h - 2 * border), new THREE.MeshBasicMaterial({ map: texture }));
    const fwd = new THREE.Vector3(...DIRS[g.facing]);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, fwd);
    const [ox, oy, oz] = g.origin;
    const center = new THREE.Vector3(ox + 0.5, oy + 0.5, oz + 0.5)
      .addScaledVector(right, (g.w - 1) / 2).addScaledVector(up, -(g.h - 1) / 2).addScaledVector(fwd, 0.5 + 0.002);
    mesh.position.copy(center);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
    this.scene.add(mesh);
    const s = { mesh, renderer, canvas, texture, g };
    renderer.draw = ((orig) => function () { orig.call(this); texture.needsUpdate = true; })(renderer.draw);
    this.screens.set(g.key, s);
    if (this.pendingTerms?.has(g.key)) { renderer.update(this.pendingTerms.get(g.key)); this.pendingTerms.delete(g.key); }
  }

  setMonitorTerm(k, snap) {
    const s = this.screens.get(k);
    if (s) s.renderer.update(snap);
    else (this.pendingTerms ||= new Map()).set(k, snap);
  }

  // Which monitor group (and where on it, 0..1 from top-left) a world-space point on a monitor front is
  monitorPoint(pos, point) {
    const k = this.world.key(...pos);
    if (!this.monitorConn.has(k)) return null;
    for (const g of this.groups?.values() || []) {
      if (!g.cells.some(([x, y, z]) => x === pos[0] && y === pos[1] && z === pos[2])) continue;
      const fwd = new THREE.Vector3(...DIRS[g.facing]);
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(up, fwd);
      const [ox, oy, oz] = g.origin;
      const corner = new THREE.Vector3(ox + 0.5, oy + 0.5, oz + 0.5).addScaledVector(right, -0.5).addScaledVector(up, 0.5);
      const d = new THREE.Vector3().subVectors(point, corner);
      return { group: g, u: d.dot(right) / g.w, v: -d.dot(up) / g.h, facing: g.facing };
    }
    return null;
  }

  setSelection(pos) {
    if (!pos) { this.outline.visible = false; return; }
    this.outline.visible = true;
    this.outline.position.set(pos[0], pos[1], pos[2]);
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  isOccluder(x, y, z) {
    const b = this.world.get(x, y, z);
    if (!b) return false;
    const def = BLOCKS[b.type];
    return !!def && !def.model && !def.transparent;
  }

  rebuildChunk(ck) {
    const old = this.chunkMeshes.get(ck);
    if (old) { this.scene.remove(old); old.traverse((o) => o.geometry?.dispose()); this.chunkMeshes.delete(ck); }
    const keys = this.chunkBlocks.get(ck);
    if (!keys || !keys.size) return;
    const buckets = new Map(); // texture id + transparency -> { pos, uv, col, idx }
    for (const k of keys) {
      const b = this.world.blocks.get(k);
      if (!b) continue;
      const def = BLOCKS[b.type];
      if (!def || def.model) continue;
      const [x, y, z] = k.split(',').map(Number);
      const conn = def.monitor ? this.monitorConn.get(k) : undefined;
      const tex = faceTextures(def, conn !== undefined ? { ...b, conn } : b);
      for (let f = 0; f < 6; f++) {
        const d = DIRS[f];
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if (this.isOccluder(nx, ny, nz)) continue;
        if (def.transparent) { const n = this.world.get(nx, ny, nz); if (n && n.type === b.type) continue; }
        const bk = tex[f] + (def.transparent ? '|t' : '');
        if (!buckets.has(bk)) buckets.set(bk, { id: tex[f], transparent: !!def.transparent, pos: [], uv: [], col: [], idx: [] });
        const bu = buckets.get(bk);
        const t = this.faceTemplate[f];
        const base = bu.pos.length / 3;
        for (let v = 0; v < 4; v++) {
          bu.pos.push(t.pos[v * 3] + x, t.pos[v * 3 + 1] + y, t.pos[v * 3 + 2] + z);
          bu.uv.push(t.uv[v * 2], t.uv[v * 2 + 1]);
          bu.col.push(FACE_SHADE[f], FACE_SHADE[f], FACE_SHADE[f]);
        }
        for (const i of t.idx) bu.idx.push(base + i);
      }
    }
    const group = new THREE.Group();
    for (const bu of buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bu.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(bu.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(bu.col, 3));
      g.setIndex(bu.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, getMaterial(bu.id, bu.transparent));
      if (bu.transparent) m.renderOrder = 1;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
    group.matrixAutoUpdate = false;
    this.scene.add(group);
    this.chunkMeshes.set(ck, group);
  }

  render() {
    for (const ck of this.dirty) this.rebuildChunk(ck);
    this.dirty.clear();
    this.renderer.render(this.scene, this.camera);
  }
}

// Renders an isometric inventory icon for a block type, like Minecraft's item rendering
export class IconRenderer {
  constructor(size = 64) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setSize(size, size, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-0.85, 0.85, 0.85, -0.85, 0.1, 10);
    this.camera.position.set(2, 1.63, 2);
    this.camera.lookAt(0, 0, 0);
    this.cube = shadedBox();
    this.cache = new Map();
  }

  // returns a data URL; draws again later if textures were still loading
  icon(type, onUpdate) {
    const def = BLOCKS[type];
    const obj = buildBlockObject(def, { facing: def.attach ? 5 : 4 }, this.cube);
    obj.position.set(-0.5, -0.5, -0.5);
    const draw = () => {
      const mesh = obj;
      this.scene.add(mesh);
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(mesh);
      return this.canvas.toDataURL();
    };
    const url = draw();
    if (onUpdate) setTimeout(() => onUpdate(draw()), 300);
    return url;
  }
}
