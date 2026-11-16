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
copy('assets/computercraft/textures/blocks/computerFrontOnAdvanced.png');
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files));
console.log(files.length, 'files');
