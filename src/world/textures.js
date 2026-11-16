// Loads block textures as nearest-filtered Three.js textures. Handles grass tinting,
// the grass side overlay, and a flat-colour fallback when Minecraft textures were not fetched.
import * as THREE from 'three';
import { GRASS_TINT } from './blocks.js';

const PATHS = { mc: 'assets/minecraft/textures/blocks/', cc: 'assets/computercraft/textures/blocks/' };
const images = new Map();
const textures = new Map();

function loadImage(src) {
  if (!images.has(src)) {
    images.set(src, new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    }));
  }
  return images.get(src);
}

function canvas16(w = 16, h = 16) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function tinted(img, colour, w, h) {
  const c = canvas16(w, h), g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = colour; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0, w, h);
  return c;
}

// Draw the texture for an id ("mc:grass_side#overlay") onto a canvas
export async function textureCanvas(id) {
  const [ref, mod] = id.split('#');
  const [ns, name] = ref.split(':');
  const img = await loadImage(PATHS[ns] + name + '.png');
  if (!img) {
    const c = canvas16(), g = c.getContext('2d');
    let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    g.fillStyle = `hsl(${h % 360}, 25%, 45%)`; g.fillRect(0, 0, 16, 16);
    g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
    return c;
  }
  // animated textures are vertical strips: use the first frame
  const w = img.width, h = Math.min(img.height, img.width);
  if (mod === 'tint') return tinted(img, GRASS_TINT, w, h);
  const c = canvas16(w, h), g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  if (mod === 'overlay') {
    const ov = await loadImage(PATHS[ns] + name + '_overlay.png');
    if (ov) g.drawImage(tinted(ov, GRASS_TINT, w, h), 0, 0);
  }
  return c;
}

export function getTexture(id) {
  if (!textures.has(id)) {
    const tex = new THREE.Texture();
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    textures.set(id, tex);
    textureCanvas(id).then((c) => { tex.image = c; tex.needsUpdate = true; });
  }
  return textures.get(id);
}

const materials = new Map();
export function getMaterial(id, transparent = false) {
  const key = id + (transparent ? '|t' : '');
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshBasicMaterial({
      map: getTexture(id), vertexColors: true,
      transparent, alphaTest: transparent ? 0.1 : 0, depthWrite: !transparent || true,
    }));
  }
  return materials.get(key);
}
