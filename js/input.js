// Unified input: keyboard + mouse, gamepad, and on-screen touch controls.
export class Input {
  constructor() {
    this.keys = new Set();
    this.mouse = { l: false, r: false };
    this.touch = { steer: 0, throttle: 0, brake: 0, fire: {}, boost: false, handbrake: false };
    this.edges = new Set();
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.enabled = false;
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code);
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
    addEventListener('touchstart', () => { if (!this.touchMode) { this.touchMode = true; this.onTouchMode?.(); } }, { passive: true });
  }

  bindCanvas(el) {
    el.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouse.l = true; if (e.button === 2) this.mouse.r = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Build touch controls into a container
  buildTouch(root) {
    root.innerHTML = `
      <div class="stick" id="stick"><div class="stick-base"></div><div class="stick-knob" id="knob"></div></div>
      <div class="tbtns">
        <button class="tb tb-fire" data-f="front">FIRE</button>
        <button class="tb tb-turret" data-f="top">TURRET</button>
        <button class="tb tb-side" data-f="sides">SIDES</button>
        <button class="tb tb-rear" data-f="back">REAR</button>
        <button class="tb tb-boost" data-b="boost">BOOST</button>
        <button class="tb tb-hb" data-b="handbrake">DRIFT</button>
      </div>`;
    const stick = root.querySelector('#stick'), knob = root.querySelector('#knob');
    let sid = null, cx = 0, cy = 0;
    const R = 55;
    const move = (x, y) => {
      let dx = x - cx, dy = y - cy; const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / R, ny = -dy / R;
      this.touch.steer = Math.abs(nx) < 0.12 ? 0 : nx;
      this.touch.throttle = ny > 0.15 ? Math.min(1, ny * 1.3) : 0;
      this.touch.brake = ny < -0.25 ? Math.min(1, -ny * 1.3) : 0;
      // auto-throttle when steering hard sideways but not braking
      if (this.touch.throttle === 0 && this.touch.brake === 0 && Math.abs(nx) > 0.5) this.touch.throttle = 0.6;
    };
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault(); const t = e.changedTouches[0]; sid = t.identifier;
      const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(t.clientX, t.clientY);
    }, { passive: false });
    stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === sid) move(t.clientX, t.clientY); }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; knob.style.transform = ''; this.touch.steer = this.touch.throttle = this.touch.brake = 0; } };
    stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
    root.querySelectorAll('.tb').forEach((b) => {
      const on = (v) => (e) => { e.preventDefault(); b.classList.toggle('on', v); if (b.dataset.f) this.touch.fire[b.dataset.f] = v; else this.touch[b.dataset.b] = v; };
      b.addEventListener('touchstart', on(true), { passive: false });
      b.addEventListener('touchend', on(false)); b.addEventListener('touchcancel', on(false));
      b.addEventListener('mousedown', on(true)); b.addEventListener('mouseup', on(false)); b.addEventListener('mouseleave', on(false));
    });
    this.touchRoot = root;
  }

  pressed(code) { return this.edges.has(code); }

  state() {
    const k = this.keys, has = (c) => k.has(c);
    let steer = 0, throttle = 0, brake = 0;
    if (has('KeyA') || has('ArrowLeft')) steer -= 1;
    if (has('KeyD') || has('ArrowRight')) steer += 1;
    if (has('KeyW') || has('ArrowUp')) throttle = 1;
    if (has('KeyS') || has('ArrowDown')) brake = 1;
    const fire = {
      front: has('Space') || this.mouse.l || has('KeyJ'),
      top: has('KeyF') || this.mouse.r || has('KeyK'),
      left: has('KeyQ'), right: has('KeyE'), sides: false,
      back: has('KeyR') || has('KeyL'),
    };
    let boost = has('ShiftLeft') || has('ShiftRight');
    let handbrake = has('KeyX') || has('ControlLeft');
    // gamepad
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g) : null;
    if (gp) {
      const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.15) steer = ax;
      const bt = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.3);
      const val = (i) => gp.buttons[i] ? gp.buttons[i].value : 0;
      if (val(7) > 0.05) throttle = Math.max(throttle, val(7));
      if (val(6) > 0.05) brake = Math.max(brake, val(6));
      if (bt(0)) fire.front = true; if (bt(1)) fire.top = true; if (bt(2)) fire.back = true;
      if (bt(4)) fire.left = true; if (bt(5)) fire.right = true; if (bt(3)) boost = true;
      if (bt(10) || bt(11)) handbrake = true;
      const pauseNow = bt(9); if (pauseNow && !this._gpPause) this.edges.add('Escape'); this._gpPause = pauseNow;
      const cyc = bt(8); if (cyc && !this._gpCyc) this.edges.add('Tab'); this._gpCyc = cyc;
    }
    // touch
    const t = this.touch;
    if (t.steer) steer = t.steer;
    if (t.throttle) throttle = Math.max(throttle, t.throttle);
    if (t.brake) brake = Math.max(brake, t.brake);
    for (const f of ['front', 'top', 'back', 'sides']) if (t.fire[f]) fire[f] = true;
    if (t.boost) boost = true; if (t.handbrake) handbrake = true;
    const s = {
      steer: Math.max(-1, Math.min(1, steer)), throttle, brake, boost, handbrake, fire,
      cycleTarget: this.edges.has('Tab') || this.edges.has('KeyT'),
      camera: this.edges.has('KeyC'),
      pause: this.edges.has('Escape') || this.edges.has('KeyP'),
      mute: this.edges.has('KeyM'),
    };
    this.edges.clear();
    return s;
  }
}
