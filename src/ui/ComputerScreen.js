// The computer GUI: ComputerCraft's frame texture around a terminal canvas,
// with keyboard, mouse, paste and the Ctrl+T / Ctrl+R / Ctrl+S hold shortcuts.
import { TerminalRenderer, FONT_W, FONT_H, MARGIN } from './TerminalRenderer.js';
import { lwjglKey } from './keys.js';

const FRAME = {
  normal: 'assets/computercraft/textures/gui/corners.png',
  advanced: 'assets/computercraft/textures/gui/corners2.png',
  command: 'assets/computercraft/textures/gui/cornersCommand.png',
};
const imgCache = new Map();
function loadImg(src) {
  if (!imgCache.has(src)) {
    imgCache.set(src, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }));
  }
  return imgCache.get(src);
}

export class ComputerScreen {
  constructor(handle, { family = 'advanced', width = 51, height = 19 } = {}) {
    this.handle = handle;
    this.family = family;
    this.colour = family !== 'normal';
    this.termW = width; this.termH = height;
    this.scale = 2;

    this.el = document.createElement('div');
    this.el.className = 'cc-screen';
    this.el.tabIndex = 0;
    this.frame = document.createElement('canvas');
    this.frame.className = 'cc-frame';
    this.term = document.createElement('canvas');
    this.term.className = 'cc-term';
    this.el.append(this.frame, this.term);

    this.renderer = new TerminalRenderer(this.term, { scale: this.scale, colour: this.colour });
    handle.on('term', (snap) => {
      if (snap.width !== this.termW || snap.height !== this.termH) { this.termW = snap.width; this.termH = snap.height; this.layout(); }
      this.renderer.update(snap);
    });
    this.blinkTimer = setInterval(() => this.renderer.setBlink(Math.floor(Date.now() / 400) % 2 === 0), 100);

    this.bindInput();
    this.layout();
  }

  setScale(scale) {
    if (scale === this.scale) return;
    this.scale = scale;
    this.renderer.scale = scale;
    this.layout();
    this.renderer.draw();
  }

  // Largest integer scale that fits the given box
  fit(maxW, maxH) {
    const w = this.termW * FONT_W + MARGIN * 2 + 24, h = this.termH * FONT_H + MARGIN * 2 + 28;
    this.setScale(Math.max(1, Math.min(4, Math.floor(Math.min(maxW / w, maxH / h)))));
  }

  layout() {
    const s = this.scale;
    const tw = this.termW * FONT_W + MARGIN * 2, th = this.termH * FONT_H + MARGIN * 2;
    this.frame.width = (tw + 24) * s; this.frame.height = (th + 28) * s;
    this.el.style.width = this.frame.width + 'px';
    this.el.style.height = this.frame.height + 'px';
    this.term.style.left = 12 * s + 'px';
    this.term.style.top = 12 * s + 'px';
    this.term.style.width = tw * s + 'px';
    this.term.style.height = th * s + 'px';
    this.drawFrame(tw, th);
  }

  async drawFrame(tw, th) {
    const img = await loadImg(FRAME[this.family]);
    const g = this.frame.getContext('2d');
    const s = this.scale;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, this.frame.width, this.frame.height);
    const blit = (dx, dy, u, v, w, h) => g.drawImage(img, u, v, w, h, dx * s, dy * s, w * s, h * s);
    // tile a strip like GL_REPEAT does in GuiComputer
    const tileX = (dx, dy, u, v, w, h, total) => { for (let x = 0; x < total; x += w) blit(dx + x, dy, u, v, Math.min(w, total - x), h); };
    const tileY = (dx, dy, u, v, w, h, total) => { for (let y = 0; y < total; y += h) blit(dx, dy + y, u, v, w, Math.min(h, total - y)); };
    const sx = 12, sy = 12, ex = 12 + tw, ey = 12 + th;
    tileX(sx, sy - 12, 0, 0, 256, 12, tw);
    tileX(sx, ey, 0, 12, 256, 16, tw);
    tileY(sx - 12, sy, 0, 28, 12, 228, th);
    tileY(ex, sy, 36, 28, 12, 228, th);
    blit(sx - 12, sy - 12, 12, 28, 12, 12);
    blit(sx - 12, ey, 12, 40, 12, 16);
    blit(ex, sy - 12, 24, 28, 12, 12);
    blit(ex, ey, 24, 40, 12, 16);
  }

  bindInput() {
    const h = this.handle;
    const held = new Map(); // shortcut key -> timer
    const shortcut = { KeyT: () => h.queueEvent('terminate'), KeyR: () => h.reboot(), KeyS: () => h.shutdown() };

    this.el.addEventListener('keydown', (e) => {
      const code = lwjglKey(e);
      const isPaste = (e.ctrlKey || e.metaKey) && e.code === 'KeyV';
      if (!isPaste) e.preventDefault();
      if (e.ctrlKey && shortcut[e.code] && !held.has(e.code)) {
        held.set(e.code, setTimeout(() => { held.delete(e.code); shortcut[e.code](); }, 1000));
      }
      if (code) h.queueEvent('key', code, e.repeat);
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        const c = e.key.charCodeAt(0);
        if (c >= 32 && c < 256 && c !== 127) h.queueEvent('char', e.key);
      }
    });
    this.el.addEventListener('keyup', (e) => {
      e.preventDefault();
      if (held.has(e.code)) { clearTimeout(held.get(e.code)); held.delete(e.code); }
      if (e.key === 'Control') { for (const t of held.values()) clearTimeout(t); held.clear(); }
      const code = lwjglKey(e);
      if (code) h.queueEvent('key_up', code);
    });
    this.el.addEventListener('blur', () => { for (const t of held.values()) clearTimeout(t); held.clear(); });
    this.el.addEventListener('paste', (e) => {
      e.preventDefault();
      let text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      text = text.split(/\r?\n/)[0];
      text = [...text].filter(ch => { const c = ch.charCodeAt(0); return c >= 32 && c < 256 && c !== 127; }).join('').slice(0, 512);
      if (text) h.queueEvent('paste', text);
    });

    // Mouse (advanced computers only)
    let down = null, last = null;
    const cell = (e) => {
      const r = this.term.getBoundingClientRect();
      return this.renderer.cellAt((e.clientX - r.left) * (this.term.width / r.width), (e.clientY - r.top) * (this.term.height / r.height));
    };
    const btn = (b) => (b === 0 ? 1 : b === 2 ? 2 : 3);
    this.term.addEventListener('contextmenu', (e) => e.preventDefault());
    this.term.addEventListener('mousedown', (e) => {
      this.el.focus();
      e.preventDefault();
      if (!this.colour) return;
      const c = cell(e); if (!c) return;
      down = btn(e.button); last = c;
      h.queueEvent('mouse_click', down, c[0], c[1]);
    });
    window.addEventListener('mousemove', (e) => {
      if (down === null) return;
      const c = cell(e); if (!c) return;
      if (c[0] !== last[0] || c[1] !== last[1]) { last = c; h.queueEvent('mouse_drag', down, c[0], c[1]); }
    });
    window.addEventListener('mouseup', (e) => {
      if (down === null) return;
      const c = cell(e) || last;
      h.queueEvent('mouse_up', down, c[0], c[1]);
      down = null;
    });
    this.term.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.colour) return;
      const c = cell(e); if (!c) return;
      h.queueEvent('mouse_scroll', e.deltaY > 0 ? 1 : -1, c[0], c[1]);
    }, { passive: false });
  }

  focus() { this.el.focus(); }
  destroy() { clearInterval(this.blinkTimer); this.el.remove(); }
}
