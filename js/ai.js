// AI drivers: target selection, steering w/ obstacle avoidance, tactical modes, fire control.
const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

export const DIFFICULTY = {
  rookie: { aimErr: 0.16, react: 0.45, fireProb: 0.6, drive: 0.82, name: 'Rookie' },
  pro:    { aimErr: 0.08, react: 0.28, fireProb: 0.85, drive: 0.93, name: 'Pro' },
  legend: { aimErr: 0.035, react: 0.15, fireProb: 1.0, drive: 1.0, name: 'Legend' },
};

export class AIDriver {
  constructor(v, battle, diff = 'pro') {
    this.v = v; this.b = battle; this.d = DIFFICULTY[diff] || DIFFICULTY.pro;
    this.thinkT = Math.random() * 0.3;
    this.mode = 'hunt';
    this.modeT = 0;
    this.stuckT = 0; this.reverseT = 0; this.revSteer = 1;
    this.wander = null;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    const ws = v.weapons;
    const has = (pred) => ws.some(pred);
    this.style = {
      front: ws.filter(w => w.loc === 'front' && w.def.type !== 'passive' && w.def.type !== 'drop').length,
      turret: ws.filter(w => w.loc === 'top').length,
      sides: ws.filter(w => w.loc === 'left' || w.loc === 'right').length,
      rear: ws.filter(w => (w.loc === 'back' || w.loc === 'bottom')).length,
      ram: has(w => w.def.id === 'ram' && w.loc === 'front'),
      flame: has(w => w.def.id === 'flame'),
    };
  }

  pickTarget() {
    const v = this.v; let best = null, bs = Infinity;
    for (const o of this.b.vehicles) {
      if (o === v || o.out || (this.b.teams && o.team === v.team)) continue;
      const d = Math.hypot(o.x - v.x, o.z - v.z);
      let s = d;
      if (o === v.lastAttacker && v.lastHitT < 4) s *= 0.5;
      if (o === v.target) s *= 0.7; // stickiness
      if (o.isPlayer) s *= this.b.playerAggro ?? 1;
      s *= 0.6 + 0.4 * o.healthFrac(); // finish weak targets
      if (o.smokeHidden) s *= 1.8;
      if (s < bs) { bs = s; best = o; }
    }
    return best;
  }

  update(dt) {
    const v = this.v, inp = v.input, p = v.phys;
    if (v.out) { inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.boost = false; for (const k in inp.fire) inp.fire[k] = false; return; }
    this.thinkT -= dt; this.modeT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = this.d.react * (0.7 + Math.random() * 0.6);
      v.target = this.pickTarget();
      this.chooseMode();
    }
    const t = v.target;
    // --- desired point ---
    let gx, gz, wantSpeed = 40;
    if (!t) {
      if (!this.wander || Math.hypot(this.wander.x - v.x, this.wander.z - v.z) < 10) this.wander = this.b.arena.randomPoint(15);
      gx = this.wander.x; gz = this.wander.z; wantSpeed = 18;
    } else {
      const dx = t.x - v.x, dz = t.z - v.z, dist = Math.hypot(dx, dz);
      const tv = [t.phys.vx, t.phys.vz];
      if (this.mode === 'joust' || this.mode === 'ram') {
        const lead = this.mode === 'ram' ? Math.min(1.2, dist / 30) : Math.min(0.8, dist / 60);
        gx = t.x + tv[0] * lead; gz = t.z + tv[1] * lead;
        wantSpeed = this.mode === 'ram' ? 60 : (dist < 18 ? 14 : 34);
      } else if (this.mode === 'orbit' || this.mode === 'broadside') {
        const R = this.mode === 'broadside' ? 18 : 30;
        const ang = Math.atan2(v.x - t.x, v.z - t.z) + this.orbitDir * (this.mode === 'broadside' ? 0.7 : 0.5);
        gx = t.x + Math.sin(ang) * R; gz = t.z + Math.cos(ang) * R; wantSpeed = 26;
      } else if (this.mode === 'lure') { // drive away, drop stuff
        const ang = Math.atan2(v.x - t.x, v.z - t.z) + Math.sin(this.b.time * 0.7) * 0.6;
        gx = v.x + Math.sin(ang) * 30; gz = v.z + Math.cos(ang) * 30; wantSpeed = 50;
      } else if (this.mode === 'pickup' && this.pickupTarget && !this.pickupTarget.dead) {
        gx = this.pickupTarget.x; gz = this.pickupTarget.z; wantSpeed = 40;
      } else { gx = t.x; gz = t.z; }
    }
    // keep inside arena
    const ar = this.b.arena;
    if (!ar.inside(gx, gz, 8)) { const s = 0.75; gx *= s; gz *= s; }

    // --- steering w/ obstacle avoidance probes ---
    let desired = Math.atan2(gx - v.x, gz - v.z);
    const look = 8 + Math.abs(p.vf) * 0.7;
    const probe = (off) => { const a = v.h + off; const t = ar.segBlocked(v.x, v.z, v.x + Math.sin(a) * look, v.z + Math.cos(a) * look); return t === null ? 1 : t; };
    const c = probe(0), l = probe(0.45), r = probe(-0.45);
    if (c < 1 || l < 0.6 || r < 0.6) {
      desired = v.h + (l > r ? 1 : -1) * (1.2 - Math.min(l, r)) * 1.3;
      if (c < 0.35) wantSpeed = Math.min(wantSpeed, 10);
    }
    // avoid friendly / nearby cars unless ramming
    if (this.mode !== 'ram') for (const o of this.b.vehicles) {
      if (o === v || o.out) continue;
      const dx = o.x - v.x, dz = o.z - v.z, d = Math.hypot(dx, dz);
      if (d < 9 && (o !== t || this.mode !== 'joust')) {
        const ang = wrap(Math.atan2(dx, dz) - v.h);
        if (Math.abs(ang) < 0.8) desired += (ang > 0 ? -1 : 1) * 0.5;
      }
    }
    let err = wrap(desired - v.h);
    if (p.vf < -1) err = -err;
    let steer = -Math.max(-1, Math.min(1, err * 2.2)) * this.d.drive;
    // speed control
    const sp = p.vf;
    let throttle = 0, brake = 0;
    const turnPenalty = Math.abs(err) > 1.2 ? 0.45 : Math.abs(err) > 0.6 ? 0.7 : 1;
    const target = wantSpeed * turnPenalty;
    if (sp < target - 2) throttle = 1; else if (sp > target + 4) brake = Math.min(1, (sp - target) / 10); else throttle = 0.4;
    // stuck handling
    if (this.reverseT > 0) {
      this.reverseT -= dt; throttle = 0; brake = 1; steer = this.revSteer;
    } else {
      if (throttle > 0.5 && Math.abs(sp) < 1.5) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
      if (this.stuckT > 1.0) { this.reverseT = 1.1 + Math.random() * 0.6; this.stuckT = 0; this.revSteer = Math.random() < 0.5 ? 1 : -1; }
    }
    inp.steer = steer; inp.throttle = throttle; inp.brake = brake;
    inp.handbrake = Math.abs(err) > 1.7 && sp > 14 && Math.random() < 0.5;
    inp.boost = throttle > 0.9 && Math.abs(err) < 0.25 && v.heat < 55 && v.energy > v.energyMax * 0.3 && (this.mode === 'ram' || this.mode === 'lure' || (t && Math.hypot(t.x - v.x, t.z - v.z) > 50));

    // --- fire control ---
    for (const k in inp.fire) inp.fire[k] = false;
    if (!t) return;
    const dist = Math.hypot(t.x - v.x, t.z - v.z);
    const losBlocked = ar.segBlocked(v.x, v.z, t.x, t.z) !== null;
    const bearing = wrap(Math.atan2(t.x - v.x, t.z - v.z) - v.h); // + = left
    const hot = v.heat > 85;
    const fireOK = Math.random() < this.d.fireProb;
    const inRange = (loc) => v.weapons.some(w => w.loc === loc && !w.destroyed && w.def.range && dist < w.def.range * 0.95);
    if (!losBlocked && fireOK) {
      const tol = 0.12 + (v.computer.assist * Math.PI / 180) + this.d.aimErr;
      if (Math.abs(bearing) < tol && inRange('front')) inp.fire.front = true;
      if (Math.abs(wrap(bearing - Math.PI / 2)) < 0.4 && inRange('left')) inp.fire.left = true;
      if (Math.abs(wrap(bearing + Math.PI / 2)) < 0.4 && inRange('right')) inp.fire.right = true;
      if (inRange('top')) inp.fire.top = true;
      if (Math.abs(wrap(bearing - Math.PI)) < 0.35 && inRange('back')) inp.fire.back = true;
    }
    // drops when enemy behind & close
    if (Math.abs(wrap(bearing - Math.PI)) < 0.6 && dist < 35 && Math.random() < dt * 2) inp.fire.back = true;
    if (hot) { inp.fire.front = inp.fire.front && Math.random() < 0.3; inp.fire.top = inp.fire.top && Math.random() < 0.3; }
  }

  chooseMode() {
    const v = this.v, t = v.target, st = this.style;
    if (this.modeT > 0 && this.mode !== 'pickup') return;
    // low health → go for pickup
    if (v.healthFrac() < 0.45 || v.heat > 110) {
      const pk = this.b.nearestPickup(v);
      if (pk && Math.hypot(pk.x - v.x, pk.z - v.z) < 90) { this.mode = 'pickup'; this.pickupTarget = pk; this.modeT = 3; return; }
    }
    if (!t) { this.mode = 'hunt'; return; }
    const r = Math.random();
    const opts = [];
    if (st.front) opts.push(['joust', 3 + st.front]);
    if (st.ram) opts.push(['ram', 3]);
    if (st.flame) opts.push(['ram', 1.5]);
    if (st.turret) opts.push(['orbit', 2 + st.turret * 1.5]);
    if (st.sides) opts.push(['broadside', 2 + st.sides]);
    if (st.rear) opts.push(['lure', 1 + st.rear * 0.5]);
    if (!opts.length) opts.push(['ram', 1]);
    const tot = opts.reduce((s, o) => s + o[1], 0); let k = r * tot;
    for (const [m, w] of opts) { k -= w; if (k <= 0) { this.mode = m; break; } }
    this.modeT = this.mode === 'lure' ? 3 + Math.random() * 2 : 4 + Math.random() * 5;
    if (Math.random() < 0.3) this.orbitDir *= -1;
  }
}
