// Builds a web font from Minecraft's own font/ascii.png at runtime (with opentype.js),
// so every bit of page text uses the real Minecraft 1.7.10 font. Glyph widths follow
// FontRenderer: the rightmost lit column + 1px spacing; space is 4px.
import opentype from 'opentype.js';

const URL_ASCII = 'assets/minecraft/textures/font/ascii.png';
// Characters for ascii.png cells 0-31 and 128-255 (FontRenderer's charmap: CP437 with Minecraft's substitutions)
const LOW = 'ÀÁÂÈÊËÍÓÔÕÚßãõğİıŒœŞşŴŵžȇ';
const HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒ'
  + 'áíóúñÑªº¿®¬½¼¡«»'
  + '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐'
  + '└┴┬├─┼╞╟╚╔╩╦╠═╬╧'
  + '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀'
  + 'αβΓπΣσμτΦΘΩδ∞∅∈∩'
  + '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■';

function cellChar(i) {
  if (i < LOW.length) return LOW[i];
  if (i >= 32 && i < 127) return String.fromCharCode(i);
  if (i >= 128 && i - 128 < HIGH.length) return HIGH[i - 128];
  return null;
}

const U = 128; // font units per texture pixel; 8px cell = 1024 units per em

export async function buildMinecraftFont(url = URL_ASCII) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const cell = img.width / 16, px = (8 / cell) * U; // supports HD font textures too
  const lit = (x, y) => data[(y * c.width + x) * 4 + 3] > 16;
  const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 6 * U, path: new opentype.Path() })];

  for (let i = 0; i < 256; i++) {
    const ch = cellChar(i);
    if (!ch) continue;
    const x0 = (i % 16) * cell, y0 = Math.floor(i / 16) * cell;
    const path = new opentype.Path();
    let right = -1;
    for (let y = 0; y < cell; y++) {
      let run = -1;
      for (let x = 0; x <= cell; x++) {
        const on = x < cell && lit(x0 + x, y0 + y);
        if (on) { right = Math.max(right, x); if (run < 0) run = x; }
        else if (run >= 0) {
          // rectangle for the run [run, x) on row y; baseline sits under row 7 of 8
          const top = (7 - y * (8 / cell)) * U, bottom = top - px;
          path.moveTo(run * px, top); path.lineTo(run * px, bottom); path.lineTo(x * px, bottom); path.lineTo(x * px, top); path.close();
          run = -1;
        }
      }
    }
    const width = ch === ' ' ? 4 * U : (right + 1) * px + U;
    glyphs.push(new opentype.Glyph({ name: 'g' + i, unicode: ch.charCodeAt(0), advanceWidth: width, path }));
  }
  const font = new opentype.Font({
    familyName: 'Minecraft', styleName: 'Regular', unitsPerEm: 8 * U,
    ascender: 7 * U, descender: -1 * U, glyphs,
  });
  const face = new FontFace('Minecraft', font.toArrayBuffer());
  await face.load();
  document.fonts.add(face);
  return face;
}
