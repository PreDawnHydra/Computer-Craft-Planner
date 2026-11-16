// The 3D planner: a creative-mode world where computers and blocks are placed and broken,
// and right-clicking a computer opens its CraftOS terminal.
import { World, defaultWorld } from './World.js';
import { WorldRenderer, IconRenderer } from './WorldRenderer.js';
import { Controls } from './Controls.js';
import { raycast } from './raycast.js';
import { BLOCKS, DEFAULT_HOTBAR, DIRS } from './blocks.js';
import { ComputerHandle } from '../computer/ComputerHandle.js';
import { ComputerScreen } from '../ui/ComputerScreen.js';
import { loadMeta, saveMeta } from '../computer/storage.js';

const SAVE_KEY = 'world/default';
const REACH = 6;

export class App {
  constructor(root) {
    this.root = root;
    this.world = new World();
    this.computers = new Map(); // id -> ComputerHandle
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

    // computers already in the world (start the ones that were on)
    for (const [, , , b] of this.world.entries()) if (BLOCKS[b.type]?.computer) this.spawnComputer(b);
    this.world.onChange((x, y, z, b, old) => {
      if (old && BLOCKS[old.type]?.computer && (!b || b.id !== old.id)) this.removeComputer(old.id);
      if (b && BLOCKS[b.type]?.computer && !this.computers.has(b.id)) this.spawnComputer(b);
      this.scheduleSave();
    });

    this.icons = new IconRenderer(64);
    this.drawHotbar();
    this.bindInput();
    this.controls.onLockChange = (locked) => this.updateOverlay(locked);
    this.updateOverlay(false);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    setInterval(() => this.scheduleSave(), 5000);
    let last = performance.now();
    const frame = (t) => {
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      this.controls.update(dt);
      this.updateSelection();
      this.renderer.render();
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
        <button class="mc-btn wide" data-act="reset">Reset World</button>
        <p class="mc-help">WASD to fly, Space and Shift to go up and down, Ctrl to fly faster.<br>
        Left click breaks, right click places or opens a computer. Shift + right click places against a computer.<br>
        1-9 or the mouse wheel picks a block, middle click copies one. Esc frees the mouse.</p>
      </div>`;
    this.overlay.querySelector('[data-act=play]').onclick = () => this.resume();
    this.overlay.querySelector('[data-act=inventory]').onclick = () => this.openInventory();
    const reset = this.overlay.querySelector('[data-act=reset]');
    reset.onclick = () => {
      if (reset.dataset.confirm) { this.resetWorld(); this.resume(); return; }
      reset.dataset.confirm = '1';
      reset.textContent = 'Click again to reset';
    };
  }

  resume() {
    this.overlay.hidden = true;
    this.overlay.innerHTML = '';
    this.controls.enabled = true;
    if (!this.controls.lock()) this.updateOverlay(false);
  }

  // ---------- computers ----------

  spawnComputer(block) {
    const def = BLOCKS[block.type];
    const handle = new ComputerHandle({ id: block.id, colour: def.computer !== 'normal', autoOn: !!block.on });
    handle.on('state', (st) => {
      for (const [x, y, z, b] of this.world.entries()) {
        if (b.id === block.id && BLOCKS[b.type]?.computer) {
          if (!!b.on !== st.on || b.label !== st.label) this.world.set(x, y, z, { ...b, on: st.on, label: st.label });
          break;
        }
      }
      if (this.gui?.handle === handle) this.gui.title.textContent = st.label || `Computer #${st.id}`;
    });
    this.computers.set(block.id, handle);
  }

  removeComputer(id) {
    const h = this.computers.get(id);
    if (!h) return;
    if (this.gui?.handle === h) this.closeGui();
    h.shutdown();
    setTimeout(() => h.destroy(), 200);
    this.computers.delete(id);
  }

  openComputer(block) {
    const handle = this.computers.get(block.id);
    if (!handle) return;
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

  closeGui() {
    if (!this.gui) return;
    this.gui.screen?.destroy();
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
    if (BLOCKS[b.type]?.computer && !sneaking) { this.openComputer(b); return; }
    const type = this.hotbar[this.slot];
    if (!type) return;
    const p = [hit.pos[0] + hit.normal[0], hit.pos[1] + hit.normal[1], hit.pos[2] + hit.normal[2]];
    if (this.world.get(...p)) return;
    const cam = this.controls.pos;
    if (Math.floor(cam.x) === p[0] && Math.floor(cam.y) === p[1] && Math.floor(cam.z) === p[2]) return;
    const def = BLOCKS[type];
    const block = { type };
    if (def.facing) {
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
    for (const id of [...this.computers.keys()]) this.removeComputer(id);
    const keepId = this.world.nextComputerId;
    this.world.load({ blocks: [], nextComputerId: keepId });
    defaultWorld(this.world);
    this.controls.load({ pos: [0.5, 2.62, 3.5], yaw: 0, pitch: -0.2 });
    this.scheduleSave();
  }
}
