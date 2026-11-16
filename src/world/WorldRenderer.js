// Three.js view of the world: one mesh per block with Minecraft-style per-face shading,
// a sky, fog, and the black selection outline.
import * as THREE from 'three';
import { BLOCKS, faceTextures } from './blocks.js';
import { getMaterial } from './textures.js';

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

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    edges.translate(0.5, 0.5, 0.5);
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
    this.outline.visible = false;
    this.scene.add(this.outline);

    for (const [x, y, z, b] of world.entries()) this.update(x, y, z, b);
    world.onChange((x, y, z, b) => this.update(x, y, z, b));
  }

  update(x, y, z, block) {
    const k = this.world.key(x, y, z);
    const old = this.meshes.get(k);
    if (old) { this.scene.remove(old); this.meshes.delete(k); }
    if (!block) return;
    const def = BLOCKS[block.type];
    if (!def) return;
    const mats = faceTextures(def, block.facing ?? 4, !!block.on).map((id) => getMaterial(id, !!def.transparent));
    const mesh = new THREE.Mesh(this.geometry, mats);
    mesh.position.set(x, y, z);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (def.transparent) mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.meshes.set(k, mesh);
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

  render() { this.renderer.render(this.scene, this.camera); }
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
    this.camera.position.set(-2, 1.65, -2); // look at the block's south-west corner so the front (south) shows on the right
    this.camera.position.set(2, 1.63, 2);
    this.camera.lookAt(0, 0, 0);
    this.geometry = shadedBox();
    this.geometry.translate(-0.5, -0.5, -0.5);
    this.cache = new Map();
  }

  // returns a data URL; draws again later if textures were still loading
  icon(type, onUpdate) {
    const def = BLOCKS[type];
    const mats = faceTextures(def, 4, false).map((id) => getMaterial(id, !!def.transparent));
    const draw = () => {
      const mesh = new THREE.Mesh(this.geometry, mats);
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
