// Creative-mode flying camera. Pointer lock gives Minecraft's mouse look with a crosshair;
// where pointer lock is unavailable, dragging the mouse looks around and clicks aim at the cursor.
import * as THREE from 'three';

export class Controls {
  constructor(camera, element) {
    this.camera = camera;
    this.el = element;
    this.yaw = 0; this.pitch = -0.2;
    this.pos = new THREE.Vector3(0.5, 2.62, 3.5);
    this.keys = new Set();
    this.enabled = true;
    this.locked = false;
    this.lockSupported = 'requestPointerLock' in element;
    this.speed = 10.9; // creative flying, blocks per second
    this.onLockChange = null;

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.lockSupported = false; this.onLockChange?.(false); });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) this.look(e.movementX, e.movementY);
      else if (this.dragging) {
        const dx = e.clientX - this.dragging.x, dy = e.clientY - this.dragging.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.dragging.moved = true;
        if (this.dragging.moved) this.look(e.movementX * 1.5, e.movementY * 1.5);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (['Space', 'ShiftLeft', 'ShiftRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  lock() {
    if (!this.lockSupported) return false;
    try {
      const p = this.el.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockSupported = false; this.onLockChange?.(false); });
    } catch (e) { this.lockSupported = false; return false; }
    return true;
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  look(dx, dy) {
    this.yaw -= dx * 0.0025;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch - dy * 0.0025));
  }

  direction() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  // Ray through a screen point (for free-cursor mode), or the crosshair
  ray(clientX, clientY) {
    if (this.locked || clientX === undefined) return { origin: this.pos.clone(), dir: this.direction() };
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return { origin: ray.ray.origin.clone(), dir: ray.ray.direction.clone() };
  }

  update(dt) {
    if (this.enabled) {
      const k = this.keys;
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const move = new THREE.Vector3();
      if (k.has('KeyW')) move.add(fwd);
      if (k.has('KeyS')) move.sub(fwd);
      if (k.has('KeyD')) move.add(right);
      if (k.has('KeyA')) move.sub(right);
      if (move.lengthSq()) move.normalize();
      if (k.has('Space')) move.y += 1;
      if (k.has('ShiftLeft') || k.has('ShiftRight')) move.y -= 1;
      const sp = this.speed * (k.has('ControlLeft') ? 2 : 1);
      this.pos.addScaledVector(move, sp * dt);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.pos.clone().add(this.direction()));
  }

  toJSON() { return { pos: this.pos.toArray(), yaw: this.yaw, pitch: this.pitch }; }
  load(d) { if (!d) return; this.pos.fromArray(d.pos); this.yaw = d.yaw; this.pitch = d.pitch; }
}
