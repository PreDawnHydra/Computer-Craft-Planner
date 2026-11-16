// The 3D planner: a creative-mode world where computers and blocks are placed and broken,
// and right-clicking a computer opens its CraftOS terminal.
import { World, defaultWorld } from './World.js';
import { WorldRenderer, IconRenderer } from './WorldRenderer.js';
import { Controls } from './Controls.js';
import { raycast } from './raycast.js';
import { BLOCKS, DEFAULT_HOTBAR, DIRS } from './blocks.js';
import { SimClient } from '../sim/SimClient.js';
import { ComputerScreen } from '../ui/ComputerScreen.js';
import { loadMeta, saveMeta } from '../computer/storage.js';

const SAVE_KEY = 'world/default';
const REACH = 6;

export class App {
  constructor(root) {
    this.root = root;
    this.world = new World();
    this.sim = new SimClient();
    this.disks = [];
    this.hotbar = DEFAULT_HOTBAR.slice();
    this.slot = 0;
    this.gui = null;
    this.buildDom();
  }

  async start() {
    const saved = await loadMeta(SAVE_KEY);
    this.renderer = new WorldRenderer(this.canvas, this.world);
    this.controls = new Controls(this.renderer.camera, this.canvas);
    if (saved && saved.world) {
      this.world.load(saved.world);
      this.controls.load(saved.camera);
      if (Array.isArray(saved.hotbar)) this.hotbar = saved.hotbar.filter((t) => BLOCKS[t]).concat(DEFAULT_HOTBAR).slice(0, 9);
    } else defaultWorld(this.world);

    // hand the world to the simulation, then keep it in sync
    this.sim.send({ t: 'load', blocks: [...this.world.entries()] });
    this.sim.send({ t: 'config', httpProxy: this.httpProxy() });
    this.world.onChange((x, y, z, b) => {
      if (!this.applyingPatch) this.sim.send({ t: 'set', x, y, z, block: b });
      this.scheduleSave();
    });
    this.sim.on('patch', (m) => {
      const b = this.world.get(m.x, m.y, m.z);
      if (!b) return;
      this.applyingPatch = true;
      this.world.set(m.x, m.y, m.z, { ...b, ...m.patch });
      this.applyingPatch = false;
    });
    this.sim.on('state', (m) => {
      for (const [x, y, z, b] of this.world.entries()) {
        if (b.id === m.id && BLOCKS[b.type]?.computer) {
          if (!!b.on !== m.on || (b.label ?? null) !== (m.label ?? null)) {
            this.applyingPatch = true;
            this.world.set(x, y, z, { ...b, on: m.on, label: m.label });
            this.applyingPatch = false;
          }
          break;
        }
      }
      if (this.gui?.handle?.id === m.id) this.gui.title.textContent = m.label || `Computer #${m.id}`;
    });
    this.sim.on('monitors', (m) => this.renderer.setMonitorGroups(m.groups));
    this.sim.on('monitorTerm', (m) => this.renderer.setMonitorTerm(m.key, m.snap));
    this.sim.on('disks', (m) => { this.disks = m.list; if (this.gui?.drive) this.openDrive(this.gui.drive); });

    this.icons = new IconRenderer(64);
    this.drawHotbar();
    this.bindInput();
    this.controls.onLockChange = (locked) => this.updateOverlay(locked);
    this.updateOverlay(false);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    setInterval(() => this.scheduleSave(), 5000);
    let last = performance.now(), lastDraw = 0;
    const frame = (t) => {
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      // With a GUI open the world behind it only changes on monitors, so a few frames
      // a second are enough and the GUI's own canvas stays responsive.
      if (!this.gui || t - lastDraw > 200) {
        lastDraw = t;
        this.controls.update(dt);
        this.updateSelection();
        this.renderer.render();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------- DOM ----------

  buildDom() {
    this.root.innerHTML = `
      <canvas class="world-canvas"></canvas>
      <div class="crosshair" hidden></div>
      <div class="hud-tip" hidden></div>
      <div class="hotbar"><div class="hotbar-slots"></div><div class="hotbar-sel"></div></div>
      <div class="overlay" hidden></div>`;
    this.canvas = this.root.querySelector('.world-canvas');
    this.crosshair = this.root.querySelector('.crosshair');
    this.tip = this.root.querySelector('.hud-tip');
    this.hotbarEl = this.root.querySelector('.hotbar');
    this.overlay = this.root.querySelector('.overlay');
  }

  resize() {
    const r = this.root.getBoundingClientRect();
    this.renderer.resize(Math.max(1, r.width), Math.max(1, r.height));
    if (this.gui?.screen) this.gui.screen.fit(r.width - 32, r.height - 32);
  }

  drawHotbar() {
    const slots = this.hotbarEl.querySelector('.hotbar-slots');
    slots.innerHTML = '';
    this.hotbar.forEach((type, i) => {
      const img = document.createElement('img');
      img.className = 'hotbar-icon';
      img.alt = BLOCKS[type]?.name || '';
      img.style.left = `calc(var(--hb-scale) * ${3 + i * 20}px)`;
      if (type) img.src = this.icons.icon(type, (url) => { img.src = url; });
      slots.append(img);
    });
    this.hotbarEl.querySelector('.hotbar-sel').style.left = `calc(var(--hb-scale) * ${-1 + this.slot * 20}px)`;
  }

  selectSlot(i) {
    this.slot = (i + 9) % 9;
    this.drawHotbar();
    const type = this.hotbar[this.slot];
    this.showTip(type ? BLOCKS[type].name : '');
  }

  showTip(text) {
    clearTimeout(this.tipTimer);
    this.tip.textContent = text;
    this.tip.hidden = !text;
    this.tipTimer = setTimeout(() => { this.tip.hidden = true; }, 2000);
  }

  // Pause menu when the mouse is released (pointer-lock mode only)
  updateOverlay(locked) {
    this.crosshair.hidden = !locked;
    if (this.gui) return;
    if (locked || !this.controls.lockSupported) { this.overlay.hidden = true; this.overlay.innerHTML = ''; return; }
    this.showMenu();
  }

  showMenu() {
    this.overlay.hidden = false;
    this.overlay.innerHTML = `
      <div class="mc-menu">
        <h1>ComputerCraft Planner</h1>
        <button class="mc-btn wide" data-act="play">Back to Game</button>
        <button class="mc-btn wide" data-act="inventory">Blocks (E)</button>
        <button class="mc-btn wide" data-act="http">HTTP Settings...</button>
        <button class="mc-btn wide" data-act="reset">Reset World</button>
        <p class="mc-help">WASD to fly, Space and Shift to go up and down, Ctrl to fly faster.<br>
        Left click breaks, right click places or opens a computer. Shift + right click places against a computer.<br>
        1-9 or the mouse wheel picks a block, middle click copies one. Esc frees the mouse.</p>
      </div>`;
    this.overlay.querySelector('[data-act=play]').onclick = () => this.resume();
    this.overlay.querySelector('[data-act=inventory]').onclick = () => this.openInventory();
    this.overlay.querySelector('[data-act=http]').onclick = () => this.showHttpSettings();
    const reset = this.overlay.querySelector('[data-act=reset]');
    reset.onclick = () => {
      if (reset.dataset.confirm) { this.resetWorld(); this.resume(); return; }
      reset.dataset.confirm = '1';
      reset.textContent = 'Click again to reset';
    };
  }

  // Optional CORS proxy for the http API, kept per browser. "{url}" marks where the
  // encoded address goes; without it the address is appended.
  httpProxy() {
    try { return localStorage.getItem('ccemu.httpProxy') || null; } catch (e) { return null; }
  }

  showHttpSettings() {
    this.overlay.innerHTML = `
      <div class="mc-menu">
        <h1>HTTP Settings</h1>
        <p class="mc-help">Browsers only let a page read sites that allow it (CORS), so many sites fail with http.get.
        A CORS proxy you trust fixes that. Leave this empty to connect directly.<br>
        Example: <code>https://corsproxy.io/?url={url}</code></p>
        <input class="mc-input" type="text" spellcheck="false" placeholder="Proxy address, with {url} where the address goes">
        <button class="mc-btn wide" data-act="save">Done</button>
      </div>`;
    const input = this.overlay.querySelector('input');
    input.value = this.httpProxy() || '';
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') save(); });
    const save = () => {
      const v = input.value.trim();
      try { if (v) localStorage.setItem('ccemu.httpProxy', v); else localStorage.removeItem('ccemu.httpProxy'); } catch (e) { /* storage blocked */ }
      this.sim.send({ t: 'config', httpProxy: v || null });
      this.showMenu();
    };
    this.overlay.querySelector('[data-act=save]').onclick = save;
    input.focus();
  }

  resume() {
    this.overlay.hidden = true;
    this.overlay.innerHTML = '';
    this.controls.enabled = true;
    if (!this.controls.lock()) this.updateOverlay(false);
  }

  // ---------- computers ----------

  openComputer(block) {
    const handle = this.sim.computer(block.id);
    if (!handle.state.on) handle.turnOn();
    const def = BLOCKS[block.type];
    this.controls.enabled = false;
    this.controls.keys.clear();
    this.controls.unlock();
    const wrap = document.createElement('div');
    wrap.className = 'gui-computer';
    const title = document.createElement('div');
    title.className = 'gui-title';
    title.textContent = block.label || `Computer #${block.id}`;
    const screen = new ComputerScreen(handle, { family: def.computer, onClose: () => this.closeGui() });
    wrap.append(title, screen.el);
    this.overlay.innerHTML = '';
    this.overlay.hidden = false;
    this.overlay.append(wrap);
    this.gui = { screen, handle, title };
    this.resize();
    screen.focus();
  }

  openInventory() {
    this.controls.enabled = false;
    this.controls.unlock();
    const groups = {};
    for (const [type, def] of Object.entries(BLOCKS)) (groups[def.group] ||= []).push(type);
    const panel = document.createElement('div');
    panel.className = 'mc-panel';
    panel.tabIndex = 0;
    panel.innerHTML = `<div class="mc-panel-title">Blocks</div>` + Object.entries(groups).map(([g, types]) => `
      <div class="mc-panel-group">${g}</div>
      <div class="mc-slots">${types.map((t) => `<button class="mc-slot" data-type="${t}" title="${BLOCKS[t].name}"><img alt="${BLOCKS[t].name}"></button>`).join('')}</div>`).join('')
      + `<p class="mc-help">Click a block to put it in the selected hotbar slot. Esc or E closes.</p>`;
    panel.querySelectorAll('.mc-slot').forEach((b) => {
      const img = b.querySelector('img');
      img.src = this.icons.icon(b.dataset.type, (url) => { img.src = url; });
      b.onclick = () => { this.hotbar[this.slot] = b.dataset.type; this.drawHotbar(); this.showTip(BLOCKS[b.dataset.type].name); this.scheduleSave(); };
    });
    panel.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); this.closeGui(); }
      if (/^Digit[1-9]$/.test(e.code)) this.selectSlot(+e.code.slice(5) - 1);
    });
    this.overlay.innerHTML = '';
    this.overlay.hidden = false;
    this.overlay.append(panel);
    this.gui = { panel };
    panel.focus();
  }

  // Disk drive GUI: insert a new or existing floppy disk, or eject the one inside
  openDrive(pos) {
    const b = this.world.get(...pos);
    if (!b) return;
    this.controls.enabled = false;
    this.controls.unlock();
    const panel = document.createElement('div');
    panel.className = 'mc-panel';
    panel.tabIndex = 0;
    const name = (d) => d.label ? `${d.label} (#${d.id})` : `Floppy Disk #${d.id}`;
    const inside = b.disk != null ? (this.disks.find((d) => d.id === b.disk) || { id: b.disk, label: null }) : null;
    const spare = this.disks.filter((d) => !d.inDrive);
    panel.innerHTML = `<div class="mc-panel-title">Disk Drive</div>` + (inside
      ? `<p>Contains <b>${escapeHtml(name(inside))}</b></p><button class="mc-btn wide" data-act="eject">Eject</button>`
      : `<p>The drive is empty.</p><button class="mc-btn wide" data-act="new">Insert a new floppy disk</button>`
        + (spare.length ? `<div class="mc-panel-group">Or insert a disk you made before</div><div class="mc-disk-list">${spare.map((d) => `<button class="mc-btn" data-disk="${d.id}">${escapeHtml(name(d))}</button>`).join('')}</div>` : ''))
      + `<p class="mc-help">Esc closes. Disks keep their files when ejected.</p>`;
    const send = (action, diskId) => this.sim.send({ t: 'disk', x: pos[0], y: pos[1], z: pos[2], action, diskId });
    panel.querySelector('[data-act=eject]')?.addEventListener('click', () => send('eject'));
    panel.querySelector('[data-act=new]')?.addEventListener('click', () => send('insert', 'new'));
    panel.querySelectorAll('[data-disk]').forEach((el) => el.addEventListener('click', () => send('insert', +el.dataset.disk)));
    panel.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); this.closeGui(); } });
    this.overlay.innerHTML = '';
    this.overlay.hidden = false;
    this.overlay.append(panel);
    this.gui = { panel, drive: pos };
    panel.focus();
  }

  closeGui() {
    if (!this.gui) return;
    this.gui.screen?.destroy();
    this.gui.drive = null;
    this.gui = null;
    this.overlay.innerHTML = '';
    this.overlay.hidden = true;
    this.controls.enabled = true;
    this.canvas.focus();
    if (!this.controls.lock()) this.updateOverlay(false);
  }

  // ---------- interaction ----------

  target(e) {
    const { origin, dir } = this.controls.ray(e?.clientX, e?.clientY);
    return raycast(this.world, origin, dir, REACH);
  }

  updateSelection() {
    if (this.gui) { this.renderer.setSelection(null); return; }
    const hit = this.target(this.controls.locked ? undefined : this.mouse);
    this.renderer.setSelection(hit ? hit.pos : null);
  }

  breakBlock(e) {
    const hit = this.target(e);
    if (hit) this.world.set(...hit.pos, null);
  }

  pickBlock(e) {
    const hit = this.target(e);
    if (!hit) return;
    const type = this.world.get(...hit.pos).type;
    const i = this.hotbar.indexOf(type);
    if (i >= 0) this.selectSlot(i);
    else { this.hotbar[this.slot] = type; this.drawHotbar(); this.showTip(BLOCKS[type].name); }
  }

  useBlock(e, sneaking) {
    const hit = this.target(e);
    if (!hit) return;
    const b = this.world.get(...hit.pos);
    if (!sneaking) {
      if (BLOCKS[b.type]?.computer) { this.openComputer(b); return; }
      if (b.type === 'disk_drive') { this.openDrive(hit.pos); return; }
      if (b.type === 'lever') { this.world.set(...hit.pos, { ...b, on: !b.on }); return; }
      if (b.type === 'monitor_advanced' || b.type === 'monitor') {
        const { origin, dir } = this.controls.ray(e?.clientX, e?.clientY);
        const point = origin.clone().addScaledVector(dir, hit.dist);
        const mp = this.renderer.monitorPoint(hit.pos, point);
        // only touches on the screen side count; clicking another face places a block
        if (mp && DIRS[mp.facing].every((v, i) => v === hit.normal[i])) {
          if (b.type === 'monitor_advanced') this.sim.send({ t: 'touch', x: hit.pos[0], y: hit.pos[1], z: hit.pos[2], u: mp.u, v: mp.v });
          return;
        }
      }
    }
    const type = this.hotbar[this.slot];
    if (!type) return;
    const p = [hit.pos[0] + hit.normal[0], hit.pos[1] + hit.normal[1], hit.pos[2] + hit.normal[2]];
    if (this.world.get(...p)) return;
    const cam = this.controls.pos;
    if (Math.floor(cam.x) === p[0] && Math.floor(cam.y) === p[1] && Math.floor(cam.z) === p[2]) return;
    const def = BLOCKS[type];
    const block = { type };
    if (def.attach) {
      // modems and levers stick to the face that was clicked
      block.facing = DIRS.findIndex((d) => d[0] === -hit.normal[0] && d[1] === -hit.normal[1] && d[2] === -hit.normal[2]);
    } else if (def.facing) {
      // front faces the player, like Minecraft
      const dx = cam.x - (p[0] + 0.5), dz = cam.z - (p[2] + 0.5);
      const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? [1, 0, 0] : [-1, 0, 0]) : (dz > 0 ? [0, 0, 1] : [0, 0, -1]);
      block.facing = DIRS.findIndex((d) => d[0] === dir[0] && d[1] === dir[1] && d[2] === dir[2]);
    }
    if (def.computer) block.id = this.world.nextComputerId++;
    this.world.set(...p, block);
  }

  bindInput() {
    const c = this.canvas;
    c.tabIndex = 0;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousemove', (e) => { this.mouse = { clientX: e.clientX, clientY: e.clientY }; });
    c.addEventListener('mousedown', (e) => {
      c.focus();
      if (this.gui) return;
      if (this.controls.lockSupported && !this.controls.locked) { this.resume(); return; }
      if (this.controls.locked) { this.click(e.button, undefined, e.shiftKey); return; }
      // free-cursor mode: a click acts, a drag looks around
      this.controls.dragging = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
    });
    window.addEventListener('mouseup', (e) => {
      const d = this.controls.dragging;
      if (!d) return;
      this.controls.dragging = null;
      if (!d.moved) this.click(d.button, e, e.shiftKey);
    });
    c.addEventListener('wheel', (e) => { e.preventDefault(); if (!this.gui) this.selectSlot(this.slot + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (this.gui) return;
      if (/^Digit[1-9]$/.test(e.code)) this.selectSlot(+e.code.slice(5) - 1);
      if (e.code === 'KeyE') this.openInventory();
    });
  }

  click(button, e, sneaking) {
    if (button === 0) this.breakBlock(e);
    else if (button === 2) this.useBlock(e, sneaking || this.controls.keys.has('ShiftLeft'));
    else if (button === 1) this.pickBlock(e);
  }

  // ---------- persistence ----------

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      saveMeta(SAVE_KEY, { world: this.world.toJSON(), camera: this.controls.toJSON(), hotbar: this.hotbar });
    }, 500);
  }

  resetWorld() {
    const keepId = this.world.nextComputerId;
    this.world.load({ blocks: [], nextComputerId: keepId });
    defaultWorld(this.world);
    this.controls.load({ pos: [0.5, 2.62, 3.5], yaw: 0, pitch: -0.2 });
    this.scheduleSave();
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
