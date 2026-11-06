// Procedural, detailed 80s-styled car meshes for each body type, with visible loadout.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BODIES, PAINTS, WEAPONS } from './data.js';
import { stdMats, emissive, additive, glowTex, shadowTex, mat } from './gfx.js';

// Side profiles as [zFrac, yFrac] (z: -0.5 back .. 0.5 front, y fraction of height)
const PROFILES = {
  mini: {
    lower: [[-.5, .16], [-.5, .5], [-.47, .58], [.3, .6], [.46, .52], [.5, .42], [.5, .16]],
    cabin: [[-.46, .56], [-.41, .97], [.04, 1.0], [.31, .59]], cabinW: .84,
  },
  coupe: {
    lower: [[-.5, .17], [-.5, .5], [-.48, .56], [-.25, .57], [.47, .4], [.5, .34], [.5, .17]],
    cabin: [[-.34, .55], [-.17, .96], [.04, .98], [.3, .47]], cabinW: .8, popups: true,
  },
  sedan: {
    lower: [[-.5, .16], [-.5, .5], [-.46, .58], [-.28, .6], [.25, .58], [.47, .53], [.5, .42], [.5, .16]],
    cabin: [[-.34, .58], [-.2, .97], [.1, .98], [.27, .57]], cabinW: .84,
  },
  suv: {
    lower: [[-.5, .2], [-.5, .58], [.26, .6], [.47, .55], [.5, .45], [.5, .2]],
    cabin: [[-.49, .58], [-.47, .97], [.1, 1.0], [.27, .59]], cabinW: .9,
  },
  pickup: {
    lower: [[-.5, .2], [-.5, .4], [-.06, .4], [-.06, .57], [.27, .58], [.48, .54], [.5, .45], [.5, .2]],
    cabin: [[-.05, .56], [-.03, .97], [.1, 1.0], [.26, .57]], cabinW: .88, bed: true,
  },
  van: {
    lower: [[-.5, .15], [-.5, .97], [-.47, 1.0], [.22, 1.0], [.4, .55], [.5, .47], [.5, .15]],
    cabin: [[.19, .56], [.2, .95], [.23, .985], [.41, .56]], cabinW: 1.012, van: true,
  },
};

class PartBuilder {
  constructor() { this.lists = new Map(); this.mats = new Map(); }
  add(matObj, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    // normalise attributes for merging
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const k = matObj.uuid;
    if (!this.lists.has(k)) { this.lists.set(k, []); this.mats.set(k, matObj); }
    this.lists.get(k).push(g);
    return this;
  }
  build(group) {
    for (const [k, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      list.forEach(g => g.dispose());
      const mesh = new THREE.Mesh(merged, this.mats.get(k));
      group.add(mesh);
    }
    return group;
  }
}

function extrudeProfile(pts, L, H, width, bevel = 0.06) {
  const sh = new THREE.Shape();
  pts.forEach(([z, y], i) => { const X = z * L, Y = y * H; if (i === 0) sh.moveTo(X, Y); else sh.lineTo(X, Y); });
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, steps: 1 });
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const rbox = (w, h, d, r = 0.04) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
const cyl = (r1, r2, h, seg = 12) => new THREE.CylinderGeometry(r1, r2, h, seg);

export function paintOf(design) { return PAINTS.find(p => p.id === design.paint) || PAINTS[0]; }

// ---------- weapon meshes (barrel along +Z from origin) ----------
function addWeapon(P, id, M, glowCol, x, y, z, ry, scale = 1) {
  const W = WEAPONS[id];
  const local = []; // [mat, geo, lx, ly, lz, rx, ry, rz]
  const push = (m, g, lx, ly, lz, rx = 0, ryy = 0, rz = 0) => local.push([m, g, lx * scale, ly * scale, lz * scale, rx, ryy, rz]);
  let muzzle = 0.6;
  const R = Math.PI / 2;
  switch (id) {
    case 'mg':
      push(M.gun, rbox(0.3, 0.2, 0.42, 0.04), 0, 0, 0.05);
      push(M.dark, cyl(0.035, 0.035, 0.7, 8), 0.07, 0.02, 0.5, R);
      push(M.dark, cyl(0.035, 0.035, 0.7, 8), -0.07, 0.02, 0.5, R);
      push(emissive(0xffe14a), cyl(0.045, 0.045, 0.04, 8), 0.07, 0.02, 0.85, R);
      push(emissive(0xffe14a), cyl(0.045, 0.045, 0.04, 8), -0.07, 0.02, 0.85, R);
      muzzle = 0.9; break;
    case 'ac':
      push(M.gun, rbox(0.42, 0.3, 0.6, 0.05), 0, 0, 0);
      push(M.dark, cyl(0.07, 0.08, 1.0, 10), 0, 0.03, 0.75, R);
      push(M.gun, cyl(0.11, 0.11, 0.18, 10), 0, 0.03, 1.22, R);
      push(emissive(0xffaa33), cyl(0.06, 0.06, 0.02, 10), 0, 0.03, 1.32, R);
      muzzle = 1.3; break;
    case 'rkt':
      push(M.gun, rbox(0.5, 0.36, 0.6, 0.06), 0, 0, 0.1);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) push(emissive(0xff3355), cyl(0.06, 0.06, 0.02, 10), -0.15 + i * 0.15, -0.08 + j * 0.16, 0.41, R);
      push(M.stripeP, box(0.52, 0.04, 0.4), 0, 0.19, 0.1);
      muzzle = 0.45; break;
    case 'hrkt':
      push(M.gun, rbox(0.56, 0.18, 0.9, 0.05), 0, -0.05, 0.1);
      push(M.white, cyl(0.08, 0.08, 1.0, 10), 0.14, 0.12, 0.15, R);
      push(M.white, cyl(0.08, 0.08, 1.0, 10), -0.14, 0.12, 0.15, R);
      push(emissive(0xff33aa), new THREE.ConeGeometry(0.08, 0.22, 10), 0.14, 0.12, 0.76, R);
      push(emissive(0xff33aa), new THREE.ConeGeometry(0.08, 0.22, 10), -0.14, 0.12, 0.76, R);
      muzzle = 0.8; break;
    case 'las': case 'hlas': {
      const big = id === 'hlas' ? 1.35 : 1;
      const col = id === 'hlas' ? 0xff44ff : 0x33ffff;
      push(M.chrome, cyl(0.13 * big, 0.16 * big, 0.6 * big, 14), 0, 0, 0.2 * big, R);
      for (let i = 0; i < 3; i++) push(emissive(col), new THREE.TorusGeometry(0.16 * big, 0.025, 6, 16), 0, 0, (0.02 + i * 0.16) * big);
      push(M.gun, cyl(0.07 * big, 0.09 * big, 0.5 * big, 10), 0, 0, 0.7 * big, R);
      push(emissive(col), new THREE.SphereGeometry(0.075 * big, 10, 8), 0, 0, 0.96 * big);
      muzzle = 1.0 * big; break;
    }
    case 'flame':
      push(M.stripeO, cyl(0.12, 0.12, 0.5, 12), 0, 0, -0.05, R);
      push(M.gun, cyl(0.05, 0.08, 0.6, 10), 0, 0.02, 0.45, R);
      push(emissive(0x3399ff), new THREE.SphereGeometry(0.04, 8, 6), 0, 0.02, 0.78);
      muzzle = 0.8; break;
    case 'gl':
      push(M.gun, cyl(0.17, 0.17, 0.3, 12), 0, 0, 0, 0, 0, R);
      push(M.dark, cyl(0.1, 0.1, 0.55, 10), 0, 0.05, 0.3, R);
      push(emissive(0x99ff33), new THREE.TorusGeometry(0.1, 0.02, 6, 12), 0, 0.05, 0.58);
      muzzle = 0.6; break;
    case 'emp':
      push(M.gun, cyl(0.12, 0.18, 0.4, 10), 0, 0, 0);
      for (let i = 0; i < 3; i++) push(M.chrome, new THREE.TorusGeometry(0.15 - i * 0.03, 0.03, 6, 14), 0, 0.25 + i * 0.1, 0, R);
      push(emissive(0x66aaff), new THREE.SphereGeometry(0.12, 12, 8), 0, 0.6, 0);
      muzzle = 0.2; break;
    default: // drops: hazard box
      push(M.dark, rbox(0.55, 0.22, 0.45, 0.04), 0, 0, 0);
      push(M.hazard, box(0.57, 0.06, 0.12), 0, 0.02, -0.12);
      push(M.hazard, box(0.57, 0.06, 0.12), 0, 0.02, 0.12);
      push(emissive(W.color || 0xff3366), box(0.3, 0.03, 0.05), 0, -0.1, 0.2);
      muzzle = 0.25;
  }
  const rot = new THREE.Matrix4().makeRotationY(ry);
  for (const [m, g, lx, ly, lz, rx, ryy, rz] of local) {
    const v = new THREE.Vector3(lx, ly, lz).applyMatrix4(rot);
    P.add(m, g, x + v.x, y + v.y, z + v.z, rx, ry + ryy, rz, scale, scale, scale);
  }
  const mz = new THREE.Vector3(0, id === 'emp' ? 0.6 * scale : 0.02 * scale, muzzle * scale).applyMatrix4(rot);
  return new THREE.Vector3(x + mz.x, y + mz.y, z + mz.z);
}

// ---------- main builder ----------
export function buildCar(design, opts = {}) {
  const B = BODIES[design.body];
  const prof = PROFILES[design.body];
  const paint = paintOf(design);
  const M = stdMats();
  const L = B.L, W = B.W, H = B.H;
  const teamCol = opts.teamColor ?? paint.trim;

  const paintMat = new THREE.MeshPhysicalMaterial({ color: paint.body, metalness: paint.id === 'chrome' ? 1 : 0.45, roughness: paint.id === 'chrome' ? 0.08 : 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
  const trimMat = emissive(paint.trim);
  const teamMat = emissive(teamCol);

  const root = new THREE.Group(); root.name = 'car';
  const bodyG = new THREE.Group(); root.add(bodyG); // rolls / pitches
  const P = new PartBuilder();
  const bw = W * (prof.van ? 0.96 : 0.9);

  // lower body + cabin
  P.add(paintMat, extrudeProfile(prof.lower, L, H, bw, 0.07));
  P.add(M.glass, extrudeProfile(prof.cabin, L, H, W * prof.cabinW * (prof.van ? 0.96 : 1), 0.05));
  // roof panel on cabin (paint), slightly inset
  {
    const c = prof.cabin; const zr0 = c[1][0] * L, zr1 = c[2][0] * L, yr = Math.max(c[1][1], c[2][1]) * H;
    if (!prof.van) P.add(paintMat, rbox(W * prof.cabinW * 0.92, 0.06, (zr1 - zr0) * 0.92, 0.03), 0, yr + 0.01, (zr0 + zr1) / 2);
    // pillars
  }
  // fender flares over each wheel
  const wz = B.wheelbase / 2, wx = B.track / 2, wr = B.wheelR;
  for (const sz of [1, -1]) for (const sx of [1, -1]) {
    P.add(paintMat, rbox(0.28, wr * 0.9, wr * 2.5, 0.08), sx * (W / 2 - 0.13), wr * 1.45, sz * wz);
    P.add(M.dark, rbox(0.3, wr * 0.35, wr * 2.3, 0.05), sx * (W / 2 - 0.13), wr * 0.98, sz * wz);
  }
  // bumpers
  P.add(M.dark, rbox(W * 0.94, H * 0.14, 0.22, 0.05), 0, H * 0.24, L / 2 - 0.06);
  P.add(M.dark, rbox(W * 0.94, H * 0.14, 0.22, 0.05), 0, H * 0.24, -L / 2 + 0.06);
  // grille (chrome bars) & headlights
  const frontY = prof.lower.find(p => p[0] === .5) ? H * 0.36 : H * 0.36;
  P.add(M.dark, box(W * 0.42, H * 0.1, 0.04), 0, frontY, L / 2 + 0.01);
  for (let i = 0; i < 3; i++) P.add(M.chrome, box(W * 0.42, 0.015, 0.05), 0, frontY - H * 0.035 + i * H * 0.035, L / 2 + 0.02);
  if (prof.popups) {
    for (const sx of [1, -1]) {
      P.add(paintMat, rbox(0.42, 0.14, 0.3, 0.03), sx * W * 0.3, H * 0.47, L * 0.4);
      P.add(M.head, box(0.36, 0.09, 0.02), sx * W * 0.3, H * 0.48, L * 0.4 + 0.16);
    }
  } else {
    for (const sx of [1, -1]) {
      P.add(M.head, box(W * 0.2, H * 0.07, 0.03), sx * W * 0.33, frontY + H * 0.02, L / 2 + 0.02);
      P.add(M.amber, box(W * 0.06, H * 0.05, 0.03), sx * W * 0.44, frontY - H * 0.06, L / 2 + 0.02);
    }
  }
  // taillight strip (very 80s)
  const backTop = prof.lower[1][1] * H;
  P.add(M.tail, box(W * 0.86, H * 0.05, 0.03), 0, backTop - H * 0.07, -L / 2 - 0.01);
  P.add(trimMat, box(W * 0.3, H * 0.02, 0.035), 0, backTop - H * 0.13, -L / 2 - 0.012);
  // neon side trim + sunset tri-stripes
  for (const sx of [1, -1]) {
    P.add(teamMat, box(0.03, 0.035, L * 0.86), sx * (bw / 2 + 0.005), H * 0.2, 0);
    const sy = H * (prof.van ? 0.58 : 0.42);
    if (!['coupe', 'mini'].includes(design.body)) {
      P.add(M.stripeY, box(0.02, H * 0.035, L * 0.7), sx * (bw / 2 + 0.008), sy + H * 0.08, -L * 0.04);
      P.add(M.stripeO, box(0.02, H * 0.035, L * 0.7), sx * (bw / 2 + 0.008), sy + H * 0.04, -L * 0.04);
      P.add(M.stripeP, box(0.02, H * 0.035, L * 0.7), sx * (bw / 2 + 0.008), sy, -L * 0.04);
    }
    // mirrors
    const mz = prof.cabin[3][0] * L - 0.1;
    P.add(paintMat, rbox(0.16, 0.1, 0.2, 0.03), sx * (W * prof.cabinW / 2 + 0.06), prof.cabin[3][1] * H + 0.08, mz);
  }
  // hood racing stripes on small cars
  if (['coupe', 'mini', 'sedan'].includes(design.body)) {
    const hz0 = prof.cabin[3][0] * L, hz1 = L / 2 - 0.1;
    const hood = prof.lower.filter(p => p[0] > prof.cabin[3][0]);
    const hy = Math.max(...hood.map(p => p[1])) * H;
    const slope = Math.atan2(hy - (prof.lower[prof.lower.length - 2][1] * H), (hz1 - hz0)) * (design.body === 'coupe' ? 1 : 0.3);
    for (const sx of [0.12, -0.12]) P.add(M.white, box(0.14, 0.012, hz1 - hz0), sx, hy - 0.02, (hz0 + hz1) / 2, slope);
  }
  // van specifics: side windows, roof rack lights
  if (prof.van) {
    for (const sx of [1, -1]) P.add(M.glass, box(0.02, H * 0.2, L * 0.45), sx * (bw / 2 + 0.01), H * 0.8, -L * 0.12);
    P.add(trimMat, box(W * 0.8, 0.03, 0.03), 0, H + 0.02, L * 0.2);
  }
  // pickup bed walls + tailgate
  if (prof.bed) {
    const z0 = -L / 2, z1 = -0.06 * L, yb = 0.4 * H, yt = 0.57 * H;
    for (const sx of [1, -1]) P.add(paintMat, box(0.08, yt - yb, z1 - z0), sx * (bw / 2 - 0.04), (yb + yt) / 2, (z0 + z1) / 2);
    P.add(paintMat, box(bw, yt - yb, 0.08), 0, (yb + yt) / 2, z0 + 0.04);
    P.add(M.dark, box(bw - 0.16, 0.02, z1 - z0 - 0.1), 0, yb + 0.01, (z0 + z1) / 2);
    // roll bar with lights
    P.add(M.chrome, cyl(0.035, 0.035, yt - yb + 0.5, 8), bw / 2 - 0.1, yt + 0.2, z1 - 0.12);
    P.add(M.chrome, cyl(0.035, 0.035, yt - yb + 0.5, 8), -bw / 2 + 0.1, yt + 0.2, z1 - 0.12);
    P.add(M.chrome, cyl(0.035, 0.035, bw - 0.2, 8), 0, yt + 0.48, z1 - 0.12, 0, 0, Math.PI / 2);
    for (let i = -1; i <= 1; i++) P.add(M.amber, box(0.18, 0.1, 0.06), i * 0.4, yt + 0.56, z1 - 0.12);
  }
  // SUV: roof light bar + bull bar
  if (design.body === 'suv') {
    for (let i = -2; i <= 2; i++) P.add(i % 2 ? M.amber : M.head, box(0.18, 0.08, 0.1), i * 0.3, H + 0.06, prof.cabin[2][0] * L - 0.25);
  }
  if (['suv', 'pickup'].includes(design.body)) {
    P.add(M.chrome, cyl(0.04, 0.04, W * 0.8, 8), 0, H * 0.42, L / 2 + 0.16, 0, 0, Math.PI / 2);
    for (const sx of [0.3, -0.3]) P.add(M.chrome, cyl(0.04, 0.04, H * 0.3, 8), sx * W, H * 0.32, L / 2 + 0.16);
  }
  // spoiler
  if (design.accessories?.spoiler) {
    const sy = prof.lower[2][1] * H, z = -L / 2 + 0.25;
    for (const sx of [1, -1]) P.add(M.dark, box(0.05, 0.28, 0.12), sx * W * 0.32, sy + 0.12, z);
    P.add(paintMat, rbox(W * 0.95, 0.05, 0.35, 0.02), 0, sy + 0.28, z - 0.04, -0.12);
    P.add(teamMat, box(W * 0.95, 0.02, 0.02), 0, sy + 0.3, z - 0.22);
  }
  // antenna with glowing tip
  P.add(M.dark, cyl(0.008, 0.012, 0.9, 4), -W * 0.36, (prof.van ? H : prof.lower[2][1] * H) + 0.45, -L * 0.38);
  P.add(teamMat, new THREE.SphereGeometry(0.04, 8, 6), -W * 0.36, (prof.van ? H : prof.lower[2][1] * H) + 0.9, -L * 0.38);
  // underbody (dark)
  P.add(M.dark, box(bw * 0.95, 0.08, L * 0.9), 0, H * 0.16, 0);

  // visible armor plating (bolt-on panels scale with armor points)
  const af = (loc) => Math.min(1, (design.armor[loc] || 0) / B.armorMax);
  if (af('front') > 0.45) P.add(M.armor, rbox(W * 0.7, H * 0.16, 0.08, 0.02), 0, H * 0.32, L / 2 + 0.12);
  if (af('back') > 0.45) P.add(M.armor, rbox(W * 0.7, H * 0.14, 0.08, 0.02), 0, H * 0.3, -L / 2 - 0.1);
  for (const [loc, sx] of [['left', 1], ['right', -1]]) {
    if (af(loc) > 0.4) P.add(M.armor, rbox(0.06, H * 0.16, wz * 1.2, 0.02), sx * (bw / 2 + 0.04), H * 0.33, 0);
    if (af(loc) > 0.7) P.add(M.armor, rbox(0.06, H * 0.1, wz * 1.0, 0.02), sx * (bw / 2 + 0.04), H * 0.5, -0.1);
  }

  // ---------- crew helmets ----------
  const cab = prof.cabin; const seatZ = (cab[1][0] + cab[2][0]) / 2 * L + (prof.van ? 0 : 0);
  const helmetY = Math.min(cab[1][1], cab[2][1]) * H - 0.28;
  const helm = (x, col) => {
    P.add(emissive(col), new THREE.SphereGeometry(0.17, 12, 10), x, helmetY, seatZ);
    P.add(M.dark, box(0.26, 0.07, 0.05), x, helmetY + 0.01, seatZ + 0.15);
  };
  helm(W * 0.2, teamCol);
  if (design.gunner) helm(-W * 0.2, 0xffffff);

  // ---------- weapons ----------
  const muzzles = new Array(design.weapons.length);
  const counts = { front: 0, back: 0, left: 0, right: 0, top: 0, bottom: 0 };
  const totals = { front: 0, back: 0, left: 0, right: 0, top: 0, bottom: 0 };
  design.weapons.forEach(w => totals[w.loc]++);
  const frontGuns = design.weapons.filter(w => w.loc === 'front' && w.w !== 'ram').length;
  const backGuns = design.weapons.filter(w => w.loc === 'back' && w.w !== 'ram').length;
  let fi = 0, bi = 0;
  const hoodY = Math.max(...prof.lower.filter(p => p[0] > 0.25).map(p => p[1])) * H;
  const trunkY = prof.lower[1][1] * H;
  const turretWeapons = [];
  design.weapons.forEach((w, i) => {
    const id = w.w; const loc = w.loc;
    if (id === 'ram') {
      const z = loc === 'front' ? L / 2 + 0.2 : -L / 2 - 0.2, dir = loc === 'front' ? 1 : -1;
      P.add(M.chrome, rbox(W * 0.9, H * 0.12, 0.12, 0.03), 0, H * 0.28, z);
      for (let k = -2; k <= 2; k++) P.add(M.chrome, new THREE.ConeGeometry(0.07, 0.35, 8), k * W * 0.2, H * 0.28, z + dir * 0.2, dir * Math.PI / 2);
      muzzles[i] = { space: 'body', pos: new THREE.Vector3(0, H * 0.28, z) };
      return;
    }
    if (loc === 'top') { turretWeapons.push(i); return; }
    let pos, ry = 0, sc = 0.9;
    if (loc === 'front') {
      const n = frontGuns, k = fi++;
      const x = n === 1 ? 0 : (k === 0 ? W * 0.28 : -W * 0.28);
      pos = [x, hoodY + 0.06, L / 2 - 0.55]; ry = 0;
    } else if (loc === 'back') {
      const n = backGuns, k = bi++;
      const x = n === 1 ? 0 : (k === 0 ? W * 0.28 : -W * 0.28);
      pos = [x, trunkY + 0.08, -L / 2 + 0.45]; ry = Math.PI;
    } else if (loc === 'left' || loc === 'right') {
      const k = counts[loc]++, n = totals[loc];
      const z = n === 1 ? 0 : (k === 0 ? 0.55 : -0.55);
      const sx = loc === 'left' ? 1 : -1;
      pos = [sx * (bw / 2 + 0.12), H * 0.42, z]; ry = sx * Math.PI / 2; sc = 0.75;
    } else { // bottom
      pos = [0, H * 0.12, -L / 2 + 0.6]; ry = Math.PI; sc = 0.9;
    }
    if (WEAPONS[id].type === 'drop' && loc === 'back') { pos[1] = H * 0.2; pos[2] = -L / 2 - 0.05; }
    const mz = addWeapon(P, id, M, 0, pos[0], pos[1], pos[2], ry, sc);
    muzzles[i] = { space: 'body', pos: mz };
  });

  P.build(bodyG);

  // ---------- turret ----------
  let turret = null;
  if (turretWeapons.length) {
    let ty, tz;
    if (prof.bed) { ty = 0.42 * H; tz = -0.28 * L; }
    else if (prof.van) { ty = H; tz = -0.05 * L; }
    else { ty = Math.max(prof.cabin[1][1], prof.cabin[2][1]) * H; tz = (prof.cabin[1][0] + prof.cabin[2][0]) / 2 * L; }
    const TP = new PartBuilder();
    const pivot = new THREE.Group(); pivot.position.set(0, ty, tz);
    const ringP = new PartBuilder();
    ringP.add(M.dark, cyl(0.5, 0.55, 0.1, 18), 0, 0.05, 0);
    ringP.add(teamMat, new THREE.TorusGeometry(0.52, 0.02, 6, 24), 0, 0.06, 0, Math.PI / 2);
    const ringG = new THREE.Group(); ringG.position.copy(pivot.position); ringP.build(ringG); bodyG.add(ringG);
    TP.add(paintMat, rbox(0.85, 0.3, 0.9, 0.08), 0, 0.25, 0);
    TP.add(M.glass, box(0.5, 0.1, 0.05), 0, 0.3, 0.45);
    const n = turretWeapons.length;
    turretWeapons.forEach((wi, k) => {
      const x = n === 1 ? 0 : (k === 0 ? 0.36 : -0.36);
      const mz = addWeapon(TP, design.weapons[wi].w, M, 0, x, 0.32, 0.1, 0, n === 1 ? 0.95 : 0.8);
      muzzles[wi] = { space: 'turret', pos: mz };
    });
    TP.build(pivot);
    bodyG.add(pivot);
    turret = pivot;
  }

  // ---------- wheels ----------
  const wheels = [];
  const T = design.tires;
  const rimCol = paint.trim;
  const tireGeo = cyl(wr, wr, 0.26, 20); tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = cyl(wr * 0.62, wr * 0.62, 0.28, 16); rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = box(0.02, wr * 1.1, 0.08);
  const ringGeo = new THREE.TorusGeometry(wr * 0.66, 0.018, 6, 20); ringGeo.rotateY(Math.PI / 2);
  const treadGeo = cyl(wr * 1.002, wr * 1.002, 0.06, 20); treadGeo.rotateZ(Math.PI / 2);
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sz], idx) => {
    const steerG = new THREE.Group(); steerG.position.set(sx * (W / 2 - 0.15), wr, sz * wz);
    const spin = new THREE.Group(); steerG.add(spin);
    const WP = new PartBuilder();
    WP.add(M.rubber, tireGeo);
    if (T === 'slick') WP.add(M.dark, treadGeo); else WP.add(emissive(0x222222), treadGeo, 0.08, 0, 0).add(emissive(0x222222), treadGeo, -0.08, 0, 0);
    WP.add(M.chrome, rimGeo);
    for (let k = 0; k < 5; k++) WP.add(M.dark, spokeGeo, sx * 0.145, 0, 0, k * Math.PI / 5);
    WP.add(emissive(rimCol), ringGeo, sx * 0.145, 0, 0);
    WP.build(spin);
    root.add(steerG);
    wheels.push({ steer: steerG, spin, front: sz > 0 });
  });

  // ---------- glow / shadow / beams ----------
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.9, L * 1.5), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03; shadow.renderOrder = 1;
  root.add(shadow);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(W * 2.6, L * 1.5), additive(teamCol, 0.55, glowTex()));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.05; glow.renderOrder = 2;
  root.add(glow);
  const beamMat = mat('beam', () => new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.03, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const beamGeo = new THREE.ConeGeometry(1.8, 10, 16, 1, true); beamGeo.rotateX(-Math.PI / 2); beamGeo.translate(0, 0, 5);
  for (const sx of [1, -1]) { const b = new THREE.Mesh(beamGeo, beamMat); b.position.set(sx * W * 0.32, H * 0.4, L / 2); b.rotation.x = 0.08; bodyG.add(b); }

  return { root, body: bodyG, wheels, turret, muzzles, paintMat, glow, shadow, dims: { L, W, H } };
}

export function disposeCar(car) {
  car.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  car.paintMat.dispose();
}
