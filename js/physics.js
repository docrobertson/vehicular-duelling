// 2D vehicle dynamics on the XZ plane (bicycle model with load transfer, friction circle,
// electric motor torque curve, brakes w/ optional ABS) + OBB collision helpers.
// Conventions: heading h; forward = (sin h, cos h); "left" = (cos h, -sin h).
// Positive yaw rate turns LEFT. Positive steer angle points front wheels LEFT.

const G = 9.81, RHO = 1.2, CRR = 0.015;

export class CarPhysics {
  constructor(spec) {
    this.spec = spec; // {mass, L, W, H, wheelbase, track, cd, area, kW, grip, brake, abs, handling, roll, downforce}
    this.x = 0; this.z = 0; this.h = 0;
    this.vx = 0; this.vz = 0; this.w = 0;
    this.steer = 0; this.ax = 0; this.ay = 0;
    this.vf = 0; this.vl = 0;
    this.slip = 0;        // 0..1 tyre screech intensity
    this.wheelSpin = 0;   // wheel rotation angle (visual)
    this.wheelGrip = [1, 1, 1, 1]; // FL FR RL RR multipliers (tyre damage, oil)
    this.powerMul = 1; this.gripMul = 1;
    this.locked = false; this.spinning = false;
    this.setMass(spec.mass);
  }
  setMass(m) {
    const s = this.spec; this.m = m;
    this.I = m * (s.L * s.L + s.W * s.W) / 12 * 0.95;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  fwd() { return [Math.sin(this.h), Math.cos(this.h)]; }

  step(dt, inp) {
    const s = this.spec, m = this.m;
    const sn = Math.sin(this.h), cs = Math.cos(this.h);
    let vf = this.vx * sn + this.vz * cs;
    let vl = this.vx * cs - this.vz * sn;
    const v = Math.hypot(vf, vl);
    const a = s.wheelbase * 0.5, b = s.wheelbase * 0.5, hcg = s.H * 0.22;

    // --- steering (speed sensitive, arcade affordance) ---
    const hand = s.handling;
    const maxSteer = 0.62 / (1 + Math.abs(vf) / 16) * (0.85 + 0.15 * hand);
    let target = -inp.steer * maxSteer;
    // gentle counter-steer assist while sliding
    const beta = Math.atan2(vl, Math.max(Math.abs(vf), 1));
    if (Math.abs(vf) > 4) target += beta * 0.25 * Math.sign(vf);
    const rate = 5.5 * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));
    const st = this.steer;

    // --- normal loads with longitudinal load transfer ---
    const mg = m * G;
    const df = s.downforce ? 1 + s.downforce * v * v / 1600 : 1;
    let Nf = mg * 0.5 - m * this.ax * hcg / s.wheelbase;
    let Nr = mg * 0.5 + m * this.ax * hcg / s.wheelbase;
    Nf = Math.max(0.15 * mg, Nf) * df; Nr = Math.max(0.15 * mg, Nr) * df;

    const loadFactor = 1 - 0.08 * (m / 1000 - 1);
    const mu0 = 1.5 * s.grip * loadFactor * this.gripMul;
    const wg = this.wheelGrip;
    let muF = mu0 * (wg[0] + wg[1]) * 0.5, muR = mu0 * (wg[2] + wg[3]) * 0.5;

    // --- longitudinal forces ---
    const P = s.kW * 1000 * this.powerMul * (inp.boost ? (s.boostMul || 1.35) : 1);
    const vBase = 9;
    let drive = 0, brakeF = 0, brakeR = 0;
    const thr = Math.max(0, inp.throttle), brk = Math.max(0, inp.brake);
    if (thr > 0) {
      if (vf > -1) drive = thr * P / Math.max(vf, vBase);
      else { brakeF = brakeR = thr * s.brake * mg * 0.45; } // throttle while rolling backwards = brake
    }
    if (brk > 0) {
      if (vf > 1) { brakeF += brk * s.brake * mg * 1.15 * 0.74; brakeR += brk * s.brake * mg * 1.15 * 0.26; }
      else if (vf > -11) drive -= brk * 0.5 * P / Math.max(-vf, vBase); // reverse
    }
    let hb = inp.handbrake ? 1 : 0;
    if (hb) { brakeR += muR * Nr * 0.7; muR *= 0.45; }

    // brake lockup without ABS reduces lateral grip on that axle
    this.locked = false;
    const capF = muF * Nf, capR = muR * Nr;
    if (brakeF > capF * 0.98) { if (!s.abs) { this.locked = true; muF *= 0.7; } brakeF = capF * (s.abs ? 0.95 : 0.8); }
    if (brakeR > capR * 0.98) { if (!s.abs) { this.locked = true; muR *= 0.75; } brakeR = capR * (s.abs ? 0.95 : 0.8); }
    const sgn = vf >= 0 ? 1 : -1;
    // AWD split 35/65 (rear-biased for fun)
    let FxF = drive * 0.35 - brakeF * sgn * (Math.abs(vf) > 0.2 ? 1 : Math.abs(vf) / 0.2);
    let FxR = drive * 0.65 - brakeR * sgn * (Math.abs(vf) > 0.2 ? 1 : Math.abs(vf) / 0.2);

    // --- lateral forces (slip angles) ---
    const vfa = Math.max(Math.abs(vf), 2.2);
    const aF = Math.atan2(vl + this.w * a, vfa) - st * sgn;
    const aR = Math.atan2(vl - this.w * b, vfa);
    const C = 7.5 * (0.8 + 0.2 * hand);
    let FyF = -Math.tanh(C * aF) * muF * Nf;
    let FyR = -Math.tanh(C * aR * 1.05) * muR * Nr;

    // friction circle per axle (power oversteer!)
    const circ = (fx, fy, cap) => {
      const t = Math.hypot(fx, fy);
      if (t > cap && t > 0) { const k = cap / t; return [fx * k, fy * k, true]; }
      return [fx, fy, false];
    };
    let sF, sR;
    [FxF, FyF, sF] = circ(FxF, FyF, muF * Nf * 1.05);
    [FxR, FyR, sR] = circ(FxR, FyR, muR * Nr * 1.05);
    this.spinning = sR && thr > 0.5 && Math.abs(vf) < 15;

    // --- resistances ---
    const drag = 0.5 * RHO * s.cd * s.area * v;
    const Fdx = -drag * vf, Fdl = -drag * vl;
    const roll = CRR * mg * (Math.abs(vf) > 0.3 ? Math.sign(vf) : vf / 0.3);

    const cst = Math.cos(st), sst = Math.sin(st);
    const Ff = FxF * cst - FyF * sst + FxR + Fdx - roll;
    const Fl = FyF * cst + FxF * sst + FyR + Fdl;
    let torque = (FyF * cst + FxF * sst) * a - FyR * b;
    torque -= this.w * this.I * 0.35 * (0.6 + 0.4 * hand); // yaw damping (stability affordance)

    // world forces
    const Fx = Ff * sn + Fl * cs, Fz = Ff * cs - Fl * sn;
    this.vx += Fx / m * dt; this.vz += Fz / m * dt;
    this.w += torque / this.I * dt;
    this.ax = this.ax * 0.8 + (Ff / m) * 0.2;
    this.ay = this.ay * 0.8 + (Fl / m) * 0.2;

    // low-speed settling (no creeping)
    if (thr === 0 && brk === 0 && v < 0.6) { this.vx *= 0.9; this.vz *= 0.9; this.w *= 0.9; }

    this.h += this.w * dt;
    this.x += this.vx * dt; this.z += this.vz * dt;

    vf = this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);
    vl = this.vx * Math.cos(this.h) - this.vz * Math.sin(this.h);
    this.vf = vf; this.vl = vl;
    this.wheelSpin += (vf / (s.wheelR || 0.34)) * dt * (this.spinning ? 1.8 : 1) * (this.locked ? 0 : 1);
    const slideAmt = Math.min(1, Math.max(0, (Math.abs(vl) - 2.5) / 7));
    this.slip = Math.max(slideAmt, (this.locked && Math.abs(vf) > 3) ? 0.8 : 0, this.spinning ? 0.6 : 0, hb && v > 5 ? 0.7 : 0);
  }

  // corners in world space: FL, FR, RR, RL
  corners(pad = 0) {
    const s = this.spec, hl = s.L / 2 + pad, hw = s.W / 2 + pad;
    const sn = Math.sin(this.h), cs = Math.cos(this.h);
    const pts = [[hw, hl], [-hw, hl], [-hw, -hl], [hw, -hl]];
    return pts.map(([lx, lz]) => [this.x + lx * cs + lz * sn, this.z - lx * sn + lz * cs]);
  }
  toLocal(px, pz) {
    const dx = px - this.x, dz = pz - this.z, sn = Math.sin(this.h), cs = Math.cos(this.h);
    return [dx * cs - dz * sn, dx * sn + dz * cs]; // [left, forward]
  }
  toWorld(lx, lz) {
    const sn = Math.sin(this.h), cs = Math.cos(this.h);
    return [this.x + lx * cs + lz * sn, this.z - lx * sn + lz * cs];
  }
  pointVel(px, pz) { // velocity of a world point on the body
    const rx = px - this.x, rz = pz - this.z;
    return [this.vx + this.w * rz, this.vz - this.w * rx];
  }
  applyImpulse(px, pz, jx, jz) {
    this.vx += jx / this.m; this.vz += jz / this.m;
    const rx = px - this.x, rz = pz - this.z;
    this.w += (rz * jx - rx * jz) / this.I;
  }
}

// ---------- geometry helpers ----------
export function obbAxes(h) { const sn = Math.sin(h), cs = Math.cos(h); return [[cs, -sn], [sn, cs]]; }

function project(pts, ax) {
  let mn = Infinity, mx = -Infinity;
  for (const p of pts) { const d = p[0] * ax[0] + p[1] * ax[1]; if (d < mn) mn = d; if (d > mx) mx = d; }
  return [mn, mx];
}

// SAT between two convex quads (point arrays). Returns {nx,nz,depth,px,pz} normal from A to B or null
export function satQuads(A, B, ca, cb, axesA, axesB) {
  let best = Infinity, bn = null, owner = 0;
  const axes = [...axesA.map(a => [a, 0]), ...axesB.map(a => [a, 1])];
  for (const [ax, o] of axes) {
    const [a0, a1] = project(A, ax), [b0, b1] = project(B, ax);
    const ov = Math.min(a1, b1) - Math.max(a0, b0);
    if (ov <= 0) return null;
    if (ov < best) { best = ov; bn = ax; owner = o; }
  }
  let nx = bn[0], nz = bn[1];
  if ((cb[0] - ca[0]) * nx + (cb[1] - ca[1]) * nz < 0) { nx = -nx; nz = -nz; }
  // contact point: deepest vertex
  let px, pz;
  if (owner === 0) { let mn = Infinity; for (const p of B) { const d = p[0] * nx + p[1] * nz; if (d < mn) { mn = d; px = p[0]; pz = p[1]; } } }
  else { let mx = -Infinity; for (const p of A) { const d = p[0] * nx + p[1] * nz; if (d > mx) { mx = d; px = p[0]; pz = p[1]; } } }
  return { nx, nz, depth: best, px, pz };
}

export function boxPoints(x, z, w, d, rot) {
  const sn = Math.sin(rot), cs = Math.cos(rot), hw = w / 2, hd = d / 2;
  return [[hw, hd], [-hw, hd], [-hw, -hd], [hw, -hd]].map(([lx, lz]) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs]);
}

// closest point on OBB (car) to point
export function closestOnCar(car, px, pz) {
  const [lx, lz] = car.toLocal(px, pz);
  const hw = car.spec.W / 2, hl = car.spec.L / 2;
  const cx = Math.max(-hw, Math.min(hw, lx)), cz = Math.max(-hl, Math.min(hl, lz));
  const [wx, wz] = car.toWorld(cx, cz);
  return { wx, wz, inside: cx === lx && cz === lz, lx, lz };
}

// Resolve contact between car and static geometry. n points from static into car.
export function resolveStatic(car, px, pz, nx, nz, depth, e = 0.25, fr = 0.35) {
  car.x += nx * depth; car.z += nz * depth;
  const [vx, vz] = car.pointVel(px, pz);
  const vn = vx * nx + vz * nz;
  if (vn >= 0) return 0;
  const rx = px - car.x, rz = pz - car.z;
  const rn = rz * nx - rx * nz;
  const k = 1 / car.m + rn * rn / car.I;
  const j = -(1 + e) * vn / k;
  car.applyImpulse(px, pz, nx * j, nz * j);
  // friction
  const tx = -nz, tz = nx; const vt = vx * tx + vz * tz;
  const rt = rz * tx - rx * tz; const kt = 1 / car.m + rt * rt / car.I;
  let jt = -vt / kt; jt = Math.max(-fr * j, Math.min(fr * j, jt));
  car.applyImpulse(px, pz, tx * jt, tz * jt);
  return -vn; // closing speed
}

// Resolve car-car contact. n from A to B.
export function resolvePair(A, B, c, e = 0.2, fr = 0.3) {
  const { nx, nz, depth, px, pz } = c;
  const ia = 1 / A.m, ib = 1 / B.m, tot = ia + ib;
  A.x -= nx * depth * ia / tot; A.z -= nz * depth * ia / tot;
  B.x += nx * depth * ib / tot; B.z += nz * depth * ib / tot;
  const [ax, az] = A.pointVel(px, pz), [bx, bz] = B.pointVel(px, pz);
  const rvx = bx - ax, rvz = bz - az;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return 0;
  const rax = px - A.x, raz = pz - A.z, rbx = px - B.x, rbz = pz - B.z;
  const ran = raz * nx - rax * nz, rbn = rbz * nx - rbx * nz;
  const k = ia + ib + ran * ran / A.I + rbn * rbn / B.I;
  const j = -(1 + e) * vn / k;
  A.applyImpulse(px, pz, -nx * j, -nz * j);
  B.applyImpulse(px, pz, nx * j, nz * j);
  const tx = -nz, tz = nx, vt = rvx * tx + rvz * tz;
  const rat = raz * tx - rax * tz, rbt = rbz * tx - rbx * tz;
  const kt = ia + ib + rat * rat / A.I + rbt * rbt / B.I;
  let jt = -vt / kt; jt = Math.max(-fr * j, Math.min(fr * j, jt));
  A.applyImpulse(px, pz, -tx * jt, -tz * jt);
  B.applyImpulse(px, pz, tx * jt, tz * jt);
  return -vn;
}

// segment vs car OBB (2D). returns {t, lx, lz, face} or null. face from car's perspective.
export function segVsCar(car, x0, z0, x1, z1, pad = 0) {
  const [ax, az] = car.toLocal(x0, z0), [bx, bz] = car.toLocal(x1, z1);
  const hw = car.spec.W / 2 + pad, hl = car.spec.L / 2 + pad;
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1, face = null;
  const clip = (p, q, f) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) { t0 = r; face = f; } }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clip(-dx, ax + hw, 'left')) return null;   // entering through +x (left) side
  if (!clip(dx, hw - ax, 'right')) return null;
  if (!clip(-dz, az + hl, 'back')) return null;
  if (!clip(dz, hl - az, 'front')) return null;
  // fix naming: clip(-dx, ax+hw) handles plane x = -hw (right side), so swap
  if (face === 'left') face = 'right'; else if (face === 'right') face = 'left';
  else if (face === 'back') face = 'back'; else if (face === 'front') face = 'front';
  if (face === null) { // started inside
    face = Math.abs(ax) / hw > Math.abs(az) / hl ? (ax > 0 ? 'left' : 'right') : (az > 0 ? 'front' : 'back');
  }
  return { t: t0, lx: ax + dx * t0, lz: az + dz * t0, face };
}

export function locFromLocal(car, lx, lz) {
  const hw = car.spec.W / 2, hl = car.spec.L / 2;
  if (Math.abs(lx) / hw > Math.abs(lz) / hl) return lx > 0 ? 'left' : 'right';
  return lz > 0 ? 'front' : 'back';
}

// segment vs circle -> t or null
export function segVsCircle(x0, z0, x1, z1, cx, cz, r) {
  const dx = x1 - x0, dz = z1 - z0, fx = x0 - cx, fz = z0 - cz;
  const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r;
  if (c < 0) return 0;
  const disc = b * b - 4 * a * c; if (disc < 0 || a === 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

// segment vs oriented box -> t or null
export function segVsBox(x0, z0, x1, z1, bx, bz, w, d, rot) {
  const sn = Math.sin(rot), cs = Math.cos(rot);
  const L = (px, pz) => { const dx = px - bx, dz = pz - bz; return [dx * cs - dz * sn, dx * sn + dz * cs]; };
  const [ax, az] = L(x0, z0), [ex, ez] = L(x1, z1);
  const dx = ex - ax, dz = ez - az, hw = w / 2, hd = d / 2;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (clip(-dx, ax + hw) && clip(dx, hw - ax) && clip(-dz, az + hd) && clip(dz, hd - az)) return t0;
  return null;
}
