// Applies vanilla Minecraft GUI textures (button, dirt background) when they are present
// in public/assets/minecraft (fetched by scripts/fetch-minecraft-assets.sh). Falls back to the CSS look.
const BASE = 'assets/minecraft/textures/gui/';
const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
function crop(img, x, y, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
  return c.toDataURL();
}

export async function applyMinecraftTheme(root = document.documentElement) {
  try {
    const [widgets, bg] = await Promise.all([load(BASE + 'widgets.png'), load(BASE + 'options_background.png')]);
    // widgets.png: disabled button at y=46, normal at y=66, hover at y=86 (200x20 each)
    root.style.setProperty('--mc-btn', `url(${crop(widgets, 0, 66, 200, 20)})`);
    root.style.setProperty('--mc-btn-hover', `url(${crop(widgets, 0, 86, 200, 20)})`);
    // hotbar (182x22) and its selection frame (24x24)
    root.style.setProperty('--mc-hotbar', `url(${crop(widgets, 0, 0, 182, 22)})`);
    root.style.setProperty('--mc-hotbar-sel', `url(${crop(widgets, 0, 22, 24, 24)})`);
    root.style.setProperty('--mc-bg', `url(${crop(bg, 0, 0, bg.width, bg.height)})`);
    root.classList.add('mc-textures');
  } catch (e) {
    // textures not fetched; keep the CSS fallback
  }
  try {
    const { buildMinecraftFont } = await import('./mcFont.js');
    await buildMinecraftFont();
    root.classList.add('mc-font');
  } catch (e) {
    // font texture not available; keep the fallback font
  }
}
