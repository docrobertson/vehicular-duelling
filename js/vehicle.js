// Runtime vehicle: physics + damage model + heat/energy + weapon states.
import { BODIES, MOTORS, BATTERIES, TIRES, BRAKES, SUSPENSIONS, ARMORS, COMPUTERS, WEAPONS, CREW, LOCATIONS } from './data.js';
import { computeStats } from './design.js';
import { CarPhysics } from './physics.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class Vehicle {
  constructor(design, opts = {}) {
    this.design = design;
    this.stats = computeStats(design);
    const B = BODIES[design.body], M = MOTORS[design.motor], BT = BATTERIES[design.battery];
    const T = TIRES[design.tires], BR = BRAKES[design.brakes], S = SUSPENSIONS[design.suspension];
    this.B = B; this.armorType = ARMORS[design.armorType]; this.computer = COMPUTERS[design.computer];
    this.id = opts.id ?? 0;
    this.team = opts.team ?? 0;
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name || design.name;
    this.driverName = opts.driverName || design.driver?.name || 'Driver';
    this.color = opts.color;
    const perk = design.driver?.perk;
    this.perk = perk;
    const acc = design.accessories || {};
    this.acc = acc;
    this.phys = new CarPhysics({
      mass: this.stats.mass, L: B.L, W: B.W, H: B.H, wheelbase: B.wheelbase, track: B.track, wheelR: B.wheelR,
      cd: B.cd, area: B.area, kW: M.kW * (perk === 'hotfoot' ? 1.08 : 1), grip: T.grip, brake: BR.force, abs: BR.abs,
      handling: B.handling * S.handling, downforce: acc.spoiler ? 0.35 : 0, boostMul: acc.capacitor ? 1.6 : 1.35,
    });
    // ---- damage model ----
    this.armor = {}; this.armorMax = {};
    for (const l of LOCATIONS) { this.armor[l] = design.armor[l] || 0; this.armorMax[l] = Math.max(1, design.armor[l] || 0); }
    this.structureMax = this.structure = B.structure;
    const compMul = perk === 'mechanic' ? 1.25 : 1;
    this.tireMax = Math.round(T.dp * compMul);
    this.tires = [this.tireMax, this.tireMax, this.tireMax, this.tireMax]; // FL FR RL RR
    const crewDp = CREW.dp + (perk === 'tough' ? 3 : 0);
    this.comps = {
      motor: { name: 'Motor', dp: M.dp * compMul, max: M.dp * compMul },
      battery: { name: 'Battery', dp: BT.dp * compMul, max: BT.dp * compMul },
      driver: { name: 'Driver', dp: crewDp, max: crewDp },
    };
    if (design.gunner) this.comps.gunner = { name: 'Gunner', dp: crewDp, max: crewDp };
    // ---- weapons ----
    this.weapons = design.weapons.map((w, i) => {
      const W = WEAPONS[w.w];
      return {
        i, def: W, loc: w.loc, ammo: isFinite(W.maxAmmo) ? w.ammo : Infinity, maxAmmo: isFinite(W.maxAmmo) ? Math.max(1, w.ammo) : Infinity,
        cd: Math.random() * 0.2, dp: W.dp * compMul, maxDp: W.dp * compMul, destroyed: false, salvo: 0, lockT: 0,
      };
    });
    this.hasTurret = this.weapons.some(w => w.loc === 'top');
    // ---- systems ----
    this.heat = 0; this.heatMax = 100;
    this.energyMax = BT.kWh; this.energy = BT.kWh;
    this.dissipation = this.stats.dissipation;
    this.motorHeat = M.heat;
    this.burning = 0; this.empT = 0; this.oilT = 0; this.smokeBlind = 0;
    this.turretYaw = 0; // relative to body
    this.target = null; this.gunnerTarget = null;
    this.alive = true; this.out = false; this.outReason = ''; this.outTime = 0;
    this.immobileT = 0;
    this.lastAttacker = null; this.lastHitT = 0;
    this.score = { kills: 0, dmgDealt: 0, dmgTaken: 0, shots: 0, hits: 0, rams: 0 };
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, fire: { front: false, top: false, left: false, right: false, back: false } };
    this.flash = 0; // hit flash timer for visuals
    this.alerts = [];
    this.repairT = 0;
    this.massT = 0;
  }

  get x() { return this.phys.x; } get z() { return this.phys.z; }
  get h() { return this.phys.h; }
  get speed() { return this.phys.speed; }
  get driverAlive() { return this.comps.driver.dp > 0; }
  get gunnerAlive() { return !!this.comps.gunner && this.comps.gunner.dp > 0; }
  get crewAlive() { return this.driverAlive || this.gunnerAlive; }
  get overheated() { return this.heat >= this.heatMax; }
  get immobile() { return this.comps.motor.dp <= 0 || this.tires.filter(t => t <= 0).length >= 3; }
  totalArmor() { let s = 0; for (const l of LOCATIONS) s += this.armor[l]; return s; }
  totalArmorMax() { let s = 0; for (const l of LOCATIONS) s += this.armorMax[l]; return s; }
  healthFrac() { return Math.max(0, (this.totalArmor() / this.totalArmorMax()) * 0.5 + (this.structure / this.structureMax) * 0.5); }

  // ---- damage ----
  damage(amount, dtype, loc, attacker = null, opts = {}) {
    if (this.out || amount <= 0) return 0;
    const res = dtype && this.armorType.resist[dtype] !== undefined ? this.armorType.resist[dtype] : 1;
    let dmg = amount * (this.armor[loc] > 0 ? res : 1);
    if (opts.ramReduce) dmg *= opts.ramReduce;
    const absorbed = Math.min(this.armor[loc], dmg);
    this.armor[loc] -= absorbed;
    let over = dmg - absorbed;
    if (dtype === 'fire') this.heat += amount * 1.5;
    if (over > 0) {
      this.structure -= over * 0.55;
      this.hitComponent(loc, over, attacker);
      if (Math.random() < over * 0.04 && (loc === 'back' || loc === 'bottom')) this.ignite(attacker);
    }
    if (dtype === 'fire' && (this.armor[loc] <= 0 || Math.random() < 0.02)) this.ignite(attacker);
    this.score.dmgTaken += dmg;
    if (attacker && attacker !== this) { attacker.score.dmgDealt += dmg; this.lastAttacker = attacker; this.lastHitT = 0; }
    this.flash = 0.12;
    if (this.structure <= 0) this.knockOut('Destroyed', attacker, true);
    return dmg;
  }

  hitComponent(loc, amt, attacker) {
    const pool = [];
    for (const w of this.weapons) if (w.loc === loc && !w.destroyed) pool.push([w, 1.4]);
    const c = this.comps;
    const add = (k, wgt) => { if (c[k] && c[k].dp > 0) pool.push([c[k], wgt]); };
    if (loc === 'front') { add('motor', 2); add('driver', 0.5); }
    if (loc === 'back') { add('battery', 1.6); add('motor', 0.4); }
    if (loc === 'left') { add('driver', 1); }
    if (loc === 'right') { if (c.gunner) add('gunner', 1); else add('driver', 0.5); }
    if (loc === 'top') { add('driver', 0.6); add('gunner', 1); }
    if (loc === 'bottom') { add('battery', 2); add('motor', 0.6); }
    if ((loc === 'left' || loc === 'right') && Math.random() < 0.3) { this.damageTire(loc === 'left' ? (Math.random() < 0.5 ? 0 : 2) : (Math.random() < 0.5 ? 1 : 3), amt * 0.5, attacker); }
    pool.push(['structure', 1.2]); // much of the overflow just bends the frame
    let tot = pool.reduce((s, p) => s + p[1], 0), r = Math.random() * tot, pick = pool[0][0];
    for (const [p, wgt] of pool) { r -= wgt; if (r <= 0) { pick = p; break; } }
    if (pick === 'structure') { this.structure -= amt * 0.45; if (this.structure <= 0) this.knockOut('Destroyed', attacker, true); return; }
    const isCrew = pick === c.driver || pick === c.gunner;
    let a = amt * (isCrew ? 0.4 : 0.65);
    if (isCrew && this.acc.crewarmor) a *= 0.5;
    pick.dp -= a;
    if (pick.dp <= 0 && !pick._dead) {
      pick._dead = true; pick.dp = 0;
      if (pick.def) { pick.destroyed = true; this.alert(`${pick.def.short} DESTROYED`, 'bad'); }
      else if (pick === c.driver) { this.alert(this.gunnerAlive ? 'DRIVER DOWN — GUNNER TAKES THE WHEEL' : 'DRIVER KILLED', 'bad'); }
      else if (pick === c.gunner) this.alert('GUNNER DOWN', 'bad');
      else if (pick === c.motor) this.alert('MOTOR DESTROYED', 'bad');
      else if (pick === c.battery) { this.alert('BATTERY BREACHED', 'bad'); this.ignite(attacker); this.energy = Math.min(this.energy, this.energyMax * 0.15); }
      if (!this.crewAlive) this.knockOut('Crew killed', attacker, false);
    }
  }

  damageTire(i, amt, attacker) {
    if (this.tires[i] <= 0 || this.out) return;
    this.tires[i] -= amt;
    if (attacker && attacker !== this) attacker.score.dmgDealt += amt * 0.5;
    if (this.tires[i] <= 0) { this.tires[i] = 0; this.alert(['FL', 'FR', 'RL', 'RR'][i] + ' TIRE BLOWN', 'bad'); this.events?.push({ t: 'tirepop', v: this, i }); }
  }

  ignite(attacker) {
    if (this.burning > 0 || this.out) return;
    this.burning = rnd(4, 9); this.fireAttacker = attacker;
    this.alert('ON FIRE!', 'bad');
  }

  knockOut(reason, attacker, explode) {
    if (this.out) return;
    this.out = true; this.alive = false; this.outReason = reason; this.outTime = 0;
    this.killer = attacker || this.lastAttacker;
    if (this.killer && this.killer !== this) this.killer.score.kills++;
    this.exploded = explode;
    this.events?.push({ t: 'out', v: this, explode });
  }

  alert(msg, kind = 'info') { if (this.isPlayer) this.alerts.push({ msg, kind }); }

  // ---- per-frame systems (not physics) ----
  updateSystems(dt) {
    const p = this.phys;
    // power availability
    const mr = this.comps.motor.dp / this.comps.motor.max;
    let pm = this.comps.motor.dp <= 0 ? 0 : 0.35 + 0.65 * mr;
    if (this.comps.battery.dp <= 0) pm *= 0.35;
    if (this.energy <= 0) pm *= 0.2;
    if (this.overheated) pm *= 0.65;
    if (!this.driverAlive) pm *= this.gunnerAlive ? 0.85 : 0;
    if (this.out) pm = 0;
    p.powerMul = pm;
    // tyre grip
    for (let i = 0; i < 4; i++) p.wheelGrip[i] = this.tires[i] <= 0 ? 0.28 : 0.55 + 0.45 * (this.tires[i] / this.tireMax);
    p.gripMul = this.oilT > 0 ? 0.3 : 1;
    if (this.oilT > 0) this.oilT -= dt;
    // energy drain
    const thr = Math.max(this.input.throttle, this.input.brake * 0.5);
    const kW = this.phys.spec.kW * pm * thr * (this.input.boost ? this.phys.spec.boostMul : 1);
    this.energy = Math.max(0, this.energy - kW * dt * 2 / 3600 - 0.0004 * dt);
    // heat
    this.heat += this.motorHeat * thr * (this.input.boost ? 14 : 1.8) * dt;
    if (this.burning > 0) {
      this.burning -= dt * (this.acc.extinguish ? 4 : 1);
      this.heat += 7 * dt;
      if (Math.random() < dt * 3) this.damage(rnd(0.4, 1.0), 'fire', LOCATIONS[Math.floor(Math.random() * 6)], this.fireAttacker);
      if (this.burning <= 0) this.alert('FIRE OUT', 'good');
    }
    this.heat = Math.max(0, this.heat - this.dissipation * dt * (this.speed > 15 ? 1.25 : 1));
    if (this.heat > 135) {
      this.heat = Math.min(this.heat, 150);
      if (Math.random() < dt * 2) this.hitComponent(Math.random() < 0.5 ? 'front' : 'bottom', 0.6, this.lastAttacker);
    }
    if (this.empT > 0) this.empT -= dt;
    if (this.smokeBlind > 0) this.smokeBlind -= dt;
    if (this.flash > 0) this.flash -= dt;
    // nanite repair
    if (this.acc.repair && !this.out) {
      this.repairT += dt;
      if (this.repairT > 1.5) {
        this.repairT = 0;
        let worst = null, wr = 1;
        for (const l of LOCATIONS) { const r = this.armor[l] / this.armorMax[l]; if (r < wr && this.armorMax[l] > 1) { wr = r; worst = l; } }
        if (worst) this.armor[worst] = Math.min(this.armorMax[worst], this.armor[worst] + 1);
      }
    }
    // weapons cooldown
    for (const w of this.weapons) if (w.cd > 0) w.cd -= dt;
    // mass update (ammo expended) every second
    this.massT += dt;
    if (this.massT > 1) {
      this.massT = 0;
      let spent = 0; for (const w of this.weapons) if (isFinite(w.ammo)) spent += (w.maxAmmo - w.ammo) * w.def.ammoMass;
      p.setMass(Math.max(this.B.mass * 0.8, this.stats.mass - spent));
    }
    // immobile timeout
    if (!this.out) {
      if (this.immobile || p.powerMul <= 0.01) this.immobileT += dt; else this.immobileT = Math.max(0, this.immobileT - dt);
      if (this.immobileT > 18) this.knockOut('Immobilized', this.lastAttacker, false);
      const anyGun = this.weapons.some(w => !w.destroyed && w.def.type !== 'passive' && (w.ammo > 0));
      if (this.immobile && !anyGun && this.immobileT > 4) this.knockOut('Disabled', this.lastAttacker, false);
    } else this.outTime += dt;
    if (this.lastHitT !== undefined) this.lastHitT += dt;
  }

  canFire(w) {
    if (this.out || w.destroyed || w.cd > 0) return false;
    if (w.def.type === 'passive') return false;
    if (!(w.ammo > 0)) return false;
    if (this.empT > 0) return false;
    if (w.def.heat > 0.5 && this.overheated) return false;
    if (w.def.energy > 0 && this.energy < w.def.energy) return false;
    if (!this.driverAlive && !this.gunnerAlive) return false;
    return true;
  }
}
