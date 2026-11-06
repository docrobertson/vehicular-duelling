// Battle simulation + rendering sync: vehicles, weapons, projectiles, drops, pickups, camera.
import * as THREE from 'three';
import { WEAPONS, TEAM_COLORS, AI_NAMES, DIVISIONS, divisionFor, LOCATIONS } from './data.js';
import { autoDesign, computeStats } from './design.js';
import { Vehicle } from './vehicle.js';
import { AIDriver } from './ai.js';
import { Arena } from './arena.js';
import { Effects } from './effects.js';
import { buildCar, disposeCar } from './carmodel.js';
import { resolvePair, resolveStatic, satQuads, segVsCar, locFromLocal, obbAxes } from './physics.js';
import { emissive, additive, glowTex, stdMats } from './gfx.js';

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const LOC_ANGLE = { front: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2, top: 0, bottom: Math.PI };
const PHYS_DT = 1 / 120;
const DMG_SCALE = 0.6; // global weapon damage tuning

export class Battle {
  constructor(game, cfg) {
    this.game = game; this.cfg = cfg;
    this.scene = new THREE.Scene();
    this.audio = cfg.audio || game.audio;
    this.time = 0; this.started = false; this.countdown = 3.6; this.over = false; this.result = null;
    this.timeLimit = cfg.timeLimit || 300;
    this.quality = game.settings.quality;
    this.arena = new Arena(cfg.arena, this.scene, this.quality);
    this.scene.environment = game.envFor(cfg.arena);
    this.fx = new Effects(this.scene, this.quality);
    this.projectiles = []; this.drops = []; this.pickups = []; this.events = []; this.feed = [];
    this.pickupT = 8;
    this.shakeAmt = 0;
    this.teams = cfg.mode === 'teams';
    this.vehicles = [];
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2000);
    this.camYaw = 0; this.camMode = 0;
    this.spectate = null;
    this.contacts = [];
    this.setupVehicles();
    this.initPools();
    this.accum = 0;
  }

  setupVehicles() {
    const cfg = this.cfg;
    const pStats = computeStats(cfg.playerDesign);
    const div = divisionFor(pStats.cost);
    this.division = div;
    // rivals are built to (roughly) your price point, capped by the division ceiling
    const budget = Math.min(isFinite(div.max) ? div.max : Infinity, Math.max(pStats.cost * 1.1, div.min + 2000, 7000));
    const minCost = Math.max(div.min, pStats.cost * 0.8);
    const roster = [];
    const names = AI_NAMES.slice().sort(() => Math.random() - 0.5);
    roster.push({ design: cfg.playerDesign, team: 0, isPlayer: !cfg.demo, driverName: cfg.demo ? null : (cfg.playerDesign.driver?.name || 'You') });
    if (this.teams) {
      for (let i = 1; i < cfg.teamSize; i++) roster.push({ design: autoDesign(budget, Math.random, undefined, minCost), team: 0 });
      for (let i = 0; i < cfg.teamSize; i++) roster.push({ design: autoDesign(budget, Math.random, undefined, minCost), team: 1 });
    } else {
      for (let i = 0; i < cfg.opponents; i++) roster.push({ design: autoDesign(budget, Math.random, undefined, minCost), team: i + 1 });
    }
    const spawns = this.arena.spawnPoints(roster.length);
    // team spawns: group teams on opposite sides
    let order = roster.map((_, i) => i);
    if (this.teams) {
      const n = roster.length, half = n / 2;
      order = []; for (let i = 0; i < half; i++) { order.push(i); } for (let i = 0; i < half; i++) order.push(half + i);
    }
    const used = new Set();
    for (const r of roster) {
      if (r.isPlayer) { used.add(r.design.name); continue; }
      let n = r.design.name, k = 2;
      while (used.has(n)) n = r.design.name + ' ' + ['II', 'III', 'IV', 'V', 'VI', 'VII'][Math.min(5, k++ - 2)];
      r.design.name = n; used.add(n);
    }
    roster.forEach((r, i) => {
      const color = this.teams ? TEAM_COLORS[r.team] : (r.isPlayer ? 0x33f0ff : [0xff2a8a, 0xffe14a, 0x3cff9a, 0xff7a1a, 0xb070ff, 0xff4444, 0xffffff][(i - 1) % 7]);
      const v = new Vehicle(r.design, { id: i, team: r.team, isPlayer: r.isPlayer, driverName: r.driverName || names[i % names.length], color, name: r.design.name });
      v.events = this.events;
      const sp = spawns[this.teams ? (r.team === 0 ? Math.floor(i) : i) : i];
      v.phys.x = sp.x; v.phys.z = sp.z; v.phys.h = sp.h;
      v.model = buildCar(r.design, { teamColor: color });
      v.model.root.position.set(sp.x, 0, sp.z); v.model.root.rotation.y = sp.h;
      v.rubber = v.model.wheels.map(w => w.spin.children.find(m => m.material === stdMats().rubber));
      this.scene.add(v.model.root);
      if (!r.isPlayer) v.ai = new AIDriver(v, this, cfg.difficulty);
      this.vehicles.push(v);
    });
    if (this.teams) { // re-spread team spawns so allies start together
      const n = this.vehicles.length, sp = this.arena.spawnPoints(n);
      const t0 = this.vehicles.filter(v => v.team === 0), t1 = this.vehicles.filter(v => v.team === 1);
      const half = Math.floor(n / 2);
      const s0 = [], s1 = [];
      for (let i = 0; i < n; i++) { const k = (i + Math.floor(half / 2) + 1) % n; (s0.length < half ? s0 : s1).push(sp[k]); }
      t0.forEach((v, i) => { const s = s0[i]; v.phys.x = s.x; v.phys.z = s.z; v.phys.h = s.h; });
      t1.forEach((v, i) => { const s = s1[i]; v.phys.x = s.x; v.phys.z = s.z; v.phys.h = s.h; });
    }
    this.player = this.vehicles[0];
    this.camYaw = this.player.h;
  }

  initPools() {
    const M = stdMats();
    this.rocketGeo = new THREE.ConeGeometry(0.12, 0.6, 8); this.rocketGeo.rotateX(Math.PI / 2);
    this.grenadeGeo = new THREE.SphereGeometry(0.16, 8, 6);
    this.mineGeo = new THREE.CylinderGeometry(0.45, 0.5, 0.18, 12);
    this.pool = { rocket: [], grenade: [] };
    this.glowSpriteMat = (c) => new THREE.SpriteMaterial({ map: glowTex(), color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  }

  getMesh(kind, color) {
    const arr = this.pool[kind];
    let m = arr.find(o => !o.visible);
    if (!m) {
      m = new THREE.Group();
      const body = new THREE.Mesh(kind === 'rocket' ? this.rocketGeo : this.grenadeGeo, stdMats().white);
      const glow = new THREE.Sprite(this.glowSpriteMat(color)); glow.scale.set(1.6, 1.6, 1);
      m.add(body, glow); m.userData.glow = glow;
      this.scene.add(m); arr.push(m);
    }
    m.visible = true; m.userData.glow.material.color.set(color);
    return m;
  }

  // ---------- main update ----------
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const P = this.player;
    // countdown
    if (!this.started) {
      const prev = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== prev && now > 0 && now <= 3) this.audio.sfx('countdown');
      if (this.countdown <= 0) { this.started = true; this.audio.sfx('go'); }
    }
    // player controls
    if (this.cfg.demo) { /* AI drives everyone */ }
    else if (this.started && !P.out && !this.over) {
      const i = P.input;
      i.throttle = input.throttle; i.brake = input.brake; i.steer = input.steer; i.handbrake = input.handbrake; i.boost = input.boost && P.energy > 0.2;
      i.fire.front = input.fire.front; i.fire.top = input.fire.top; i.fire.left = input.fire.left || input.fire.sides; i.fire.right = input.fire.right || input.fire.sides; i.fire.back = input.fire.back;
      if (input.cycleTarget) this.cycleTarget();
      if (!P.target || P.target.out || (this.teams && P.target.team === P.team)) P.target = this.autoTarget(P);
    } else if (P.out || !this.started) {
      const i = P.input; i.throttle = 0; i.brake = this.started ? 0 : 1; i.steer = 0; i.boost = false; for (const k in i.fire) i.fire[k] = false;
    }
    if (input.camera) this.camMode = (this.camMode + 1) % 3;

    // AI
    if (this.started) { for (const v of this.vehicles) if (v.ai) v.ai.update(dt); }
    else { for (const v of this.vehicles) if (v.ai) { v.input.brake = 1; v.input.throttle = 0; } }

    // physics substeps
    this.accum += dt;
    let steps = 0;
    while (this.accum >= PHYS_DT && steps < 8) {
      this.accum -= PHYS_DT; steps++;
      for (const v of this.vehicles) {
        const inp = v.out ? { throttle: 0, brake: 0.3, steer: 0, handbrake: false, boost: false } : v.input;
        v.phys.step(PHYS_DT, inp);
      }
      this.collisions();
    }
    if (steps >= 8) this.accum = 0;

    // systems + weapons
    for (const v of this.vehicles) {
      v.updateSystems(dt);
      if (this.started && !v.out) { this.aimTurret(v, dt); this.updateLocks(v, dt); this.fireWeapons(v); }
      // smoke hidden check
      v.smokeHidden = this.drops.some(d => d.kind === 'smoke' && Math.hypot(d.x - v.x, d.z - v.z) < 8);
    }
    this.updateProjectiles(dt);
    this.updateDrops(dt);
    this.updatePickups(dt);
    this.processEvents();
    this.checkEnd(dt);

    // audio for player
    if (!P.out) {
      this.audio.setEngine(Math.min(1, Math.abs(P.phys.vf) / 45), Math.max(P.input.throttle, 0), P.input.boost);
      this.audio.setSkid(P.phys.slip * Math.min(1, P.speed / 8));
    } else { this.audio.setEngine(0, 0, false); this.audio.setSkid(0); }
    // music intensity
    let near = 0; for (const v of this.vehicles) if (v !== P && !v.out && Math.hypot(v.x - P.x, v.z - P.z) < 60) near++;
    this.audio.setIntensity(Math.min(1, 0.35 + near * 0.2 + (P.lastHitT < 3 ? 0.3 : 0)));

    this.syncVisuals(dt);
    this.updateCamera(dt);
    this.arena.update(dt, this.camera);
    this.fx.update(dt);
  }

  autoTarget(v) {
    let best = null, bs = Infinity;
    for (const o of this.vehicles) {
      if (o === v || o.out || (this.teams && o.team === v.team)) continue;
      const dx = o.x - v.x, dz = o.z - v.z, d = Math.hypot(dx, dz);
      const ang = Math.abs(wrap(Math.atan2(dx, dz) - v.h));
      const s = d * (1 + ang * 0.8) * (o.smokeHidden ? 2 : 1);
      if (s < bs) { bs = s; best = o; }
    }
    return best;
  }
  cycleTarget() {
    const P = this.player;
    const enemies = this.vehicles.filter(o => o !== P && !o.out && !(this.teams && o.team === P.team));
    if (!enemies.length) return;
    enemies.sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z));
    const i = enemies.indexOf(P.target);
    P.target = enemies[(i + 1) % enemies.length];
    this.audio.sfx('ui_click');
  }

  // ---------- collisions ----------
  collisions() {
    const V = this.vehicles;
    for (let i = 0; i < V.length; i++) {
      const A = V[i];
      for (let j = i + 1; j < V.length; j++) {
        const B = V[j];
        const dx = B.x - A.x, dz = B.z - A.z, rr = (Math.hypot(A.B.L, A.B.W) + Math.hypot(B.B.L, B.B.W)) / 2;
        if (dx * dx + dz * dz > rr * rr) continue;
        const pa = A.phys.corners(), pb = B.phys.corners();
        const c = satQuads(pa, pb, [A.x, A.z], [B.x, B.z], obbAxes(A.h), obbAxes(B.h));
        if (!c) continue;
        const vn = resolvePair(A.phys, B.phys, c);
        if (vn > 3) this.ramDamage(A, B, c, vn);
      }
      const cs = this.arena.collideCar(A.phys, this.contacts);
      for (const c of cs) {
        const vn = resolveStatic(A.phys, c.px, c.pz, c.nx, c.nz, c.depth);
        if (vn > 4) {
          const [lx, lz] = A.phys.toLocal(c.px, c.pz);
          const loc = locFromLocal(A.phys, lx, lz);
          const dmg = 0.5 * A.phys.m * vn * vn / 40000;
          A.damage(dmg * this.ramRecv(A, loc), 'ram', loc, A.lastAttacker && A.lastHitT < 3 ? A.lastAttacker : null);
          this.fx.sparks(c.px, 0.6, c.pz, Math.min(20, Math.floor(vn)));
          this.audio.sfx('crash', { volume: Math.min(1, vn / 20), dist: this.distToCam(c.px, c.pz) });
          if (A.isPlayer) this.shake(Math.min(1, vn / 18));
        }
      }
    }
  }
  ramMul(v, loc) { return v.weapons.some(w => w.def.id === 'ram' && w.loc === loc && !w.destroyed) ? 1.8 : 1; }
  ramRecv(v, loc) { return v.weapons.some(w => w.def.id === 'ram' && w.loc === loc && !w.destroyed) ? 0.5 : 1; }
  ramDamage(A, B, c, vn) {
    const mA = A.phys.m, mB = B.phys.m, mr = mA * mB / (mA + mB);
    const E = 0.5 * mr * vn * vn;
    const base = E / 22000;
    const [alx, alz] = A.phys.toLocal(c.px, c.pz), [blx, blz] = B.phys.toLocal(c.px, c.pz);
    const la = locFromLocal(A.phys, alx, alz), lb = locFromLocal(B.phys, blx, blz);
    const dA = base * (mB / (mA + mB)) * 2 * this.ramMul(B, lb) * this.ramRecv(A, la);
    const dB = base * (mA / (mA + mB)) * 2 * this.ramMul(A, la) * this.ramRecv(B, lb);
    const friendly = this.teams && A.team === B.team;
    A.damage(dA * (friendly ? 0.3 : 1), 'ram', la, B);
    B.damage(dB * (friendly ? 0.3 : 1), 'ram', lb, A);
    if (!friendly) { A.score.rams++; B.score.rams++; }
    this.fx.sparks(c.px, 0.7, c.pz, Math.min(30, Math.floor(vn * 1.5)));
    this.fx.hitFlash(c.px, 0.8, c.pz, 0xffaa55);
    this.audio.sfx('crash', { volume: Math.min(1, vn / 15), dist: this.distToCam(c.px, c.pz) });
    if (A.isPlayer || B.isPlayer) this.shake(Math.min(1.2, vn / 12));
  }

  // ---------- weapons ----------
  muzzleWorld(v, w) {
    const mz = v.model.muzzles[w.i];
    if (!mz) return [v.x, 0.8, v.z];
    let lx = mz.pos.x, ly = mz.pos.y, lz = mz.pos.z;
    if (mz.space === 'turret') {
      const tp = v.model.turret.position, y = v.turretYaw, c = Math.cos(y), s = Math.sin(y);
      const rx = lx * c + lz * s, rz = -lx * s + lz * c;
      lx = rx + tp.x; ly = ly + tp.y; lz = rz + tp.z;
    }
    const [wx, wz] = v.phys.toWorld(lx, lz);
    return [wx, ly, wz];
  }

  leadAngle(v, ox, oz, t, speed) {
    let tx = t.x, tz = t.z;
    if (speed > 0) {
      const d = Math.hypot(tx - ox, tz - oz); const tt = d / speed;
      tx += (t.phys.vx - v.phys.vx * 0.3) * tt; tz += (t.phys.vz - v.phys.vz * 0.3) * tt;
    }
    return Math.atan2(tx - ox, tz - oz);
  }

  turretTarget(v) {
    // gunner picks own target: closest visible enemy; otherwise driver's target
    if (v.gunnerAlive && !v.isPlayer) return v.target;
    if (v.gunnerAlive && v.isPlayer) {
      let best = v.target && !v.target.out ? v.target : null, bd = best ? Math.hypot(best.x - v.x, best.z - v.z) * 0.8 : Infinity;
      for (const o of this.vehicles) {
        if (o === v || o.out || (this.teams && o.team === v.team) || o.smokeHidden) continue;
        const d = Math.hypot(o.x - v.x, o.z - v.z);
        if (d < bd && this.arena.segBlocked(v.x, v.z, o.x, o.z) === null) { bd = d; best = o; }
      }
      return best;
    }
    return v.target;
  }

  aimTurret(v, dt) {
    if (!v.hasTurret) return;
    const t = this.turretTarget(v);
    v.gunnerTarget = t;
    let want = 0;
    if (t && !t.out) {
      const tw = v.weapons.find(w => w.loc === 'top' && !w.destroyed);
      const spd = tw && tw.def.speed ? tw.def.speed : 0;
      want = wrap(this.leadAngle(v, v.x, v.z, t, spd) - v.h);
    }
    const rate = (v.gunnerAlive ? 3.2 : 1.8) * dt;
    const d = wrap(want - v.turretYaw);
    v.turretYaw = wrap(v.turretYaw + Math.max(-rate, Math.min(rate, d)));
    v.turretErr = Math.abs(wrap(want - v.turretYaw));
  }

  updateLocks(v, dt) {
    for (const w of v.weapons) {
      if (!w.def.homing) continue;
      const t = w.loc === 'top' ? v.gunnerTarget : v.target;
      if (!t || t.out || t.smokeHidden || v.computer.id === 'none') { w.lockT = 0; w.lockTarget = null; continue; }
      const base = v.h + (w.loc === 'top' ? v.turretYaw : LOC_ANGLE[w.loc]);
      const ang = Math.abs(wrap(Math.atan2(t.x - v.x, t.z - v.z) - base));
      const d = Math.hypot(t.x - v.x, t.z - v.z);
      if (ang < 0.6 && d < w.def.range) {
        if (w.lockTarget !== t) { w.lockTarget = t; w.lockT = 0; }
        w.lockT += dt / (t.acc.jammer ? 2 : 1);
      } else { w.lockT = Math.max(0, w.lockT - dt * 2); }
      w.locked = w.lockT >= v.computer.lockTime;
    }
  }

  fireWeapons(v) {
    const f = v.input.fire;
    const gunnerAuto = v.gunnerAlive && v.isPlayer;
    for (const w of v.weapons) {
      if (!v.canFire(w)) continue;
      let want = false;
      const loc = w.loc;
      if (loc === 'front') want = f.front;
      else if (loc === 'top') want = gunnerAuto ? this.gunnerWantsFire(v, w) : (v.isPlayer ? f.top : (f.top && v.turretErr < 0.12));
      else if (loc === 'left') want = f.left || (gunnerAuto && this.sideWants(v, w, Math.PI / 2));
      else if (loc === 'right') want = f.right || (gunnerAuto && this.sideWants(v, w, -Math.PI / 2));
      else if (loc === 'back' || loc === 'bottom') want = f.back;
      if (!want) continue;
      // player front weapons: don't waste homing missiles without lock unless explicitly firing (allowed)
      this.fire(v, w);
    }
  }
  gunnerWantsFire(v, w) {
    const t = v.gunnerTarget; if (!t || t.out) return false;
    const d = Math.hypot(t.x - v.x, t.z - v.z);
    if (d > (w.def.range || 50) * 0.95 || v.turretErr > 0.1) return false;
    if (v.heat > 92 && w.def.heat > 1) return false;
    if (w.def.homing && !w.locked) return false;
    return this.arena.segBlocked(v.x, v.z, t.x, t.z) === null;
  }
  sideWants(v, w, off) {
    for (const o of this.vehicles) {
      if (o === v || o.out || (this.teams && o.team === v.team)) continue;
      const d = Math.hypot(o.x - v.x, o.z - v.z); if (d > (w.def.range || 30) * 0.9) continue;
      const ang = Math.abs(wrap(Math.atan2(o.x - v.x, o.z - v.z) - v.h - off));
      if (ang < 0.35) return true;
    }
    return false;
  }

  fire(v, w) {
    const W = w.def;
    w.cd = 1 / W.rof;
    if (isFinite(w.ammo)) w.ammo--;
    v.heat += W.heat;
    if (W.energy) v.energy = Math.max(0, v.energy - W.energy);
    v.score.shots++;
    const [mx, my, mz] = this.muzzleWorld(v, w);
    const dist = this.distToCam(mx, mz);
    if (W.sfx) this.audio.sfx(W.sfx, { dist, volume: v.isPlayer ? 0.9 : 0.7 });

    if (W.type === 'drop') { this.spawnDrop(v, w, mx, mz); return; }

    // aim direction
    const t = w.loc === 'top' ? v.gunnerTarget : v.target;
    let dir = v.h + (w.loc === 'top' ? v.turretYaw : LOC_ANGLE[w.loc]);
    if (t && !t.out && !t.smokeHidden && w.loc !== 'top') {
      const want = this.leadAngle(v, mx, mz, t, W.speed || 0);
      const arc = (w.loc === 'front' ? 3 : 18) * Math.PI / 180 + v.computer.assist * Math.PI / 180;
      const d = wrap(want - dir);
      if (Math.abs(d) < arc) dir = want;
    }
    let spread = W.spread * Math.PI / 180 * v.computer.spreadMul * (v.perk === 'steady' ? 0.8 : 1) * (v.smokeHidden ? 1.4 : 1);
    if (!v.isPlayer && v.ai) spread += v.ai.d.aimErr * 0.25;
    if (v.speed > 25) spread *= 1.2;
    dir += gauss() * spread;
    const dx = Math.sin(dir), dz = Math.cos(dir);

    if (W.type === 'beam') { this.fireBeam(v, w, mx, my, mz, dx, dz); return; }
    if (W.type === 'flame') {
      for (let k = 0; k < 3; k++) this.fx.flame(mx, my, mz, dx * W.speed, dz * W.speed, v.phys.vx, v.phys.vz);
      this.projectiles.push({ kind: 'flame', x: mx, y: my, z: mz, vx: dx * W.speed + v.phys.vx, vy: 0, vz: dz * W.speed + v.phys.vz, life: W.range / W.speed, owner: v, w: W });
      return;
    }
    this.fx.muzzle(mx, my, mz, dx, dz, W.color);
    const sp = W.speed;
    const p = { kind: W.rocket ? 'rocket' : W.lob ? 'grenade' : 'bullet', x: mx, y: my, z: mz, vx: dx * sp + v.phys.vx, vy: 0, vz: dz * sp + v.phys.vz, life: (W.range / sp) * 1.15, owner: v, w: W, bounces: 0 };
    if (W.lob) { p.vy = 9; p.life = 4; }
    if (W.rocket) { p.mesh = this.getMesh('rocket', W.color); p.mesh.position.set(mx, my, mz); if (W.homing && w.locked) p.target = w.lockTarget; p.turn = W.homing ? 2.4 : 0; }
    if (W.lob) { p.mesh = this.getMesh('grenade', W.color); p.mesh.position.set(mx, my, mz); }
    this.projectiles.push(p);
    if (v.isPlayer && W.rocket) this.shake(0.1);
  }

  fireBeam(v, w, mx, my, mz, dx, dz) {
    const W = w.def;
    const range = W.range;
    let ex = mx + dx * range, ez = mz + dz * range;
    let tBlock = this.arena.segBlocked(mx, mz, ex, ez);
    let hit = null, ht = tBlock ?? 1;
    for (const o of this.vehicles) {
      if (o === v || o.out) continue;
      const r = segVsCar(o.phys, mx, mz, ex, ez, 0.1);
      if (r && r.t < ht) { ht = r.t; hit = { o, r }; }
    }
    const hx = mx + (ex - mx) * ht, hz = mz + (ez - mz) * ht;
    if (W.emp) this.fx.arc(mx, my, mz, hx, 0.9, hz, W.color); else this.fx.beam(mx, my, mz, hx, 0.9, hz, W.color, W.id === 'hlas' ? 0.22 : 0.12, 0.12);
    this.fx.hitFlash(hx, 0.9, hz, W.color);
    if (hit) {
      const friendly = this.teams && hit.o.team === v.team;
      if (!friendly) {
        this.applyHit(v, hit.o, W, hit.r.face, hit.r.lx, hit.r.lz);
        if (W.emp) { hit.o.empT = 1.4; hit.o.energy = Math.max(0, hit.o.energy - 0.6); hit.o.alert('EMP — SYSTEMS STALLED', 'bad'); }
      }
      this.fx.sparks(hx, 0.9, hz, 5, W.color);
    } else if (tBlock !== null) this.fx.sparks(hx, 0.9, hz, 4, W.color);
  }

  applyHit(att, tgt, W, face, lx, lz, mult = 1) {
    let loc = face;
    if (Math.random() < 0.04) loc = 'top';
    const dmg = rnd(W.dmg[0], W.dmg[1]) * mult * DMG_SCALE;
    // tyre hit chance
    const tireChance = (face === 'left' || face === 'right') ? (W.id === 'mg' ? 0.3 : 0.18) : 0.08;
    if (W.dtype !== 'explosive' && Math.random() < tireChance) {
      const isLeft = face === 'left' ? true : face === 'right' ? false : lx > 0;
      const isFront = lz > 0;
      const idx = (isFront ? 0 : 2) + (isLeft ? 0 : 1);
      tgt.damageTire(idx, dmg * 0.9, att);
      att.score.hits++;
    } else {
      tgt.damage(dmg, W.dtype, loc, att);
      att.score.hits++;
    }
    if (W.ignite && Math.random() < W.ignite) tgt.ignite(att);
    if (tgt.isPlayer) { this.shake(0.15 + dmg * 0.03); this.hitDir = Math.atan2(att.x - tgt.x, att.z - tgt.z); this.hitDirT = 0.6; }
    if (att.isPlayer) { this.hitMarker = 0.15; }
    this.audio.sfx(tgt.armor[loc] > 0 ? 'hit_armor' : 'hit_metal', { dist: this.distToCam(tgt.x, tgt.z), volume: 0.6 });
  }

  explode(x, z, W, owner, scale = 1, forceLoc = null, exclude = null) {
    const R = (W.splash || 3) * scale;
    this.fx.explosion(x, z, 0.6 + R / 8, W.color === 0xff3366 ? 0xff5a2a : 0xff7a1a);
    this.audio.sfx(R > 4.5 ? 'explosion_big' : 'explosion_small', { dist: this.distToCam(x, z) });
    for (const o of this.vehicles) {
      if (o.out || o === exclude) continue;
      const d = Math.hypot(o.x - x, o.z - z);
      const reach = R + o.B.L / 2;
      if (d > reach) continue;
      const fall = Math.max(0.25, 1 - d / reach);
      const friendly = this.teams && owner && o.team === owner.team && o !== owner;
      if (friendly) continue;
      const [lx, lz] = o.phys.toLocal(x, z);
      const loc = forceLoc || locFromLocal(o.phys, lx, lz);
      const dmg = rnd(W.dmg[0], W.dmg[1]) * fall * (o === owner ? 0.5 : 1) * DMG_SCALE;
      o.damage(dmg * 0.85, 'explosive', loc, owner);
      o.damage(dmg * 0.15, 'explosive', forceLoc === 'bottom' ? 'bottom' : 'top', owner);
      if (forceLoc === 'bottom') for (let i = 0; i < 4; i++) o.damageTire(i, dmg * 0.25, owner);
      if (owner) owner.score.hits++;
      // knockback
      const k = 2500 * fall * scale;
      const nx = (o.x - x) / (d || 1), nz = (o.z - z) / (d || 1);
      o.phys.applyImpulse(o.x - nx * 0.5, o.z - nz * 0.5, nx * k, nz * k);
      if (o.isPlayer) this.shake(0.6 * fall + 0.2);
    }
    if (this.distToCam(x, z) < 40) this.shake(0.25);
  }

  updateProjectiles(dt) {
    let tracerN = 0;
    const P = this.projectiles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      const x0 = p.x, z0 = p.z;
      if (p.kind === 'rocket' && p.target && !p.target.out) {
        const want = Math.atan2(p.target.x - p.x, p.target.z - p.z);
        const cur = Math.atan2(p.vx, p.vz);
        const turn = p.turn * (p.target.acc.jammer ? 0.5 : 1) * dt;
        const d = wrap(want - cur); const nd = cur + Math.max(-turn, Math.min(turn, d)) + (p.target.acc.jammer ? (Math.random() - 0.5) * 0.08 : 0);
        const sp = Math.hypot(p.vx, p.vz);
        p.vx = Math.sin(nd) * sp; p.vz = Math.cos(nd) * sp;
        if (p.target.smokeHidden) p.target = null;
      }
      if (p.kind === 'rocket') { const sp = Math.hypot(p.vx, p.vz); const acc = Math.min(sp * 1.02 + 30 * dt, p.w.speed * 1.6) / sp; p.vx *= acc; p.vz *= acc; }
      if (p.kind === 'grenade') p.vy -= 20 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      let dead = p.life <= 0;
      // grenade ground bounce
      if (p.kind === 'grenade' && p.y <= 0.2) {
        p.y = 0.2; p.bounces++;
        if (p.bounces >= 2) { this.explode(p.x, p.z, p.w, p.owner); dead = true; }
        else { p.vy = Math.abs(p.vy) * 0.45; p.vx *= 0.6; p.vz *= 0.6; this.audio.sfx('mine_drop', { dist: this.distToCam(p.x, p.z), volume: 0.4 }); }
      }
      // obstacle
      if (!dead) {
        const tb = this.arena.segBlocked(x0, z0, p.x, p.z);
        if (tb !== null) {
          const hx = x0 + (p.x - x0) * tb, hz = z0 + (p.z - z0) * tb;
          if (p.kind === 'rocket' || p.kind === 'grenade') this.explode(hx, hz, p.w, p.owner, 0.8);
          else if (p.kind === 'bullet') { this.fx.sparks(hx, p.y, hz, 3); if (Math.random() < 0.3) this.audio.sfx('ricochet', { dist: this.distToCam(hx, hz), volume: 0.4 }); }
          dead = true;
        }
      }
      // cars
      if (!dead) {
        for (const o of this.vehicles) {
          if (o === p.owner || (o.out && o.outTime > 3)) continue;
          if (p.y > o.B.H + 0.4) continue;
          const r = segVsCar(o.phys, x0, z0, p.x, p.z, p.kind === 'flame' ? 0.9 : 0.05);
          if (!r) continue;
          const hx = x0 + (p.x - x0) * r.t, hz = z0 + (p.z - z0) * r.t;
          const friendly = this.teams && p.owner && o.team === p.owner.team;
          if (p.kind === 'rocket' || p.kind === 'grenade') {
            if (!friendly && !o.out) this.applyHit(p.owner, o, p.w, p.kind === 'grenade' && p.vy < 0 ? 'top' : r.face, r.lx, r.lz, 1);
            this.explode(hx, hz, p.w, p.owner, 0.8, null, friendly ? null : o);
          } else if (!o.out && !friendly) {
            this.applyHit(p.owner, o, p.w, r.face, r.lx, r.lz);
            if (p.kind === 'bullet') { this.fx.sparks(hx, p.y, hz, 4); this.fx.hitFlash(hx, p.y, hz, p.w.color); }
          }
          dead = true; break;
        }
      }
      if (dead) {
        if (p.mesh) p.mesh.visible = false;
        P[i] = P[P.length - 1]; P.pop(); continue;
      }
      // visuals
      if (p.kind === 'bullet') {
        const sp = Math.hypot(p.vx, p.vz);
        this.fx.tracer(tracerN++, p.x, p.y, p.z, p.vx, p.vz, 0, Math.min(4, sp * 0.03) * (p.w.tracer || 1), 0.07 * (p.w.tracer || 1), p.w.color);
      } else if (p.mesh) {
        p.mesh.position.set(p.x, p.y, p.z);
        p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
        if (p.kind === 'rocket') this.fx.rocketTrail(p.x, p.y, p.z, p.w.color);
      }
    }
    this.fx.setTracerCount(tracerN);
  }

  // ---------- drops ----------
  spawnDrop(v, w, mx, mz) {
    const W = w.def;
    const [bx, bz] = v.phys.toWorld(0, -v.B.L / 2 - 1.2);
    const d = { kind: W.drop, x: bx, z: bz, owner: v, w: W, t: 0, life: W.drop === 'smoke' ? 10 : W.drop === 'mine' ? 90 : 30, hits: new Set() };
    const g = new THREE.Group();
    if (W.drop === 'mine') {
      const body = new THREE.Mesh(this.mineGeo, stdMats().dark); body.position.y = 0.1; g.add(body);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), emissive(0xff2244)); light.position.y = 0.22; g.add(light); d.light = light;
    } else if (W.drop === 'oil') {
      const m = new THREE.Mesh(new THREE.CircleGeometry(3.6, 24), new THREE.MeshStandardMaterial({ color: 0x050308, metalness: 1, roughness: 0.05, transparent: true, opacity: 0.92 }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.035; m.scale.setScalar(0.2); g.add(m); d.grow = m;
      const sheen = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 24), additive(0x7a2cff, 0.25)); sheen.rotation.x = -Math.PI / 2; sheen.position.y = 0.04; m.add(sheen); sheen.rotation.x = 0;
    } else if (W.drop === 'spike') {
      const M = stdMats();
      for (let i = 0; i < 14; i++) { const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.22), M.chrome); s.position.set((Math.random() - 0.5) * 4, 0.12, (Math.random() - 0.5) * 3); s.rotation.set(Math.random() * 3, Math.random() * 3, 0); g.add(s); }
    } else if (W.drop === 'smoke') { this.fx.smokeCloud(bx, bz); }
    g.position.set(bx, 0, bz);
    this.scene.add(g); d.mesh = g;
    this.drops.push(d);
  }

  updateDrops(dt) {
    const D = this.drops;
    for (let i = D.length - 1; i >= 0; i--) {
      const d = D[i]; d.t += dt; d.life -= dt;
      let dead = d.life <= 0;
      if (d.kind === 'mine') {
        if (d.light) d.light.visible = Math.sin(this.time * (d.t > 0.8 ? 12 : 4)) > 0;
        if (d.t > 0.8) for (const o of this.vehicles) {
          if (o.out) continue; if (o === d.owner && d.t < 3) continue;
          if (this.teams && o.team === d.owner.team && o !== d.owner) continue;
          if (Math.hypot(o.x - d.x, o.z - d.z) < 2.6) { this.explode(d.x, d.z, d.w, d.owner, 1, 'bottom'); dead = true; break; }
        }
      } else if (d.kind === 'oil') {
        if (d.grow && d.grow.scale.x < 1) d.grow.scale.setScalar(Math.min(1, d.grow.scale.x + dt * 3));
        for (const o of this.vehicles) if (!o.out && Math.hypot(o.x - d.x, o.z - d.z) < 3.8) {
          if (o.oilT <= 0 && o.speed > 6) { o.alert('OIL SLICK!', 'bad'); if (o.speed > 10) this.audio.sfx('oil', { dist: this.distToCam(o.x, o.z), volume: 0.5 }); }
          o.oilT = 0.6;
        }
        if (d.life < 3) d.mesh.children[0].material.opacity = d.life / 3 * 0.92;
      } else if (d.kind === 'spike') {
        for (const o of this.vehicles) {
          if (o.out || d.hits.has(o) || (o === d.owner && d.t < 2)) continue;
          if (Math.hypot(o.x - d.x, o.z - d.z) < 2.8 && o.speed > 2) {
            d.hits.add(o);
            for (let k = 0; k < 4; k++) if (Math.random() < 0.6) o.damageTire(k, rnd(d.w.dmg[0], d.w.dmg[1]), d.owner);
            this.audio.sfx('tire_pop', { dist: this.distToCam(o.x, o.z) });
            this.fx.sparks(o.x, 0.3, o.z, 8);
          }
        }
      } else if (d.kind === 'smoke') {
        if (Math.random() < dt * 4) this.fx.smokeCloud(d.x + (Math.random() - 0.5) * 3, d.z + (Math.random() - 0.5) * 3);
      }
      if (dead) { this.scene.remove(d.mesh); D[i] = D[D.length - 1]; D.pop(); }
    }
  }

  // ---------- pickups ----------
  updatePickups(dt) {
    if (!this.started) return;
    this.pickupT -= dt;
    if (this.pickupT <= 0 && this.pickups.length < 3) {
      this.pickupT = 11 + Math.random() * 6;
      const kinds = [['repair', 0x3cff9a, '+'], ['ammo', 0xffe14a, 'A'], ['cool', 0x33f0ff, '❄']];
      const [kind, color] = kinds[Math.floor(Math.random() * kinds.length)];
      const pt = this.arena.randomPoint(10);
      const g = new THREE.Group();
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), new THREE.MeshStandardMaterial({ color: 0x1a1028, emissive: color, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
      cube.position.y = 1.3; g.add(cube);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color })); cube.add(edges);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 14, 16, 1, true), additive(color, 0.12)); beam.position.y = 7; g.add(beam);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2, 32), additive(color, 0.6)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
      g.position.set(pt.x, 0, pt.z);
      this.scene.add(g);
      this.pickups.push({ kind, color, x: pt.x, z: pt.z, mesh: g, cube, t: 0 });
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i]; pk.t += dt;
      pk.cube.rotation.y += dt * 2; pk.cube.rotation.x += dt * 0.7; pk.cube.position.y = 1.3 + Math.sin(pk.t * 3) * 0.25;
      for (const o of this.vehicles) {
        if (o.out || Math.hypot(o.x - pk.x, o.z - pk.z) > 3.2) continue;
        this.applyPickup(o, pk);
        this.fx.pickupBurst(pk.x, pk.z, pk.color);
        this.audio.sfx('pickup', { dist: this.distToCam(pk.x, pk.z) });
        this.scene.remove(pk.mesh); pk.dead = true;
        this.pickups.splice(i, 1); break;
      }
    }
  }
  applyPickup(o, pk) {
    if (pk.kind === 'repair') {
      for (const l of LOCATIONS) o.armor[l] = Math.min(o.armorMax[l], o.armor[l] + Math.ceil(o.armorMax[l] * 0.3));
      for (let k = 0; k < 4; k++) if (o.tires[k] > 0) o.tires[k] = Math.min(o.tireMax, o.tires[k] + o.tireMax * 0.5);
      o.structure = Math.min(o.structureMax, o.structure + o.structureMax * 0.15);
      o.alert('REPAIR KIT +30% ARMOR', 'good');
    } else if (pk.kind === 'ammo') {
      for (const w of o.weapons) if (isFinite(w.ammo)) w.ammo = Math.min(w.maxAmmo, w.ammo + Math.ceil(w.maxAmmo * 0.5));
      o.energy = Math.min(o.energyMax, o.energy + 2);
      o.alert('AMMO RESUPPLY', 'good');
    } else {
      o.heat = 0; o.burning = 0; o.energy = Math.min(o.energyMax, o.energy + o.energyMax * 0.35);
      o.alert('COOLANT + RECHARGE', 'good');
    }
  }
  nearestPickup(v) {
    let best = null, bd = Infinity;
    for (const pk of this.pickups) { const d = Math.hypot(pk.x - v.x, pk.z - v.z); if (d < bd) { bd = d; best = pk; } }
    return best;
  }

  // ---------- events / end ----------
  processEvents() {
    for (const e of this.events) {
      if (e.t === 'out') {
        const v = e.v;
        if (e.explode) { this.fx.explosion(v.x, v.z, 1.8, 0xff5a2a); this.audio.sfx('explosion_big', { dist: this.distToCam(v.x, v.z) }); v.phys.vx += rnd(-3, 3); v.phys.w += rnd(-2, 2); if (this.distToCam(v.x, v.z) < 60) this.shake(0.8); }
        else { this.fx.sparks(v.x, 1, v.z, 12); }
        const k = v.killer && v.killer !== v ? v.killer : null;
        this.feed.push({ t: this.time, killer: k, victim: v, reason: v.outReason });
        if (k && k.isPlayer) { this.audio.sfx('kill'); this.killFlash = 1.2; }
        if (v.isPlayer) { this.spectate = k && !k.out ? k : null; this.audio.sfx('alarm'); }
        // wreck look
        v.model.paintMat.color.multiplyScalar(0.25); v.model.paintMat.roughness = 0.9; v.model.paintMat.clearcoat = 0;
        v.model.glow.visible = false;
      } else if (e.t === 'tirepop') {
        this.audio.sfx('tire_pop', { dist: this.distToCam(e.v.x, e.v.z) });
        if (e.v.rubber[e.i]) e.v.rubber[e.i].visible = false;
      }
    }
    this.events.length = 0;
  }

  checkEnd(dt) {
    if (this.over) return;
    const alive = this.vehicles.filter(v => !v.out);
    let done = false;
    if (this.teams) { const ts = new Set(alive.map(v => v.team)); done = ts.size <= 1; }
    else done = alive.length <= 1;
    if (this.started && this.time - 3.6 > this.timeLimit) done = true;
    if (done) { this.endDelay = (this.endDelay ?? 2.5) - dt; if (this.endDelay <= 0) this.finish(); }
  }

  finish() {
    this.over = true;
    const P = this.player;
    const alive = this.vehicles.filter(v => !v.out);
    let won;
    if (this.teams) {
      const teamScore = [0, 1].map(t => this.vehicles.filter(v => v.team === t && !v.out).length * 1000 + this.vehicles.filter(v => v.team === t).reduce((s, v) => s + v.score.dmgDealt, 0));
      won = alive.length && alive.every(v => v.team === 0) ? true : (alive.some(v => v.team === 0) && teamScore[0] > teamScore[1]);
    } else won = !P.out && alive.length >= 1 && alive.every(v => v === P || v.score.dmgDealt < P.score.dmgDealt) ;
    // ranking: alive first, then by out time order, kills, damage
    const outOrder = this.feed.map(f => f.victim);
    const rank = this.vehicles.slice().sort((a, b) => {
      if (a.out !== b.out) return a.out ? 1 : -1;
      if (a.out && b.out) return outOrder.indexOf(b) - outOrder.indexOf(a);
      return (b.score.kills * 100 + b.score.dmgDealt) - (a.score.kills * 100 + a.score.dmgDealt);
    });
    const place = rank.indexOf(P) + 1;
    const div = this.division;
    let prize = Math.round(div.prize * (won ? 1 : place === 2 ? 0.4 : 0.1) + P.score.kills * div.prize * 0.25 + P.score.dmgDealt * 5);
    this.result = { won, place, rank, prize, time: this.time, division: div, mode: this.cfg.mode };
  }

  // ---------- visuals ----------
  syncVisuals(dt) {
    for (const v of this.vehicles) {
      const m = v.model, p = v.phys;
      m.root.position.set(p.x, 0, p.z); m.root.rotation.y = p.h;
      const roll = Math.max(-0.12, Math.min(0.12, p.ay * 0.009 * (v.B.H / 1.4)));
      const pitch = Math.max(-0.07, Math.min(0.07, -p.ax * 0.006));
      m.body.rotation.z += (roll - m.body.rotation.z) * Math.min(1, dt * 8);
      m.body.rotation.x += (pitch - m.body.rotation.x) * Math.min(1, dt * 8);
      if (v.out && v.exploded) { m.body.position.y = Math.max(0, m.body.position.y); }
      for (const w of m.wheels) { if (w.front) w.steer.rotation.y = p.steer; w.spin.rotation.x = p.wheelSpin; }
      if (m.turret) m.turret.rotation.y = v.turretYaw;
      m.glow.material.opacity = v.flash > 0 ? 1 : 0.55;
      // particles
      const hf = v.healthFrac();
      const [rx, rz] = p.toWorld(0, -v.B.L * 0.3);
      if (v.out) { if (Math.random() < dt * 14) this.fx.smokePuff(p.x, 1.2, p.z, 0.9, 1.4); if (v.exploded && v.outTime < 6 && Math.random() < dt * 20) this.fx.fire(p.x, 1, p.z, 1.6); continue; }
      if (hf < 0.55 && Math.random() < dt * (1 - hf) * 14) { const [fx, fz] = p.toWorld(0, v.B.L * 0.35); this.fx.smokePuff(fx, v.B.H * 0.7, fz, hf < 0.3 ? 0.9 : 0.4); }
      if (v.burning > 0 && Math.random() < dt * 30) this.fx.fire(rx, v.B.H * 0.6, rz, 1);
      if (v.overheated && Math.random() < dt * 10) this.fx.smokePuff(p.x, v.B.H, p.z, 0.2, 0.6);
      if (p.slip > 0.45 && v.speed > 6 && Math.random() < dt * 30 * p.slip) { const [sx, sz] = p.toWorld((Math.random() < 0.5 ? 1 : -1) * v.B.track / 2, -v.B.wheelbase / 2); this.fx.skid(sx, sz); }
      if (v.input.boost && v.speed > 3) { const [bx, bz] = p.toWorld(0, -v.B.L / 2 - 0.2); for (let k = 0; k < 2; k++) this.fx.boost(bx + (Math.random() - 0.5) * 0.6, 0.6, bz, v.color); }
      for (let k = 0; k < 4; k++) if (v.tires[k] <= 0 && v.speed > 4 && Math.random() < dt * 25) {
        const [sx, sz] = p.toWorld((k % 2 ? -1 : 1) * v.B.track / 2, (k < 2 ? 1 : -1) * v.B.wheelbase / 2); this.fx.sparks(sx, 0.1, sz, 2);
      }
      if (v.empT > 0 && Math.random() < dt * 20) this.fx.sparks(p.x, v.B.H, p.z, 2, 0x66aaff);
    }
  }

  shake(a) { this.shakeAmt = Math.min(1.5, this.shakeAmt + a); }
  distToCam(x, z) { const c = this.focus || this.player; return Math.hypot(x - c.x, z - c.z); }

  updateCamera(dt) {
    const P = this.player;
    let f = P;
    if (this.cfg.demo) {
      this.demoT = (this.demoT || 0) - dt;
      if (!this.demoFocus || this.demoFocus.out && this.demoFocus.outTime > 3 || this.demoT <= 0) {
        const alive = this.vehicles.filter(v => !v.out); this.demoFocus = alive[Math.floor(Math.random() * alive.length)] || P; this.demoT = 9;
      }
      f = this.demoFocus;
    } else if (P.out && P.outTime > 2.5) {
      if (!this.spectate || this.spectate.out) this.spectate = this.vehicles.find(v => !v.out) || P;
      f = this.spectate;
    }
    this.focus = f;
    const cam = this.camera;
    const portrait = this.aspect < 1;
    const sp = f.speed;
    // camera yaw follows heading (and blends toward velocity while sliding)
    let targetYaw = f.h;
    if (this.cfg.demo) targetYaw = f.h + Math.sin(this.time * 0.25) * 1.2;
    const dy = wrap(targetYaw - this.camYaw);
    this.camYaw += dy * Math.min(1, dt * (this.camMode === 2 ? 1.5 : 3.2));
    const modes = [
      { dist: 13, height: 12.5, ahead: 6 },  // high chase
      { dist: 7.5, height: 26, ahead: 4 },   // top-down-ish
      { dist: 9, height: 5.5, ahead: 8 },     // low chase
    ];
    const md = modes[this.camMode];
    const dist = (md.dist + sp * 0.12) * (portrait ? 1.35 : 1);
    const height = (md.height + sp * 0.08) * (portrait ? 1.3 : 1);
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const tx = f.x - fx * dist, tz = f.z - fz * dist;
    const k = Math.min(1, dt * 6);
    if (!this.camInit) { cam.position.set(tx, height, tz); this.camInit = true; }
    cam.position.x += (tx - cam.position.x) * k; cam.position.z += (tz - cam.position.z) * k; cam.position.y += (height - cam.position.y) * k;
    const ahead = md.ahead + sp * 0.25;
    const lx = f.x + fx * ahead, lz = f.z + fz * ahead;
    if (this.shakeAmt > 0.01) {
      const s = this.shakeAmt * (this.game.settings.shake ? 0.6 : 0);
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s;
      this.shakeAmt *= Math.pow(0.02, dt);
    }
    cam.lookAt(lx, 0, lz);
    const fov = (portrait ? 72 : 58) + Math.min(14, sp * 0.22) + (P.input.boost ? 5 : 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
  }

  setAspect(a, h) { this.aspect = a; this.camera.aspect = a; this.camera.updateProjectionMatrix(); this.fx.setPixelScale(h); }

  dispose() {
    for (const v of this.vehicles) { this.scene.remove(v.model.root); disposeCar(v.model); }
    for (const d of this.drops) this.scene.remove(d.mesh);
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.fx.clear();
    this.arena.dispose();
    this.audio.stopLoops();
  }
}
