// Draws a CC terminal snapshot onto a canvas with ComputerCraft's own termFont.png,
// at an integer pixel scale, like the in-game GUI.
export const PALETTE = [
  0xf0f0f0, 0xf2b233, 0xe57fd8, 0x99b2f2, 0xdede6c, 0x7fcc19, 0xf2b2cc, 0x4c4c4c,
  0x999999, 0x4c99b2, 0xb266e5, 0x3366cc, 0x7f664c, 0x57a64e, 0xcc4c4c, 0x191919,
];
export const FONT_W = 6, FONT_H = 9, MARGIN = 2;
const css = (c) => '#' + c.toString(16).padStart(6, '0');
const greyOf = (c) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; const v = Math.round((r + g + b) / 3); return (v << 16) | (v << 8) | v; };

let fontPromise = null;
export function loadFont(url = 'assets/computercraft/textures/gui/termFont.png') {
  if (!fontPromise) {
    fontPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }
  return fontPromise;
}

// One tinted copy of the font per palette colour
function tintFont(img, palette) {
  return palette.map((c) => {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = css(c);
    g.fillRect(0, 0, cv.width, cv.height);
    return cv;
  });
}

export class TerminalRenderer {
  constructor(canvas, { scale = 2, colour = true } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = scale;
    this.colour = colour;
    this.snap = null;
    this.blinkOn = true;
    this.fonts = null;
    loadFont().then((img) => {
      const pal = colour ? PALETTE : PALETTE.map(greyOf);
      this.fonts = tintFont(img, pal);
      this.palette = pal;
      this.draw();
    });
    this.palette = colour ? PALETTE : PALETTE.map(greyOf);
  }

  pixelSize(w, h) {
    return [(w * FONT_W + MARGIN * 2) * this.scale, (h * FONT_H + MARGIN * 2) * this.scale];
  }

  update(snap) { this.snap = snap; this.draw(); }

  setBlink(on) { if (on !== this.blinkOn) { this.blinkOn = on; if (this.snap?.cursorBlink) this.draw(); } }

  draw() {
    const s = this.snap;
    if (!s) return;
    const { canvas, ctx, scale } = this;
    const [pw, ph] = this.pixelSize(s.width, s.height);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    ctx.imageSmoothingEnabled = false;
    const cw = FONT_W * scale, ch = FONT_H * scale, m = MARGIN * scale;
    // Backgrounds: edge cells stretch into the margin, like CC's WidgetTerminal
    for (let y = 0; y < s.height; y++) {
      const bg = s.bg[y];
      for (let x = 0; x < s.width; x++) {
        ctx.fillStyle = css(this.palette[parseInt(bg[x], 16) || 0]);
        let px = m + x * cw, py = m + y * ch, w = cw, h = ch;
        if (x === 0) { px -= m; w += m; }
        if (x === s.width - 1) w += m;
        if (y === 0) { py -= m; h += m; }
        if (y === s.height - 1) h += m;
        ctx.fillRect(px, py, w, h);
      }
    }
    if (!this.fonts) return;
    for (let y = 0; y < s.height; y++) {
      const text = s.text[y], fg = s.fg[y];
      for (let x = 0; x < s.width; x++) {
        const c = text.charCodeAt(x);
        if (c === 32 || c === 0) continue;
        this.glyph(c, parseInt(fg[x], 16) || 0, m + x * cw, m + y * ch);
      }
    }
    if (s.cursorBlink && this.blinkOn && s.cursorX >= 0 && s.cursorX < s.width && s.cursorY >= 0 && s.cursorY < s.height) {
      this.glyph(95, s.textColour, m + s.cursorX * cw, m + s.cursorY * ch);
    }
  }

  glyph(code, colour, px, py) {
    const col = code % 16, row = Math.floor(code / 16);
    this.ctx.drawImage(this.fonts[colour], col * FONT_W, row * FONT_H, FONT_W, FONT_H, px, py, FONT_W * this.scale, FONT_H * this.scale);
  }

  // Canvas pixel -> 1-based terminal cell
  cellAt(px, py) {
    const s = this.snap;
    if (!s) return null;
    const x = Math.floor((px / this.scale - MARGIN) / FONT_W) + 1;
    const y = Math.floor((py / this.scale - MARGIN) / FONT_H) + 1;
    return [Math.min(Math.max(x, 1), s.width), Math.min(Math.max(y, 1), s.height)];
  }
}
