// =============================================================
//  NEON WRECKERS 2086 — game data tables
//  Units: mass kg, cost $, space "SP" (cargo/internal space units),
//  power kW, armor in AP (armor points) per location, DP = damage points.
// =============================================================

export const LOCATIONS = ['front', 'back', 'left', 'right', 'top', 'bottom'];
export const LOC_LABEL = { front: 'Front', back: 'Back', left: 'Left', right: 'Right', top: 'Top', bottom: 'Under' };
export const LOC_SHORT = { front: 'F', back: 'B', left: 'L', right: 'R', top: 'T', bottom: 'U' };

// ---------- Vehicle bodies (all four-wheeled) ----------
// dims: length (L), width (W), height (H) metres. wheelbase/track in metres.
// mounts: max number of weapons per location. armorMax: AP cap per location.
// armorWeightMul: bigger panels weigh more per AP.
export const BODIES = {
  mini: {
    id: 'mini', name: 'Pocket Rocket', cls: 'Mini Car',
    desc: 'Tiny, twitchy and cheap. Hard to hit, easy to kill.',
    cost: 1500, mass: 520, maxGross: 1450, space: 12,
    L: 3.4, W: 1.6, H: 1.35, wheelbase: 2.2, track: 1.38, wheelR: 0.3,
    cd: 0.32, area: 1.8, structure: 30,
    mounts: { front: 2, back: 1, left: 1, right: 1, top: 1, bottom: 1 },
    armorMax: 40, armorWeightMul: 0.75, turretMax: 1,
    handling: 1.15,
  },
  coupe: {
    id: 'coupe', name: 'Starfire Coupe', cls: 'Sports Coupe',
    desc: 'Low wedge with pop-up lights. Grip for days, fragile in the rear.',
    cost: 3200, mass: 880, maxGross: 2100, space: 16,
    L: 4.3, W: 1.85, H: 1.2, wheelbase: 2.55, track: 1.6, wheelR: 0.33,
    cd: 0.29, area: 1.9, structure: 40,
    mounts: { front: 2, back: 2, left: 1, right: 1, top: 1, bottom: 1 },
    armorMax: 55, armorWeightMul: 0.9, turretMax: 1,
    handling: 1.2,
  },
  sedan: {
    id: 'sedan', name: 'Interceptor Sedan', cls: 'Standard',
    desc: 'The all-rounder. Room for crew, guns and a respectable motor.',
    cost: 2800, mass: 1050, maxGross: 2650, space: 20,
    L: 4.7, W: 1.85, H: 1.45, wheelbase: 2.75, track: 1.58, wheelR: 0.34,
    cd: 0.33, area: 2.2, structure: 50,
    mounts: { front: 2, back: 2, left: 2, right: 2, top: 1, bottom: 1 },
    armorMax: 70, armorWeightMul: 1.0, turretMax: 1,
    handling: 1.0,
  },
  suv: {
    id: 'suv', name: 'Bruiser SUV', cls: 'SUV',
    desc: 'Tall, tough and heavy. Big turret ring, rolls like a boat.',
    cost: 4200, mass: 1450, maxGross: 3600, space: 26,
    L: 4.8, W: 2.0, H: 1.85, wheelbase: 2.85, track: 1.7, wheelR: 0.4,
    cd: 0.4, area: 2.9, structure: 65,
    mounts: { front: 2, back: 2, left: 2, right: 2, top: 2, bottom: 1 },
    armorMax: 85, armorWeightMul: 1.15, turretMax: 2,
    handling: 0.85,
  },
  pickup: {
    id: 'pickup', name: 'Hauler Pickup', cls: 'Pickup',
    desc: 'Open bed takes a heavy twin turret. Light rear end loves to slide.',
    cost: 3800, mass: 1350, maxGross: 3500, space: 24,
    L: 5.2, W: 1.95, H: 1.7, wheelbase: 3.1, track: 1.66, wheelR: 0.39,
    cd: 0.42, area: 2.8, structure: 60,
    mounts: { front: 2, back: 2, left: 1, right: 1, top: 2, bottom: 1 },
    armorMax: 80, armorWeightMul: 1.1, turretMax: 2,
    handling: 0.9,
  },
  van: {
    id: 'van', name: 'Rad Van', cls: 'Van',
    desc: 'A rolling fortress. Massive space and armor; turns like a fridge.',
    cost: 4800, mass: 1700, maxGross: 4300, space: 34,
    L: 5.0, W: 2.0, H: 2.05, wheelbase: 3.0, track: 1.72, wheelR: 0.38,
    cd: 0.45, area: 3.4, structure: 75,
    mounts: { front: 2, back: 2, left: 2, right: 2, top: 2, bottom: 1 },
    armorMax: 100, armorWeightMul: 1.25, turretMax: 2,
    handling: 0.75,
  },
};

// ---------- Electric motors ----------
export const MOTORS = {
  m60:  { id: 'm60',  name: 'Volt-60 Commuter',  kW: 60,  mass: 70,  cost: 900,   space: 2, heat: 0.6, dp: 8 },
  m110: { id: 'm110', name: 'Volt-110 Street',   kW: 110, mass: 105, cost: 1800,  space: 3, heat: 0.8, dp: 10 },
  m180: { id: 'm180', name: 'Ion-180 Sport',     kW: 180, mass: 140, cost: 3600,  space: 3, heat: 1.0, dp: 12 },
  m260: { id: 'm260', name: 'Ion-260 Racing',    kW: 260, mass: 175, cost: 6200,  space: 4, heat: 1.25, dp: 12 },
  m380: { id: 'm380', name: 'Plasma-380 Hyper',  kW: 380, mass: 220, cost: 11500, space: 5, heat: 1.5, dp: 14 },
};

// ---------- Battery packs ----------
// kWh drained by driving, boosting and energy weapons. Running dry = limp mode.
export const BATTERIES = {
  b_light: { id: 'b_light', name: 'Featherpack 8',   kWh: 8,  mass: 60,  cost: 600,  space: 2, dp: 8,  fire: 0.15 },
  b_std:   { id: 'b_std',   name: 'Standard 14',     kWh: 14, mass: 110, cost: 1200, space: 3, dp: 10, fire: 0.12 },
  b_ext:   { id: 'b_ext',   name: 'Long-Range 22',   kWh: 22, mass: 170, cost: 2400, space: 4, dp: 12, fire: 0.10 },
  b_mil:   { id: 'b_mil',   name: 'Mil-Spec Cell 30', kWh: 30, mass: 200, cost: 4600, space: 4, dp: 18, fire: 0.04 },
};

// ---------- Tires ----------
export const TIRES = {
  std:    { id: 'std',    name: 'Street Radials',  grip: 1.0,  dp: 6,  mass: 10, cost: 50,  desc: 'Cheap and cheerful.' },
  slick:  { id: 'slick',  name: 'Racing Slicks',   grip: 1.18, dp: 5,  mass: 9,  cost: 220, desc: 'Sticky, but pop easily.' },
  hd:     { id: 'hd',     name: 'Heavy Duty',      grip: 0.97, dp: 12, mass: 16, cost: 180, desc: 'Thick sidewalls shrug off rounds.' },
  solid:  { id: 'solid',  name: 'Solid Puncture-Proof', grip: 0.88, dp: 22, mass: 28, cost: 450, desc: 'Nearly indestructible, slides a bit.' },
};

// ---------- Brakes ----------
export const BRAKES = {
  std:    { id: 'std',    name: 'Standard Discs',    force: 1.0,  abs: false, mass: 0,  cost: 0,    heat: 0.6 },
  perf:   { id: 'perf',   name: 'Performance Calipers', force: 1.3, abs: false, mass: 12, cost: 500, heat: 0.5 },
  abs:    { id: 'abs',    name: 'Anti-Lock System',  force: 1.15, abs: true,  mass: 15, cost: 900,  heat: 0.5 },
  carbon: { id: 'carbon', name: 'Carbon-Ceramic ABS', force: 1.55, abs: true,  mass: 8,  cost: 2200, heat: 0.3 },
};

// ---------- Suspension ----------
export const SUSPENSIONS = {
  std:    { id: 'std',    name: 'Standard',     handling: 1.0,  loadMul: 1.0,  mass: 0,  cost: 0,    roll: 1.0 },
  sport:  { id: 'sport',  name: 'Sport Coilovers', handling: 1.12, loadMul: 0.97, mass: 10, cost: 700, roll: 0.6 },
  heavy:  { id: 'heavy',  name: 'Heavy Duty',   handling: 0.95, loadMul: 1.12, mass: 40, cost: 900,  roll: 0.8 },
  active: { id: 'active', name: 'Active Hydraulics', handling: 1.2, loadMul: 1.05, mass: 35, cost: 3200, roll: 0.35 },
};

// ---------- Armor types ----------
// massPerAP is per AP before body armorWeightMul. resist multiplies incoming damage by type.
export const ARMORS = {
  composite: { id: 'composite', name: 'Composite Polymer', massPerAP: 3.2, costPerAP: 10, resist: { ballistic: 1, explosive: 1, energy: 1, fire: 1, ram: 1 } },
  steel:     { id: 'steel',     name: 'Hardened Steel',    massPerAP: 5.2, costPerAP: 5,  resist: { ballistic: 0.9, explosive: 1, energy: 1.1, fire: 1, ram: 0.65 } },
  ceramic:   { id: 'ceramic',   name: 'Ceramic Laminate',  massPerAP: 3.4, costPerAP: 22, resist: { ballistic: 1, explosive: 0.85, energy: 0.5, fire: 0.5, ram: 1.1 } },
  reactive:  { id: 'reactive',  name: 'Chrome Reactive',   massPerAP: 4.2, costPerAP: 28, resist: { ballistic: 0.8, explosive: 0.55, energy: 0.9, fire: 0.9, ram: 0.9 } },
};

// ---------- Targeting computers ----------
// spreadMul scales weapon spread; assist = degrees of aim-correction cone; lock speed for guided rockets.
export const COMPUTERS = {
  none:    { id: 'none',    name: 'Eyeballs Only',      spreadMul: 1.0,  assist: 0,  lockTime: 99, mass: 0,  cost: 0,     space: 0 },
  basic:   { id: 'basic',   name: 'Basic Rangefinder',  spreadMul: 0.8,  assist: 4,  lockTime: 1.6, mass: 5, cost: 800,  space: 1 },
  adv:     { id: 'adv',     name: 'Advanced Fire Control', spreadMul: 0.6, assist: 8, lockTime: 1.0, mass: 8, cost: 3000, space: 1 },
  mil:     { id: 'mil',     name: 'Hi-Res Military TC', spreadMul: 0.42, assist: 12, lockTime: 0.6, mass: 12, cost: 7000, space: 2 },
};

// ---------- Weapons ----------
// type: projectile|beam|flame|drop|launcher. dmg is per hit [min,max]. dtype for armor resistances.
// rof: shots per second. ammo: default load; ammoCost/ammoMass per round. heat per shot.
// energy: kWh per shot (lasers). allowed: locations it can mount. speed m/s for projectiles.
export const WEAPONS = {
  mg: {
    id: 'mg', name: 'Twin Machine Gun', short: 'MG', type: 'projectile', dtype: 'ballistic',
    dmg: [1, 3], rof: 10, speed: 210, range: 120, spread: 2.2, ammo: 200, maxAmmo: 400,
    ammoCost: 1.5, ammoMass: 0.1, heat: 0.12, energy: 0,
    mass: 45, cost: 1000, space: 1, dp: 3, allowed: ['front', 'back', 'left', 'right', 'top'],
    color: 0xffee66, tracer: 1, sfx: 'mg',
    desc: 'Reliable bullet hose. Great vs. tires.',
  },
  ac: {
    id: 'ac', name: '20mm Autocannon', short: 'AC', type: 'projectile', dtype: 'ballistic',
    dmg: [3, 7], rof: 3.2, speed: 190, range: 150, spread: 1.6, ammo: 60, maxAmmo: 120,
    ammoCost: 12, ammoMass: 0.5, heat: 0.45, energy: 0,
    mass: 120, cost: 3200, space: 2, dp: 5, allowed: ['front', 'back', 'top'],
    color: 0xffaa33, tracer: 1.8, sfx: 'autocannon', splash: 0,
    desc: 'Punchy shells that chew through armor.',
  },
  rkt: {
    id: 'rkt', name: 'Rocket Pod x6', short: 'RKT', type: 'projectile', dtype: 'explosive',
    dmg: [5, 11], rof: 2.5, speed: 70, range: 170, spread: 2.5, ammo: 12, maxAmmo: 24,
    ammoCost: 45, ammoMass: 3, heat: 0.6, energy: 0, splash: 4, rocket: true,
    mass: 45, cost: 1800, space: 1, dp: 3, allowed: ['front', 'back', 'left', 'right', 'top'],
    color: 0xff5533, sfx: 'rocket',
    desc: 'Unguided salvo rockets. Big boom, slow flight.',
  },
  hrkt: {
    id: 'hrkt', name: 'Seeker Missiles', short: 'SEEK', type: 'projectile', dtype: 'explosive',
    dmg: [8, 14], rof: 0.8, speed: 55, range: 200, spread: 4, ammo: 6, maxAmmo: 10,
    ammoCost: 220, ammoMass: 8, heat: 0.8, energy: 0, splash: 5, rocket: true, homing: true,
    mass: 80, cost: 5500, space: 2, dp: 4, allowed: ['front', 'top', 'back'],
    color: 0xff33aa, sfx: 'rocket', needsComputer: true,
    desc: 'Lock on with a targeting computer, then let fly.',
  },
  las: {
    id: 'las', name: 'Pulse Laser', short: 'LZR', type: 'beam', dtype: 'energy',
    dmg: [3, 6], rof: 2.2, speed: 0, range: 140, spread: 0.6, ammo: Infinity, maxAmmo: Infinity,
    ammoCost: 0, ammoMass: 0, heat: 2.6, energy: 0.03,
    mass: 90, cost: 5200, space: 2, dp: 4, allowed: ['front', 'back', 'left', 'right', 'top'],
    color: 0x33ffff, sfx: 'laser',
    desc: 'No ammo — runs off the battery. Runs HOT.',
  },
  hlas: {
    id: 'hlas', name: 'Helios Heavy Laser', short: 'HLZR', type: 'beam', dtype: 'energy',
    dmg: [8, 13], rof: 0.9, speed: 0, range: 180, spread: 0.3, ammo: Infinity, maxAmmo: Infinity,
    ammoCost: 0, ammoMass: 0, heat: 7, energy: 0.09,
    mass: 200, cost: 12000, space: 3, dp: 6, allowed: ['front', 'top'],
    color: 0xff44ff, sfx: 'laser',
    desc: 'Melts armor. Melts your heat sinks too.',
  },
  flame: {
    id: 'flame', name: 'Flamethrower', short: 'FLM', type: 'flame', dtype: 'fire',
    dmg: [0.6, 1.4], rof: 12, speed: 32, range: 26, spread: 9, ammo: 120, maxAmmo: 240,
    ammoCost: 3, ammoMass: 0.3, heat: 0.12, energy: 0, ignite: 0.015,
    mass: 55, cost: 900, space: 1, dp: 3, allowed: ['front', 'back', 'left', 'right', 'top'],
    color: 0xff7722, sfx: 'flame',
    desc: 'Short range. Sets targets ablaze — they overheat fast.',
  },
  gl: {
    id: 'gl', name: 'Grenade Launcher', short: 'GL', type: 'projectile', dtype: 'explosive',
    dmg: [4, 9], rof: 1.4, speed: 40, range: 80, spread: 3, ammo: 20, maxAmmo: 40,
    ammoCost: 30, ammoMass: 1.5, heat: 0.3, energy: 0, splash: 6, lob: true,
    mass: 60, cost: 1500, space: 1, dp: 3, allowed: ['top', 'back', 'left', 'right'],
    color: 0x99ff33, sfx: 'grenade',
    desc: 'Lobbed shells that bounce once then blow.',
  },
  ram: {
    id: 'ram', name: 'Ram Spikes', short: 'RAM', type: 'passive', dtype: 'ram',
    dmg: [0, 0], rof: 0, ammo: 0, maxAmmo: 0, ammoCost: 0, ammoMass: 0, heat: 0, energy: 0,
    mass: 90, cost: 700, space: 0, dp: 12, allowed: ['front', 'back'], ramMul: 1.8,
    color: 0xcccccc,
    desc: 'Passive. Doubles ram damage dealt, absorbs some received.',
  },
  mine: {
    id: 'mine', name: 'Mine Dropper', short: 'MINE', type: 'drop', drop: 'mine', dtype: 'explosive',
    dmg: [8, 14], rof: 1.2, ammo: 8, maxAmmo: 15, ammoCost: 50, ammoMass: 3, heat: 0, energy: 0, splash: 5,
    mass: 40, cost: 1200, space: 1, dp: 3, allowed: ['back', 'bottom'],
    color: 0xff3366, sfx: 'mine_drop',
    desc: 'Drops proximity mines. Hits the underside.',
  },
  oil: {
    id: 'oil', name: 'Oil Jet', short: 'OIL', type: 'drop', drop: 'oil', dtype: 'none',
    dmg: [0, 0], rof: 1, ammo: 6, maxAmmo: 10, ammoCost: 25, ammoMass: 4, heat: 0, energy: 0,
    mass: 25, cost: 500, space: 1, dp: 2, allowed: ['back', 'bottom'],
    color: 0x222244, sfx: 'oil',
    desc: 'Slick that kills traction. Pursuers spin out.',
  },
  spike: {
    id: 'spike', name: 'Spike Dropper', short: 'SPK', type: 'drop', drop: 'spike', dtype: 'ballistic',
    dmg: [2, 4], rof: 1, ammo: 8, maxAmmo: 12, ammoCost: 20, ammoMass: 2, heat: 0, energy: 0,
    mass: 25, cost: 400, space: 1, dp: 2, allowed: ['back', 'bottom'],
    color: 0xaaaaaa, sfx: 'spikes',
    desc: 'Shreds tires that drive over it.',
  },
  smoke: {
    id: 'smoke', name: 'Smokescreen', short: 'SMK', type: 'drop', drop: 'smoke', dtype: 'none',
    dmg: [0, 0], rof: 0.7, ammo: 6, maxAmmo: 10, ammoCost: 20, ammoMass: 2, heat: 0, energy: 0,
    mass: 25, cost: 450, space: 1, dp: 2, allowed: ['back', 'bottom'],
    color: 0xbb99ff, sfx: 'smoke',
    desc: 'Purple cloud that blinds targeting and breaks locks.',
  },
  emp: {
    id: 'emp', name: 'Arc Projector', short: 'ARC', type: 'beam', dtype: 'energy', emp: true,
    dmg: [1, 3], rof: 0.6, speed: 0, range: 45, spread: 1.2, ammo: Infinity, maxAmmo: Infinity,
    ammoCost: 0, ammoMass: 0, heat: 3, energy: 0.12,
    mass: 140, cost: 7500, space: 2, dp: 4, allowed: ['front', 'top'],
    color: 0x66aaff, sfx: 'emp',
    desc: 'Short lightning arc. Drains target battery & stalls weapons.',
  },
};

// ---------- Accessories ----------
export const ACCESSORIES = {
  heatsink:   { id: 'heatsink',   name: 'Heat Sink',          mass: 25, cost: 600,  space: 1, max: 4, desc: '+35% heat dissipation each.' },
  extinguish: { id: 'extinguish', name: 'Fire Suppression',   mass: 20, cost: 700,  space: 1, max: 1, desc: 'Auto-extinguishes fires, fast.' },
  capacitor:  { id: 'capacitor',  name: 'Overdrive Capacitor', mass: 30, cost: 1800, space: 1, max: 1, desc: 'Boost gives +60% power instead of +35%.' },
  spoiler:    { id: 'spoiler',    name: 'Aero Spoiler',       mass: 15, cost: 400,  space: 0, max: 1, desc: 'Downforce: +grip at speed.' },
  jammer:     { id: 'jammer',     name: 'Radar Jammer',       mass: 10, cost: 2500, space: 1, max: 1, desc: 'Enemy locks take 2x longer; seekers wobble.' },
  crewarmor:  { id: 'crewarmor',  name: 'Crew Body Armor',    mass: 20, cost: 500,  space: 0, max: 1, desc: 'Crew takes half damage.' },
  repair:     { id: 'repair',     name: 'Nanite Repair Kit',  mass: 15, cost: 2000, space: 1, max: 1, desc: 'Slowly restores armor on the most damaged side.' },
  ammobox:    { id: 'ammobox',    name: 'Ammo Bay',           mass: 20, cost: 400,  space: 1, max: 2, desc: '+50% ammo capacity for all guns.' },
};

// ---------- Crew ----------
export const CREW = { mass: 85, space: 2, dp: 6 };

export const DRIVER_PERKS = {
  hotfoot:  { id: 'hotfoot',  name: 'Hot Foot',    desc: '+8% power. Lives a quarter mile at a time.' },
  steady:   { id: 'steady',   name: 'Steady Hands', desc: '-20% weapon spread.' },
  tough:    { id: 'tough',    name: 'Tough as Nails', desc: '+3 crew DP.' },
  mechanic: { id: 'mechanic', name: 'Grease Monkey', desc: 'Tires & components +25% DP.' },
};

// Paint palettes (80s!)
export const PAINTS = [
  { id: 'hotpink',   name: 'Hot Pink',      body: 0xff2a8a, trim: 0x33f0ff },
  { id: 'cyan',      name: 'Miami Cyan',    body: 0x1ad8e8, trim: 0xff3ad0 },
  { id: 'sunset',    name: 'Sunset Orange', body: 0xff7a1a, trim: 0xffe14a },
  { id: 'purple',    name: 'Ultraviolet',   body: 0x7a2cff, trim: 0x3cff9a },
  { id: 'chrome',    name: 'Chrome',        body: 0xd8dde8, trim: 0xff2ad4 },
  { id: 'black',     name: 'Midnight',      body: 0x15131f, trim: 0xff3355 },
  { id: 'lime',      name: 'Laser Lime',    body: 0x8cff2a, trim: 0xff2a8a },
  { id: 'gold',      name: 'Gold Rush',     body: 0xf2c230, trim: 0x2a7aff },
  { id: 'white',     name: 'Arctic White',  body: 0xf0f0f6, trim: 0x2ad8ff },
  { id: 'red',       name: 'Redline',       body: 0xe0102a, trim: 0xffffff },
];

export const TEAM_COLORS = [0x33f0ff, 0xff2a8a, 0xffe14a, 0x3cff9a];
export const TEAM_NAMES = ['Team Cyan', 'Team Magenta', 'Team Gold', 'Team Lime'];

// ---------- Divisions (cost brackets) ----------
export const DIVISIONS = [
  { id: 'd10', name: 'Division 10', short: 'DIV 10', max: 10000, min: 0,     prize: 1500, color: '#3cff9a' },
  { id: 'd20', name: 'Division 20', short: 'DIV 20', max: 20000, min: 8000,  prize: 3500, color: '#33f0ff' },
  { id: 'd35', name: 'Division 35', short: 'DIV 35', max: 35000, min: 16000, prize: 7000, color: '#ffe14a' },
  { id: 'd60', name: 'Division 60', short: 'DIV 60', max: 60000, min: 28000, prize: 14000, color: '#ff7a1a' },
  { id: 'dX',  name: 'Unlimited',   short: 'UNLTD',  max: Infinity, min: 45000, prize: 25000, color: '#ff2a8a' },
];

export function divisionFor(cost) {
  for (const d of DIVISIONS) if (cost <= d.max) return d;
  return DIVISIONS[DIVISIONS.length - 1];
}

// ---------- Arenas ----------
export const ARENAS = {
  sunset: {
    id: 'sunset', name: 'Sunset Bowl', desc: 'Round bowl ringed by palms. Central pylons.',
    shape: 'circle', radius: 95,
    sky: { top: 0x1a0638, mid: 0xb0186e, horizon: 0xff9a3c }, sun: [0xffe14a, 0xff2a8a], grid: 0xff2ad4, fog: 0x3a0a4a,
    obstacles: [
      { t: 'cyl', x: 0, z: 0, r: 7 },
      { t: 'cyl', x: 32, z: 32, r: 3 }, { t: 'cyl', x: -32, z: 32, r: 3 },
      { t: 'cyl', x: 32, z: -32, r: 3 }, { t: 'cyl', x: -32, z: -32, r: 3 },
      { t: 'box', x: 58, z: 0, w: 3, d: 18, rot: 0 }, { t: 'box', x: -58, z: 0, w: 3, d: 18, rot: 0 },
      { t: 'box', x: 0, z: 58, w: 18, d: 3, rot: 0 }, { t: 'box', x: 0, z: -58, w: 18, d: 3, rot: 0 },
    ],
  },
  grid: {
    id: 'grid', name: 'Neon Grid', desc: 'Night-time square of light walls and cover blocks.',
    shape: 'rect', w: 180, d: 180,
    sky: { top: 0x020018, mid: 0x1a0a5a, horizon: 0x7a1aff }, sun: [0x33f0ff, 0x7a2cff], grid: 0x33f0ff, fog: 0x0a0630,
    obstacles: [
      { t: 'box', x: 0, z: 0, w: 22, d: 22, rot: Math.PI / 4 },
      { t: 'box', x: 45, z: 45, w: 14, d: 4, rot: 0 }, { t: 'box', x: -45, z: 45, w: 4, d: 14, rot: 0 },
      { t: 'box', x: 45, z: -45, w: 4, d: 14, rot: 0 }, { t: 'box', x: -45, z: -45, w: 14, d: 4, rot: 0 },
      { t: 'box', x: 0, z: 62, w: 30, d: 3, rot: 0 }, { t: 'box', x: 0, z: -62, w: 30, d: 3, rot: 0 },
      { t: 'box', x: 62, z: 0, w: 3, d: 30, rot: 0 }, { t: 'box', x: -62, z: 0, w: 3, d: 30, rot: 0 },
      { t: 'cyl', x: 25, z: 0, r: 2.2 }, { t: 'cyl', x: -25, z: 0, r: 2.2 },
      { t: 'cyl', x: 0, z: 25, r: 2.2 }, { t: 'cyl', x: 0, z: -25, r: 2.2 },
    ],
  },
  boulevard: {
    id: 'boulevard', name: 'Vice Boulevard', desc: 'Long strip with medians — great for jousting.',
    shape: 'rect', w: 120, d: 240,
    sky: { top: 0x10052a, mid: 0x5a1a8a, horizon: 0xff5a8a }, sun: [0xffb03a, 0xff2a6a], grid: 0xffb03a, fog: 0x2a0a3a,
    obstacles: [
      { t: 'box', x: 0, z: 60, w: 6, d: 40, rot: 0 }, { t: 'box', x: 0, z: -60, w: 6, d: 40, rot: 0 },
      { t: 'cyl', x: 0, z: 0, r: 5 },
      { t: 'box', x: 35, z: 0, w: 14, d: 4, rot: 0.3 }, { t: 'box', x: -35, z: 0, w: 14, d: 4, rot: -0.3 },
      { t: 'cyl', x: 30, z: 95, r: 3 }, { t: 'cyl', x: -30, z: 95, r: 3 },
      { t: 'cyl', x: 30, z: -95, r: 3 }, { t: 'cyl', x: -30, z: -95, r: 3 },
      { t: 'box', x: 38, z: 50, w: 4, d: 12, rot: 0 }, { t: 'box', x: -38, z: -50, w: 4, d: 12, rot: 0 },
    ],
  },
};

export const AI_NAMES = [
  'Mad Maxine', 'Turbo Tex', 'Neon Nancy', 'Rad Vlad', 'Chrome Dome', 'Lazer Lou', 'Vic Voltage',
  'Dixie Dynamo', 'Kid Kilowatt', 'Big Sal', 'Ziggy Zap', 'Roxy Rocket', 'Duke Detroit', 'Glitter Gus',
  'Spike Sterling', 'Molly Mayhem', 'Captain Cassette', 'Johnny Joule', 'Vera Vortex', 'Bobby Boombox',
  'Synth Sid', 'Tina Tornado', 'Max Megawatt', 'Lola Laserdisc', 'Ace Arcade', 'Rex Ramjet',
];

export const AI_CAR_NAMES = [
  'Hellcat', 'Night Rider', 'Wildfire', 'Thunder Road', 'Red Alert', 'Hot Rod Hex', 'Iron Maiden',
  'Starblazer', 'Outrunner', 'Voltage Vulture', 'Dream Machine', 'Ripper', 'Boom Box', 'Road Warden',
  'Lightning Lou', 'Pink Panzer', 'Radical', 'Vaporizer', 'Afterburner', 'Mixtape',
];
