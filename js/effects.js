// Particles, tracers, beams, explosions, decals, lights.
import * as THREE from 'three';
import { glowTex, smokeTex, additive } from './gfx.js';

class Particles {
  constructor(scene, max, tex, blending) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA;
        uniform float scale; void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.0);
        gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
      transparent: true, depthWrite: false, blending,
    });
    this.mat = m;
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1 = c0, a0 = 1, grav = 0, drag = 0) {
    let i = this.n;
    if (i >= this.max) { i = Math.floor(Math.random() * this.max); } else this.n++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.grav[i] = grav; this.drag[i] = drag;
    this.c0[i3] = c0.r; this.c0[i3 + 1] = c0.g; this.c0[i3 + 2] = c0.b;
    this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.swap(i, this.n - 1); this.n--; continue; }
      const i3 = i * 3, t = 1 - this.life[i] / this.maxLife[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.05 && this.grav[i] > 0) { this.pos[i3 + 1] = 0.05; this.vel[i3 + 1] *= -0.4; this.vel[i3] *= 0.6; this.vel[i3 + 2] *= 0.6; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 12 + 0.3);
      this.col[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.col[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.col[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
  }
  swap(a, b) {
    if (a === b) return;
    const arrs3 = [this.pos, this.vel, this.c0, this.c1, this.col];
    for (const A of arrs3) for (let k = 0; k < 3; k++) A[a * 3 + k] = A[b * 3 + k];
    for (const A of [this.life, this.maxLife, this.s0, this.s1, this.a0, this.grav, this.drag, this.size, this.alpha]) A[a] = A[b];
  }
  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
}

const C = (hex) => new THREE.Color(hex);
const COL = {
  fire1: C(0xffe680), fire2: C(0xff3a10), spark: C(0xfff2b0), sparkEnd: C(0xff6a00),
  smokeD: C(0x2a2030), smokeL: C(0x6a5a78), purple: C(0xb070ff), purpleEnd: C(0x5a2a9a),
  white: C(0xffffff), dust: C(0x6a4a7a),
};

export class Effects {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.q = quality;
    const mul = quality === 'low' ? 0.5 : 1;
    this.add = new Particles(scene, Math.floor(3500 * mul), glowTex(), THREE.AdditiveBlending);
    this.smoke = new Particles(scene, Math.floor(1800 * mul), smokeTex(), THREE.NormalBlending);
    this.add.points.renderOrder = 5; this.smoke.points.renderOrder = 4;

    // tracers
    this.maxTracers = 400;
    const tg = new THREE.BoxGeometry(1, 1, 1);
    this.tracers = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), this.maxTracers);
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.setColorAt(0, new THREE.Color(1, 1, 1));
    this.tracers.count = 0; this.tracers.frustumCulled = false;
    scene.add(this.tracers);

    // beams
    this.beams = [];
    const bg = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true); bg.rotateX(Math.PI / 2); bg.translate(0, 0, 0.5);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.visible = false; m.frustumCulled = false; scene.add(m);
      this.beams.push({ mesh: m, life: 0, max: 0, w: 0 });
    }
    // shockwave rings
    this.rings = [];
    const rg = new THREE.RingGeometry(0.7, 1, 40); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; scene.add(m); this.rings.push({ mesh: m, life: 0, max: 0, r: 0 });
    }
    // flash lights (fixed count to avoid shader recompiles)
    this.lights = [];
    for (let i = 0; i < (quality === 'low' ? 1 : 3); i++) {
      const l = new THREE.PointLight(0xff8a3c, 0, 30, 1.6); l.position.y = 3; scene.add(l); this.lights.push({ l, life: 0, max: 1, I: 0 });
    }
    // decals: scorch & oil & mines etc handled by world; scorch here
    this.decals = [];
    const dg = new THREE.PlaneGeometry(1, 1); dg.rotateX(-Math.PI / 2);
    this.decalGeo = dg;
    this.scorchMat = new THREE.MeshBasicMaterial({ map: glowTex(), color: 0x000000, transparent: true, opacity: 0.7, depthWrite: false });
    this.time = 0;
  }

  tracer(i, x, y, z, dx, dz, dy, len, thick, color) {
    if (i >= this.maxTracers) return;
    const m = this._m || (this._m = new THREE.Matrix4());
    const q = this._q || (this._q = new THREE.Quaternion());
    const v = this._v || (this._v = new THREE.Vector3());
    const s = this._s || (this._s = new THREE.Vector3());
    const d = Math.hypot(dx, dy, dz) || 1;
    v.set(dx / d, dy / d, dz / d);
    q.setFromUnitVectors(this._z || (this._z = new THREE.Vector3(0, 0, 1)), v);
    s.set(thick, thick, len);
    m.compose(this._p || (this._p = new THREE.Vector3()), q, s);
    m.setPosition(x - v.x * len / 2, y - v.y * len / 2, z - v.z * len / 2);
    this.tracers.setMatrixAt(i, m);
    this.tracers.setColorAt(i, this._c || (this._c = new THREE.Color()).set(color));
  }
  setTracerCount(n) {
    this.tracers.count = Math.min(n, this.maxTracers);
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
  }

  beam(x0, y0, z0, x1, y1, z1, color, width = 0.12, life = 0.12) {
    for (let k = 0; k < 2; k++) {
      const b = this.beams.find(b => b.life <= 0); if (!b) return;
      const m = b.mesh; m.visible = true;
      m.position.set(x0, y0, z0); m.lookAt(x1, y1, z1);
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      b.w = k === 0 ? width : width * 0.35;
      m.scale.set(b.w, b.w, len);
      m.material.color.set(k === 0 ? color : 0xffffff);
      b.life = b.max = life;
    }
  }
  arc(x0, y0, z0, x1, y1, z1, color) {
    let px = x0, py = y0, pz = z0;
    const segs = 5;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const j = i === segs ? 0 : 0.9;
      const nx = x0 + (x1 - x0) * t + (Math.random() - 0.5) * j * 2, ny = y0 + (y1 - y0) * t + (Math.random() - 0.5) * j, nz = z0 + (z1 - z0) * t + (Math.random() - 0.5) * j * 2;
      this.beam(px, py, pz, nx, ny, nz, color, 0.09, 0.15);
      px = nx; py = ny; pz = nz;
    }
  }

  flash(x, y, z, color, intensity = 40, life = 0.25) {
    if (!this.lights.length) return;
    let L = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    L.l.position.set(x, y + 2, z); L.l.color.set(color); L.I = intensity; L.life = L.max = life;
  }

  ring(x, z, r, color = 0xff9a3c, life = 0.5) {
    const R = this.rings.find(r => r.life <= 0); if (!R) return;
    R.mesh.visible = true; R.mesh.position.set(x, 0.15, z); R.r = r; R.life = R.max = life; R.mesh.material.color.set(color);
  }

  scorch(x, z, size) {
    let d;
    if (this.decals.length < 40) { d = new THREE.Mesh(this.decalGeo, this.scorchMat); this.scene.add(d); this.decals.push(d); }
    else { d = this.decals.shift(); this.decals.push(d); }
    d.position.set(x, 0.04 + Math.random() * 0.01, z); d.scale.set(size, 1, size); d.rotation.y = Math.random() * 6;
  }

  // ---- composite effects ----
  muzzle(x, y, z, dx, dz, color) {
    const c = C(color);
    for (let i = 0; i < 3; i++) this.add.emit(x, y, z, dx * (8 + Math.random() * 8) + (Math.random() - 0.5) * 3, Math.random() * 2, dz * (8 + Math.random() * 8) + (Math.random() - 0.5) * 3, 0.08, 0.9, 0.2, COL.white, c, 1);
  }
  sparks(x, y, z, n = 8, color = null) {
    const c0 = color ? C(color) : COL.spark;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 12;
      this.add.emit(x, y, z, Math.cos(a) * s, 2 + Math.random() * 7, Math.sin(a) * s, 0.25 + Math.random() * 0.35, 0.35, 0.05, c0, COL.sparkEnd, 1, 18, 1);
    }
  }
  hitFlash(x, y, z, color) { this.add.emit(x, y, z, 0, 0, 0, 0.12, 2.2, 0.5, C(color), C(color), 1); }
  explosion(x, z, size = 1, color = 0xff7a1a) {
    const n = Math.floor((this.q === 'low' ? 20 : 40) * size);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random(), s = (3 + Math.random() * 10) * size;
      this.add.emit(x, 0.6 + Math.random(), z, Math.cos(a) * s * (1 - e * 0.5), e * 8 * size, Math.sin(a) * s * (1 - e * 0.5), 0.4 + Math.random() * 0.5, 2.5 * size, 4.5 * size, COL.fire1, COL.fire2, 1, -2, 3);
    }
    for (let i = 0; i < n * 0.6; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 5 * size;
      this.smoke.emit(x, 1 + Math.random() * 2, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 1.4 + Math.random() * 1.6, 2 * size, 7 * size, COL.smokeD, COL.smokeL, 0.85, -0.5, 1.2);
    }
    this.sparks(x, 1, z, Math.floor(16 * size));
    this.add.emit(x, 1.5, z, 0, 0, 0, 0.18, 10 * size, 14 * size, COL.white, C(color), 1);
    this.ring(x, z, 7 * size, color, 0.5);
    this.flash(x, 1, z, color, 60 * size, 0.35);
    this.scorch(x, z, 5 * size);
  }
  smokePuff(x, y, z, dark = 0.5, size = 1) {
    const c0 = dark > 0.6 ? COL.smokeD : COL.smokeL;
    this.smoke.emit(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.5, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 1.2 + Math.random(), 0.8 * size, 3.5 * size, c0, COL.smokeL, 0.6, -0.3, 0.8);
  }
  fire(x, y, z, size = 1) {
    this.add.emit(x + (Math.random() - 0.5) * 0.8 * size, y, z + (Math.random() - 0.5) * 0.8 * size, (Math.random() - 0.5), 3 + Math.random() * 3, (Math.random() - 0.5), 0.35 + Math.random() * 0.3, 1.1 * size, 0.3, COL.fire1, COL.fire2, 1, -3, 1);
  }
  flame(x, y, z, vx, vz, ivx, ivz) {
    const s = 1 + Math.random() * 0.4;
    this.add.emit(x, y, z, vx * s + ivx + (Math.random() - 0.5) * 4, Math.random() * 2, vz * s + ivz + (Math.random() - 0.5) * 4, 0.55 + Math.random() * 0.25, 0.5, 3.2, COL.fire1, COL.fire2, 1, -2, 1.5);
  }
  rocketTrail(x, y, z, color) {
    this.add.emit(x, y, z, (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5), 0.15, 0.9, 0.3, COL.fire1, C(color), 1);
    this.smoke.emit(x, y, z, (Math.random() - 0.5) * 0.6, 0.5, (Math.random() - 0.5) * 0.6, 0.9, 0.5, 2.2, COL.smokeL, COL.smokeL, 0.45, -0.2, 0.5);
  }
  smokeCloud(x, z) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 4;
      this.smoke.emit(x + Math.cos(a) * s, 0.5 + Math.random() * 2, z + Math.sin(a) * s, Math.cos(a) * 1.5, 0.6 + Math.random(), Math.sin(a) * 1.5, 7 + Math.random() * 3, 3, 9, COL.purple, COL.purpleEnd, 0.75, -0.05, 0.4);
    }
  }
  skid(x, z, color) { this.smoke.emit(x, 0.25, z, (Math.random() - 0.5), 0.6, (Math.random() - 0.5), 0.8, 0.5, 2.2, COL.dust, COL.smokeL, 0.32, 0, 0.5); }
  boost(x, y, z, color) { this.add.emit(x, y, z, (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, 0.25, 0.8, 0.1, COL.white, C(color), 1); }
  pickupBurst(x, z, color) {
    for (let i = 0; i < 30; i++) { const a = i / 30 * Math.PI * 2; this.add.emit(x, 1, z, Math.cos(a) * 9, 3 + Math.random() * 4, Math.sin(a) * 9, 0.6, 0.8, 0.1, COL.white, C(color), 1, 6, 2); }
    this.ring(x, z, 6, color, 0.4);
  }

  update(dt) {
    this.time += dt;
    this.add.update(dt); this.smoke.update(dt);
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      const k = b.life / b.max; b.mesh.material.opacity = k; b.mesh.scale.x = b.mesh.scale.y = b.w * (0.6 + 0.4 * k);
    }
    for (const R of this.rings) {
      if (R.life <= 0) continue; R.life -= dt;
      if (R.life <= 0) { R.mesh.visible = false; continue; }
      const t = 1 - R.life / R.max; const s = R.r * (0.2 + t);
      R.mesh.scale.set(s, 1, s); R.mesh.material.opacity = (1 - t) * 0.9;
    }
    for (const L of this.lights) {
      if (L.life <= 0) { L.l.intensity = 0; continue; }
      L.life -= dt; L.l.intensity = L.I * Math.max(0, L.life / L.max);
    }
  }
  clear() {
    this.add.clear(); this.smoke.clear(); this.setTracerCount(0);
    for (const b of this.beams) { b.life = 0; b.mesh.visible = false; }
    for (const R of this.rings) { R.life = 0; R.mesh.visible = false; }
    for (const d of this.decals) this.scene.remove(d); this.decals = [];
  }
  setPixelScale(h) { this.add.mat.uniforms.scale.value = h * 0.75; this.smoke.mat.uniforms.scale.value = h * 0.75; }
}
