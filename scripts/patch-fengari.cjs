// Patches fengari (Lua 5.3 in JS) so it behaves more like ComputerCraft's Lua 5.1:
//  - all numeric literals are floats (5.1 has only doubles), so 10/2 prints "5" and math does not wrap at 32 bits
//  - integer +,-,*,unary- promote to float instead of wrapping on overflow
// Idempotent: run on postinstall.
const fs = require('fs');
const path = require('path');
const dir = path.join(path.dirname(require.resolve('fengari/package.json')), 'src');
const MARK = '/*cc-patched*/';
function patch(file, pairs) {
  const p = path.join(dir, file);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(MARK)) return;
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(`patch-fengari: pattern not found in ${file}: ${a.slice(0, 60)}`);
    s = s.split(a).join(b);
  }
  fs.writeFileSync(p, MARK + '\n' + s);
  console.log('patched', file);
}
patch('llex.js', [[
`    if (obj.ttisinteger()) {
        seminfo.i = obj.value;
        return TK_INT;`,
`    if (obj.ttisinteger()) {
        let s_ = String.fromCharCode.apply(null, luaZ_buffer(ls.buff));
        seminfo.r = /^0[xX]/.test(s_) ? parseInt(s_.slice(2), 16) : Number(s_);
        if (isNaN(seminfo.r)) seminfo.r = obj.value;
        return TK_FLT;`]]);
const fix = (expr) => `{ let r_ = ${expr}; if ((r_|0) === r_) L.stack[ra].setivalue(r_); else L.stack[ra].setfltvalue(r_); }`;
patch('lvm.js', [
  ['L.stack[ra].setivalue((op1.value + op2.value)|0);', fix('op1.value + op2.value')],
  ['L.stack[ra].setivalue((op1.value - op2.value)|0);', fix('op1.value - op2.value')],
  ['L.stack[ra].setivalue(luaV_imul(op1.value, op2.value));', fix('op1.value * op2.value')],
  ['L.stack[ra].setivalue((-op.value)|0);', fix('-op.value')],
]);
patch('lobject.js', [['if (!LUA_COMPAT_FLOATSTRING && /^', 'if (false && /^'], [
`        let str = lua_number2str(obj.value);`,
`        let str = (function(n) { /* C printf %.14g, as Lua 5.1 tostring */
            if (n !== n) return (1/n < 0 || Object.is(n, -NaN)) ? 'nan' : 'nan';
            if (n === Infinity) return 'inf';
            if (n === -Infinity) return '-inf';
            if (n === 0) return Object.is(n, -0) ? '-0' : '0';
            let ex = n.toExponential(13), m = ex.split('e'), e = parseInt(m[1], 10);
            if (e < -4 || e >= 14) {
                let mant = m[0].indexOf('.') >= 0 ? m[0].replace(/0+$/, '').replace(/\\.$/, '') : m[0];
                return mant + 'e' + (e < 0 ? '-' : '+') + (Math.abs(e) < 10 ? '0' : '') + Math.abs(e);
            }
            let f = n.toFixed(Math.max(0, 13 - e));
            if (f.indexOf('.') >= 0) f = f.replace(/0+$/, '').replace(/\\.$/, '');
            return f;
        })(obj.value);`]]);
// Lua 5.1 truncates non-integral numbers passed where an integer is expected (string.sub(s, 1.5), ("%d"):format(2.5))
patch('lauxlib.js', [[
`    let d = lua_tointegerx(L, arg);
    if (d === false)
        interror(L, arg);
    return d;`,
`    let d = lua_tointegerx(L, arg);
    if (d === false) {
        let n = lua_tonumberx(L, arg);
        if (n === false) interror(L, arg);
        if (n !== n) n = 0;
        d = n < 0 ? Math.ceil(n) : Math.floor(n);
        if (d > 2147483647) d = 2147483647; else if (d < -2147483648) d = -2147483648;
    }
    return d;`]]);
