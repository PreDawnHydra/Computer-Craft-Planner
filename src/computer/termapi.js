// term API, shared by computers and monitors.
import { LuaError, argStr, argNum, argBool, fmtNum } from './luabridge.js';

function parseColour(args, i) {
    const c = argNum(args, i, 'number');
    if (c <= 0) throw new LuaError('Colour out of range');
    const idx = Math.floor(Math.log2(c));
    if (idx < 0 || idx > 15) throw new LuaError('Colour out of range');
    return idx;
  }

// term API methods over any Terminal (computers and monitors share it)
export function makeTermApi(t, isColour) {
    const setText = (a) => {
      const c = parseColour(a, 0);
      if (!isColour() && ![0, 7, 8, 15].includes(c)) throw new LuaError('Colour not supported');
      t.textColour = c;
    };
    const setBack = (a) => {
      const c = parseColour(a, 0);
      if (!isColour() && ![0, 7, 8, 15].includes(c)) throw new LuaError('Colour not supported');
      t.backgroundColour = c;
    };
    const colourQ = () => isColour();
    const getText = () => 1 << t.textColour;
    const getBack = () => 1 << t.backgroundColour;
    return {
      write: (a) => {
        let s = a[0];
        s = s === null || s === undefined ? '' : (typeof s === 'number' ? fmtNum(s) : String(s));
        t.write(s.replace(/[\t]/g, ' '));
      },
      blit: (a) => {
        const s = argStr(a, 0, 'string, string, string');
        const fg = argStr(a, 1, 'string, string, string');
        const bg = argStr(a, 2, 'string, string, string');
        if (fg.length !== s.length || bg.length !== s.length) throw new LuaError('Arguments must be the same length');
        t.blit(s, fg.toLowerCase(), bg.toLowerCase());
      },
      scroll: (a) => { t.scroll(Math.floor(argNum(a, 0, 'number'))); },
      setCursorPos: (a) => {
        const x = Math.floor(argNum(a, 0, 'number, number')), y = Math.floor(argNum(a, 1, 'number, number'));
        t.setCursorPos(x - 1, y - 1);
      },
      setCursorBlink: (a) => { t.setCursorBlink(argBool(a, 0, 'boolean')); },
      getCursorPos: () => [t.cursorX + 1, t.cursorY + 1],
      getSize: () => [t.width, t.height],
      clear: () => { t.clear(); },
      clearLine: () => { t.clearLine(); },
      setTextColour: setText, setTextColor: setText,
      setBackgroundColour: setBack, setBackgroundColor: setBack,
      isColour: colourQ, isColor: colourQ,
      getTextColour: getText, getTextColor: getText,
      getBackgroundColour: getBack, getBackgroundColor: getBack,
    };
  }
