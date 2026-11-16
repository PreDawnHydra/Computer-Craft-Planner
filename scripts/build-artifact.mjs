// Turns dist/ into a folder that can be published as a claude.ai Artifact:
// the page body without its own <html>/<head> skeleton, plus the files it references.
import fs from 'fs';
import path from 'path';
const dist = path.resolve('dist'), out = path.resolve('dist-artifact');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const keep = head.split('\n').filter(l => /<link|<script/.test(l) && !/rel="icon"/.test(l)).join('\n');
fs.writeFileSync(path.join(out, 'index.html'),
  `<title>ComputerCraft Emulator</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${keep}\n${body}`);
const files = [];
const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true }); fs.copyFileSync(path.join(dist, rel), path.join(out, rel)); files.push(rel); };
for (const f of fs.readdirSync(path.join(dist, 'assets'))) if (/\.(js|css)$/.test(f)) copy('assets/' + f);
for (const f of fs.readdirSync(path.join(dist, 'assets/computercraft/textures/gui'))) copy('assets/computercraft/textures/gui/' + f);
// block textures referenced by the block registry
const reg = fs.readFileSync(path.resolve('src/world/blocks.js'), 'utf8');
const wool = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'silver', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const mcNames = new Set([...reg.matchAll(/mc:([a-z_]+)/g)].map((m) => m[1]).concat(wool.map((c) => 'wool_colored_' + c), ['grass_side_overlay']));
const ccNames = new Set([...reg.matchAll(/cc:([A-Za-z_]+)/g)].map((m) => m[1]));
for (const n of mcNames) { const rel = 'assets/minecraft/textures/blocks/' + n + '.png'; if (fs.existsSync(path.join(dist, rel))) copy(rel); }
for (const n of ccNames) { const rel = 'assets/computercraft/textures/blocks/' + n + '.png'; if (fs.existsSync(path.join(dist, rel))) copy(rel); }
if (fs.existsSync(path.join(dist, 'assets/minecraft/textures/font/ascii.png'))) copy('assets/minecraft/textures/font/ascii.png');
for (const f of ['widgets.png', 'options_background.png']) if (fs.existsSync(path.join(dist, 'assets/minecraft/textures/gui', f))) copy('assets/minecraft/textures/gui/' + f);
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files));
console.log(files.length, 'files');
