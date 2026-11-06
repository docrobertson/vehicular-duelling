// Vehicle design model: totals, validation, performance estimates, AI auto-design, presets.
import {
  BODIES, MOTORS, BATTERIES, TIRES, BRAKES, SUSPENSIONS, ARMORS, COMPUTERS, WEAPONS,
  ACCESSORIES, CREW, LOCATIONS, divisionFor, PAINTS, AI_CAR_NAMES,
} from './data.js';

export const TURRET_COST = 600;   // per top-mounted weapon (turret ring + traverse)
export const TURRET_MASS = 45;

let _uid = 1;
export function newId() { return 'd' + Date.now().toString(36) + (_uid++).toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

export function blankDesign(bodyId = 'sedan') {
  return {
    id: newId(), name: 'New Wheels', body: bodyId,
    motor: 'm110', battery: 'b_std', tires: 'std', brakes: 'std', suspension: 'std',
    armorType: 'composite', armor: { front: 20, back: 15, left: 15, right: 15, top: 8, bottom: 8 },
    computer: 'none', weapons: [], accessories: {}, gunner: false,
    paint: 'hotpink', driver: { name: 'You', perk: 'steady' },
  };
}

export function cloneDesign(d) { const c = JSON.parse(JSON.stringify(d)); c.id = newId(); return c; }

export function ammoCap(d, w) {
  const W = WEAPONS[w.w];
  if (!isFinite(W.maxAmmo)) return Infinity;
  const boxes = d.accessories.ammobox || 0;
  return Math.round(W.maxAmmo * (1 + 0.5 * boxes));
}

export function mountsUsed(d) {
  const m = {}; for (const l of LOCATIONS) m[l] = 0;
  for (const w of d.weapons) m[w.loc]++;
  return m;
}

export function computeStats(d) {
  const B = BODIES[d.body], M = MOTORS[d.motor], BT = BATTERIES[d.battery], T = TIRES[d.tires];
  const BR = BRAKES[d.brakes], S = SUSPENSIONS[d.suspension], A = ARMORS[d.armorType], C = COMPUTERS[d.computer];
  const crew = d.gunner ? 2 : 1;
  const parts = [];
  let mass = 0, cost = 0, space = 0;
  const add = (label, m, c, s) => { mass += m; cost += c; space += s; parts.push({ label, m, c, s }); };

  add('Body: ' + B.name, B.mass, B.cost, 0);
  add('Motor: ' + M.name, M.mass, M.cost, M.space);
  add('Battery: ' + BT.name, BT.mass, BT.cost, BT.space);
  add('Tires x4: ' + T.name, T.mass * 4, T.cost * 4, 0);
  add('Brakes: ' + BR.name, BR.mass, BR.cost, 0);
  add('Suspension: ' + S.name, S.mass, S.cost, 0);
  let ap = 0; for (const l of LOCATIONS) ap += d.armor[l] || 0;
  add(`Armor: ${A.name} (${ap} AP)`, ap * A.massPerAP * B.armorWeightMul, ap * A.costPerAP, 0);
  if (C.id !== 'none') add('Computer: ' + C.name, C.mass, C.cost, C.space);
  add(`Crew x${crew}`, CREW.mass * crew, 0, CREW.space * crew);
  for (const w of d.weapons) {
    const W = WEAPONS[w.w];
    const rounds = isFinite(W.maxAmmo) ? (w.ammo || 0) : 0;
    let m = W.mass + rounds * W.ammoMass, c = W.cost + rounds * W.ammoCost;
    if (w.loc === 'top') { m += TURRET_MASS; c += TURRET_COST; }
    add(`${W.name} [${w.loc}]` + (rounds ? ` +${rounds} rds` : ''), m, c, W.space);
  }
  for (const [k, n] of Object.entries(d.accessories)) {
    if (!n) continue; const X = ACCESSORIES[k];
    add(`${X.name}${n > 1 ? ' x' + n : ''}`, X.mass * n, X.cost * n, X.space * n);
  }

  const maxGross = Math.round(B.maxGross * S.loadMul);
  // --- performance ---
  const g = 9.81, rho = 1.2, crr = 0.015;
  const P = M.kW * 1000 * (d.driver?.perk === 'hotfoot' ? 1.08 : 1);
  // top speed: solve P = (0.5 rho CdA v^2 + crr m g) v by bisection
  let lo = 0, hi = 120;
  for (let i = 0; i < 40; i++) { const v = (lo + hi) / 2; const f = (0.5 * rho * B.cd * B.area * v * v + crr * mass * g) * v; if (f > P) hi = v; else lo = v; }
  const vmax = lo;
  // 0-100 km/h estimate via quick integration
  let v = 0, t = 0; const mu = 1.05 * T.grip;
  const tractionF = mu * mass * g * 0.62;
  while (v < 27.78 && t < 30) {
    const Fd = Math.min(P / Math.max(v, 12), tractionF);
    const a = (Fd - 0.5 * rho * B.cd * B.area * v * v - crr * mass * g) / mass;
    if (a <= 0.01) { t = 99; break; }
    v += a * 0.02; t += 0.02;
  }
  const loadFactor = 1 - 0.08 * (mass / 1000 - 1);
  const handling = B.handling * S.handling * T.grip * loadFactor * (d.accessories.spoiler ? 1.04 : 1);
  const brakeDist = (27.78 * 27.78) / (2 * g * Math.min(BR.force * 0.95, mu * 1.1));
  const sinks = d.accessories.heatsink || 0;
  const dissipation = 7 * (1 + 0.35 * sinks);
  const dpsEst = d.weapons.reduce((s, w) => { const W = WEAPONS[w.w]; return s + (W.type === 'passive' || W.type === 'drop' ? 0 : (W.dmg[0] + W.dmg[1]) / 2 * W.rof); }, 0);
  const heatEst = d.weapons.reduce((s, w) => s + WEAPONS[w.w].heat * WEAPONS[w.w].rof, 0);

  return {
    mass: Math.round(mass), cost: Math.round(cost), space, maxSpace: B.space, maxGross, parts, ap,
    vmax, kmh: vmax * 3.6, accel: t, handling, brakeDist, dissipation, dps: dpsEst, heatRate: heatEst,
    pw: M.kW / (mass / 1000), crew, kWh: BT.kWh,
    division: divisionFor(cost),
  };
}

export function validate(d, stats = computeStats(d)) {
  const B = BODIES[d.body], errs = [], warns = [];
  if (stats.mass > stats.maxGross) errs.push(`Overweight: ${stats.mass} / ${stats.maxGross} kg`);
  if (stats.space > B.space) errs.push(`Out of space: ${stats.space} / ${B.space} SP`);
  const mu = mountsUsed(d);
  for (const l of LOCATIONS) {
    if (mu[l] > B.mounts[l]) errs.push(`Too many ${l} weapons (${mu[l]}/${B.mounts[l]})`);
    if ((d.armor[l] || 0) > B.armorMax) errs.push(`${l} armor above max ${B.armorMax}`);
  }
  for (const w of d.weapons) {
    const W = WEAPONS[w.w];
    if (!W.allowed.includes(w.loc)) errs.push(`${W.name} can't mount ${w.loc}`);
    if (W.needsComputer && d.computer === 'none') warns.push(`${W.name} needs a targeting computer to lock on`);
  }
  const rams = d.weapons.filter(w => w.w === 'ram');
  if (new Set(rams.map(r => r.loc)).size < rams.length) errs.push('Only one ram per side');
  if (!d.weapons.some(w => !['passive', 'drop'].includes(WEAPONS[w.w].type))) warns.push('No guns — hope you like ramming!');
  if (stats.heatRate > stats.dissipation * 1.6) warns.push('Weapons will overheat fast — add heat sinks');
  if (stats.accel > 12) warns.push('Sluggish — consider a bigger motor');
  return { ok: errs.length === 0, errs, warns };
}

// ---------- AI auto-designer ----------
function rngPick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

export const ARCHETYPES = ['gunslinger', 'artillery', 'laser', 'brawler', 'trickster', 'tank'];

export function autoDesign(budget, rng = Math.random, archetype = rngPick(rng, ARCHETYPES), minCost = 0) {
  const bodyChoices = budget < 9500 ? ['mini', 'coupe', 'mini'] : budget < 12000 ? ['mini', 'coupe', 'sedan']
    : budget < 21000 ? ['coupe', 'sedan', 'pickup', 'suv']
    : ['sedan', 'pickup', 'suv', 'van', 'coupe'];
  const plans = {
    gunslinger: [['mg', 'front'], ['mg', 'front'], ['ac', 'top'], ['mine', 'back'], ['mg', 'back']],
    artillery: [['rkt', 'front'], ['rkt', 'front'], ['hrkt', 'top'], ['gl', 'back'], ['mg', 'top']],
    laser: [['las', 'front'], ['mg', 'front'], ['hlas', 'top'], ['emp', 'front'], ['oil', 'back']],
    brawler: [['ram', 'front'], ['flame', 'front'], ['mg', 'front'], ['flame', 'left'], ['flame', 'right'], ['spike', 'back'], ['mg', 'top']],
    trickster: [['mg', 'front'], ['oil', 'back'], ['rkt', 'front'], ['mine', 'bottom'], ['smoke', 'back'], ['rkt', 'top']],
    tank: [['ac', 'front'], ['ram', 'front'], ['mg', 'top'], ['ac', 'top'], ['rkt', 'top'], ['mg', 'left'], ['mg', 'right'], ['mine', 'back']],
  };
  let best = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    const bodyId = archetype === 'tank' && budget > 14000 ? rngPick(rng, ['van', 'suv', 'pickup']) : rngPick(rng, bodyChoices);
    const d = blankDesign(bodyId);
    const B = BODIES[d.body];
    d.paint = rngPick(rng, PAINTS).id;
    d.name = rngPick(rng, AI_CAR_NAMES);
    d.driver = { name: 'AI', perk: rngPick(rng, ['hotfoot', 'steady', 'tough', 'mechanic']) };
    d.weapons = []; d.accessories = {};
    for (const l of LOCATIONS) d.armor[l] = 0;
    d.motor = 'm60'; d.battery = 'b_std';
    const f = budget / 20000;
    const st = () => computeStats(d);
    const ok = (cap = budget) => { const s = st(); return validate(d, s).ok && s.cost <= cap; };
    const tryset = (key, val, cap) => { const old = d[key]; d[key] = val; if (!ok(cap)) { d[key] = old; return false; } return true; };

    // 1. weapons (up to ~45% of budget beyond base)
    const plan = plans[archetype].slice();
    if (rng() < 0.4) plan.splice(2, 0, [rngPick(rng, ['mg', 'rkt', 'flame', 'las', 'gl']), rngPick(rng, ['left', 'right', 'back', 'top'])]);
    if (f > 0.8 && plan.some(p => WEAPONS[p[0]].needsComputer)) d.computer = 'basic';
    const baseCost = st().cost;
    const wcap = baseCost + Math.max(1500, budget * (f < 0.7 ? 0.2 : 0.42));
    for (const [wid, loc] of plan) {
      const W = WEAPONS[wid];
      if (!W.allowed.includes(loc) || B.mounts[loc] === 0 || (W.needsComputer && d.computer === 'none')) continue;
      d.weapons.push({ w: wid, loc, ammo: isFinite(W.ammo) ? Math.ceil(W.ammo * 0.75) : 0 });
      if (!ok(Math.min(budget, wcap))) d.weapons.pop();
    }
    if (!d.weapons.length) { d.weapons.push({ w: 'mg', loc: 'front', ammo: 150 }); if (!ok()) d.weapons.pop(); }
    // 2. motor & battery upgrades (keep ~25% budget for armor)
    const ucap = budget * (f < 0.7 ? 0.66 : 0.75);
    const motorTarget = Math.max(1, Math.min(4, Math.round(f * 1.5 + (rng() - 0.4) + (B.mass > 1300 ? 0.6 : 0))));
    const motors = ['m60', 'm110', 'm180', 'm260', 'm380'];
    for (let i = 1; i <= motorTarget; i++) if (!tryset('motor', motors[i], ucap)) break;
    if (MOTORS[d.motor].kW >= 180) tryset('battery', 'b_ext', ucap);
    if (MOTORS[d.motor].kW >= 380 || f > 2.2) tryset('battery', 'b_mil', ucap);
    // 3. misc upgrades by budget scale
    const ups = [];
    if (f > 0.4) ups.push(['computer', f > 1.6 ? 'adv' : 'basic']);
    if (f > 2.4) ups.push(['computer', 'mil']);
    if (f > 0.5) ups.push(['tires', rngPick(rng, ['hd', 'slick', 'solid', 'hd'])]);
    if (f > 0.6) ups.push(['brakes', rngPick(rng, ['perf', 'abs', 'carbon'])]);
    if (f > 0.8) ups.push(['suspension', rngPick(rng, ['sport', 'heavy', 'active'])]);
    if (f > 0.5) ups.push(['armorType', rngPick(rng, ['composite', 'steel', 'ceramic', 'reactive'])]);
    else ups.push(['armorType', rngPick(rng, ['composite', 'steel'])]);
    if (B.mounts.top > 0 && f > 0.5 && rng() < 0.6) ups.push(['gunner', true]);
    for (const [k, v] of ups) tryset(k, v, ucap);
    const acc = (k, n = 1) => { d.accessories[k] = n; if (!ok(ucap)) delete d.accessories[k]; };
    if (archetype === 'laser') acc('heatsink', 2); else if (rng() < 0.4) acc('heatsink', 1);
    if (f > 0.9 && rng() < 0.5) acc('extinguish');
    if (f > 1.2 && rng() < 0.3) acc('capacitor');
    if (rng() < 0.3) acc('spoiler');
    if (f > 1.4 && rng() < 0.3) acc('jammer');
    if (f > 1.4 && rng() < 0.3) acc('crewarmor');
    // 4. armor
    const weights = archetype === 'brawler' || archetype === 'tank'
      ? { front: 3, back: 1.5, left: 2, right: 2, top: 1, bottom: 0.8 }
      : { front: 2.5, back: 1.8, left: 2, right: 2, top: 1, bottom: 0.8 };
    for (let guard = 0; guard < 600; guard++) {
      let bestL = null, bestR = Infinity;
      for (const l of LOCATIONS) { if (d.armor[l] >= B.armorMax) continue; const r = d.armor[l] / weights[l]; if (r < bestR) { bestR = r; bestL = l; } }
      if (!bestL) break;
      d.armor[bestL] += 2;
      if (!ok(budget * 0.94)) { d.armor[bestL] -= 2; break; }
    }
    // 5. ammo top-up
    for (const w of d.weapons) {
      const W = WEAPONS[w.w]; if (!isFinite(W.maxAmmo) || !W.maxAmmo) continue;
      const step = Math.ceil(W.ammo * 0.25);
      while (w.ammo + step <= ammoCap(d, w)) { w.ammo += step; if (!ok()) { w.ammo -= step; break; } }
    }
    const s = st();
    if (validate(d, s).ok && s.cost <= budget) {
      const score = (s.cost >= minCost ? 0 : -1e6) + s.cost + d.weapons.length * 500 + Math.min(s.ap, 160) * 25;
      if (!best || score > best.score) best = { d, score };
      if (s.cost >= Math.max(minCost, budget * 0.88) && d.weapons.length >= 2 && s.ap > 80) break;
    }
  }
  if (best) { best.d.archetype = archetype; return best.d; }
  const fb = blankDesign('mini'); fb.weapons = [{ w: 'mg', loc: 'front', ammo: 200 }]; fb.archetype = 'gunslinger'; return fb;
}

// ---------- Factory presets ----------
export function presets() {
  const P = [];
  const mk = (o) => { const d = Object.assign(blankDesign(o.body), o); d.id = 'preset_' + o.key; d.preset = true; delete d.key; return d; };
  P.push(mk({
    key: 'buzz', name: 'Buzzbomb', body: 'mini', motor: 'm110', battery: 'b_std', tires: 'slick', brakes: 'std', suspension: 'std',
    armorType: 'composite', armor: { front: 20, back: 12, left: 12, right: 12, top: 4, bottom: 4 }, computer: 'basic',
    weapons: [{ w: 'mg', loc: 'front', ammo: 150 }, { w: 'mg', loc: 'front', ammo: 150 }, { w: 'oil', loc: 'back', ammo: 6 }],
    accessories: {}, gunner: false, paint: 'lime', driver: { name: 'You', perk: 'hotfoot' },
  }));
  P.push(mk({
    key: 'miami', name: 'Miami Vice-Grip', body: 'coupe', motor: 'm180', battery: 'b_std', tires: 'slick', brakes: 'abs', suspension: 'sport',
    armorType: 'composite', armor: { front: 26, back: 16, left: 18, right: 18, top: 6, bottom: 6 }, computer: 'basic',
    weapons: [{ w: 'rkt', loc: 'front', ammo: 12 }, { w: 'mg', loc: 'front', ammo: 200 }, { w: 'mine', loc: 'back', ammo: 8 }],
    accessories: { spoiler: 1 }, gunner: false, paint: 'hotpink', driver: { name: 'You', perk: 'steady' },
  }));
  P.push(mk({
    key: 'cop', name: 'Interceptor', body: 'sedan', motor: 'm180', battery: 'b_ext', tires: 'hd', brakes: 'abs', suspension: 'heavy',
    armorType: 'steel', armor: { front: 32, back: 22, left: 24, right: 24, top: 12, bottom: 10 }, computer: 'adv',
    weapons: [{ w: 'ac', loc: 'front', ammo: 60 }, { w: 'mg', loc: 'top', ammo: 300 }, { w: 'spike', loc: 'back', ammo: 8 }, { w: 'ram', loc: 'front', ammo: 0 }],
    accessories: { heatsink: 1 }, gunner: true, paint: 'black', driver: { name: 'You', perk: 'steady' },
  }));
  P.push(mk({
    key: 'laser', name: 'Laser Lotus', body: 'coupe', motor: 'm180', battery: 'b_std', tires: 'slick', brakes: 'carbon', suspension: 'active',
    armorType: 'ceramic', armor: { front: 34, back: 20, left: 24, right: 24, top: 10, bottom: 8 }, computer: 'adv',
    weapons: [{ w: 'las', loc: 'front', ammo: 0 }, { w: 'las', loc: 'front', ammo: 0 }, { w: 'smoke', loc: 'back', ammo: 6 }],
    accessories: { heatsink: 2, spoiler: 1 }, gunner: false, paint: 'cyan', driver: { name: 'You', perk: 'hotfoot' },
  }));
  P.push(mk({
    key: 'hauler', name: 'Boombox Hauler', body: 'pickup', motor: 'm260', battery: 'b_ext', tires: 'solid', brakes: 'abs', suspension: 'heavy',
    armorType: 'reactive', armor: { front: 45, back: 30, left: 34, right: 34, top: 16, bottom: 12 }, computer: 'adv',
    weapons: [{ w: 'rkt', loc: 'top', ammo: 18 }, { w: 'ac', loc: 'top', ammo: 80 }, { w: 'mg', loc: 'front', ammo: 300 }, { w: 'ram', loc: 'front', ammo: 0 }, { w: 'mine', loc: 'back', ammo: 10 }],
    accessories: { heatsink: 1, extinguish: 1, ammobox: 1 }, gunner: true, paint: 'sunset', driver: { name: 'You', perk: 'tough' },
  }));
  P.push(mk({
    key: 'van', name: 'Party Van', body: 'van', motor: 'm380', battery: 'b_mil', tires: 'solid', brakes: 'carbon', suspension: 'active',
    armorType: 'reactive', armor: { front: 50, back: 36, left: 40, right: 40, top: 20, bottom: 14 }, computer: 'mil',
    weapons: [{ w: 'hlas', loc: 'top', ammo: 0 }, { w: 'hrkt', loc: 'top', ammo: 8 }, { w: 'mg', loc: 'front', ammo: 300 }, { w: 'flame', loc: 'left', ammo: 120 }, { w: 'flame', loc: 'right', ammo: 120 }, { w: 'mine', loc: 'bottom', ammo: 8 }, { w: 'ram', loc: 'front', ammo: 0 }],
    accessories: { heatsink: 3, extinguish: 1, capacitor: 1, crewarmor: 1, repair: 1 }, gunner: true, paint: 'purple', driver: { name: 'You', perk: 'tough' },
  }));
  P.push(mk({
    key: 'suv', name: 'Mall Crawler', body: 'suv', motor: 'm180', battery: 'b_ext', tires: 'hd', brakes: 'perf', suspension: 'heavy',
    armorType: 'steel', armor: { front: 40, back: 30, left: 32, right: 32, top: 14, bottom: 10 }, computer: 'basic',
    weapons: [{ w: 'gl', loc: 'top', ammo: 20 }, { w: 'mg', loc: 'top', ammo: 300 }, { w: 'flame', loc: 'front', ammo: 120 }, { w: 'oil', loc: 'back', ammo: 6 }],
    accessories: { extinguish: 1 }, gunner: true, paint: 'white', driver: { name: 'You', perk: 'mechanic' },
  }));
  return P;
}
