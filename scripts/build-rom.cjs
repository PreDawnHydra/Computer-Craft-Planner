// Bundles vendor/computercraft (bios.lua + rom/) into src/generated/rom.json as byte strings.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'vendor', 'computercraft');
const out = { bios: fs.readFileSync(path.join(root, 'bios.lua')).toString('latin1'), files: {} };
(function walk(dir, rel) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name), r = rel ? rel + '/' + name : name;
    if (fs.statSync(p).isDirectory()) { out.files[r] = null; walk(p, r); }
    else out.files[r] = fs.readFileSync(p).toString('latin1');
  }
})(path.join(root, 'rom'), '');
fs.mkdirSync(path.join(__dirname, '..', 'src', 'generated'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'src', 'generated', 'rom.json'), JSON.stringify(out));
console.log('rom.json:', Object.keys(out.files).length, 'entries');
