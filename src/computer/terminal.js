// Terminal buffer, matching ComputerCraft's dan200.computercraft.core.terminal.Terminal.
// Colours are stored per cell as hex digits '0'-'f' (log2 of the CC colour value).
const HEX = '0123456789abcdef';

export class Terminal {
  constructor(width = 51, height = 19) {
    this.width = width;
    this.height = height;
    this.cursorX = 0;
    this.cursorY = 0;
    this.cursorBlink = false;
    this.textColour = 0;      // white
    this.backgroundColour = 15; // black
    this.reset();
  }

  reset() {
    this.cursorX = 0; this.cursorY = 0; this.cursorBlink = false;
    this.textColour = 0; this.backgroundColour = 15;
    this.text = []; this.fg = []; this.bg = [];
    for (let y = 0; y < this.height; y++) this.blankLine(y);
    this.dirty = true;
  }

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    const ot = this.text, of = this.fg, ob = this.bg, oh = this.height;
    this.width = w; this.height = h;
    this.text = []; this.fg = []; this.bg = [];
    for (let y = 0; y < h; y++) {
      if (y < oh) {
        this.text[y] = (ot[y] + ' '.repeat(w)).slice(0, w);
        this.fg[y] = (of[y] + '0'.repeat(w)).slice(0, w);
        this.bg[y] = (ob[y] + 'f'.repeat(w)).slice(0, w);
      } else this.blankLine(y);
    }
    this.dirty = true;
  }

  blankLine(y) {
    this.text[y] = ' '.repeat(this.width);
    this.fg[y] = HEX[this.textColour].repeat(this.width);
    this.bg[y] = HEX[this.backgroundColour].repeat(this.width);
  }

  setCursorPos(x, y) {
    if (x !== this.cursorX || y !== this.cursorY) { this.cursorX = x; this.cursorY = y; this.dirty = true; }
  }

  setCursorBlink(b) { if (b !== this.cursorBlink) { this.cursorBlink = b; this.dirty = true; } }

  write(str) { this.blit(str, HEX[this.textColour].repeat(str.length), HEX[this.backgroundColour].repeat(str.length)); }

  blit(str, fg, bg) {
    let x = this.cursorX;
    const y = this.cursorY;
    const len = str.length;
    if (y >= 0 && y < this.height && x < this.width && x + len > 0) {
      let start = 0, end = len;
      if (x < 0) start = -x;
      if (x + len > this.width) end = this.width - x;
      const sx = x + start, ex = x + end;
      const put = (line, src) => line.slice(0, sx) + src.slice(start, end) + line.slice(ex);
      this.text[y] = put(this.text[y], str);
      this.fg[y] = put(this.fg[y], fg);
      this.bg[y] = put(this.bg[y], bg);
    }
    this.cursorX = x + len;
    this.dirty = true;
  }

  scroll(n) {
    if (n === 0) return;
    const t = [], f = [], b = [];
    for (let y = 0; y < this.height; y++) {
      const oy = y + n;
      if (oy >= 0 && oy < this.height) { t[y] = this.text[oy]; f[y] = this.fg[oy]; b[y] = this.bg[oy]; }
      else { t[y] = null; }
    }
    this.text = t; this.fg = f; this.bg = b;
    for (let y = 0; y < this.height; y++) if (t[y] === null) this.blankLine(y);
    this.dirty = true;
  }

  clear() {
    for (let y = 0; y < this.height; y++) this.blankLine(y);
    this.dirty = true;
  }

  clearLine() {
    if (this.cursorY >= 0 && this.cursorY < this.height) { this.blankLine(this.cursorY); this.dirty = true; }
  }

  snapshot() {
    return {
      width: this.width, height: this.height,
      text: this.text.slice(), fg: this.fg.slice(), bg: this.bg.slice(),
      cursorX: this.cursorX, cursorY: this.cursorY, cursorBlink: this.cursorBlink,
      textColour: this.textColour,
    };
  }
}

export { HEX };
