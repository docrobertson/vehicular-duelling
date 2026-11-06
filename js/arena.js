// Arena: synthwave visuals + collision geometry.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENAS } from './data.js';
import { boxPoints, obbAxes, satQuads, closestOnCar, segVsBox, segVsCircle } from './physics.js';
import { textTexture, glowTex, additive, emissive } from './gfx.js';

const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`;
const SKY_FS = `uniform vec3 top, mid, hor, sunA, sunB; uniform vec3 sunDir; uniform float time; varying vec3 vDir;
  float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
  void main(){
    vec3 d = normalize(vDir); float y = d.y;
    vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, y));
    c = mix(c, top, smoothstep(0.18, 0.7, y));
    // stars
    vec3 sp = floor(d * 220.0); float st = step(0.996, hash(sp)) * smoothstep(0.15, 0.6, y);
    c += vec3(st) * (0.6 + 0.4*sin(time*3.0 + hash(sp)*30.0));
    // retro sun with stripes
    float a = acos(clamp(dot(d, sunDir), -1.0, 1.0));
    float R = 0.32;
    if (a < R) {
      float sy = (y - sunDir.y) / R; // -1..1
      vec3 sc = mix(sunB, sunA, smoothstep(-0.9, 0.7, sy));
      float stripe = 1.0;
      if (sy < 0.15) { float f = fract((sy + 2.0) * 9.0 * (1.0 + (0.15 - sy))); stripe = step(0.18 + (0.15 - sy)*0.55, f); }
      c = mix(c, sc * 1.6, stripe * smoothstep(R, R-0.01, a));
    }
    c += sunB * 0.35 * exp(-a * 4.0) * smoothstep(-0.05, 0.1, y);
    // horizon glow line
    c += hor * 0.6 * exp(-abs(y) * 40.0);
    gl_FragColor = vec4(c, 1.0);
  }`;

const GROUND_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const GROUND_FS = `uniform vec3 gridCol, fogCol, baseCol; uniform vec3 camPos; uniform float shape; uniform vec2 size; uniform float time; varying vec3 vW;
  float gridLine(vec2 p, float s, float w){ vec2 g = abs(fract(p / s - 0.5) - 0.5) * s; vec2 fw = fwidth(p); vec2 l = 1.0 - smoothstep(vec2(0.0), fw * w + 0.04, g); return max(l.x, l.y); }
  void main(){
    vec2 p = vW.xz;
    float inside; float edge;
    if (shape < 0.5) { float r = length(p); inside = step(r, size.x); edge = abs(r - size.x); }
    else { vec2 q = abs(p) - size; inside = step(max(q.x, q.y), 0.0); edge = abs(max(q.x, q.y)); }
    vec3 c = baseCol * (inside > 0.5 ? 1.0 : 0.55);
    float g1 = gridLine(p, 8.0, 1.2);
    float g2 = gridLine(p, 2.0, 0.8) * 0.18;
    float pulse = 0.75 + 0.25 * sin(time * 2.0 - length(p) * 0.04);
    c += gridCol * (g1 * (inside > 0.5 ? 0.85 : 0.5) * pulse + g2 * inside);
    c += gridCol * 2.2 * (1.0 - smoothstep(0.0, 0.6, edge));
    c += gridCol * 0.25 * exp(-edge * 0.15) * inside;
    float d = length(vW - camPos);
    float f = smoothstep(120.0, 650.0, d);
    c = mix(c, fogCol, f);
    gl_FragColor = vec4(c, 1.0);
  }`;

export class Arena {
  constructor(id, scene, quality = 'high') {
    this.def = ARENAS[id];
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.obstacles = this.def.obstacles.map(o => ({ ...o, rot: o.rot || 0 }));
    for (const o of this.obstacles) if (o.t === 'box') { o.pts = boxPoints(o.x, o.z, o.w, o.d, o.rot); o.axes = obbAxes(o.rot); }
    this.quality = quality;
    this.time = 0;
    this.build();
  }

  get bounds() { const d = this.def; return d.shape === 'circle' ? { r: d.radius } : { hw: d.w / 2, hd: d.d / 2 }; }

  build() {
    const d = this.def, G = this.group;
    const sunDir = new THREE.Vector3(0, 0.12, -1).normalize();
    // sky
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(d.sky.top) }, mid: { value: new THREE.Color(d.sky.mid) }, hor: { value: new THREE.Color(d.sky.horizon) },
        sunA: { value: new THREE.Color(d.sun[0]) }, sunB: { value: new THREE.Color(d.sun[1]) }, sunDir: { value: sunDir }, time: { value: 0 } },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    G.add(this.sky);

    // ground
    const isC = d.shape === 'circle';
    this.groundMat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VS, fragmentShader: GROUND_FS, extensions: { derivatives: true },
      uniforms: { gridCol: { value: new THREE.Color(d.grid) }, fogCol: { value: new THREE.Color(d.sky.horizon).multiplyScalar(0.35) }, baseCol: { value: new THREE.Color(0x0b0614) },
        camPos: { value: new THREE.Vector3() }, shape: { value: isC ? 0 : 1 }, size: { value: isC ? new THREE.Vector2(d.radius, 0) : new THREE.Vector2(d.w / 2, d.d / 2) }, time: { value: 0 } },
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), this.groundMat);
    ground.rotation.x = -Math.PI / 2; G.add(ground);

    // mountains (wireframe synth ridges) in a ring
    const mg = [];
    const ridge = (radius, n, hMax, seed) => {
      const geo = new THREE.CylinderGeometry(radius, radius, 1, n, 6, true);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i) + 0.5, z = pos.getZ(i);
        const ang = Math.atan2(z, x);
        const nse = Math.abs(Math.sin(ang * 7 + seed) * 0.6 + Math.sin(ang * 13 + seed * 2) * 0.3 + Math.sin(ang * 31 + seed) * 0.15);
        const h = hMax * nse * y * y + y * 6;
        pos.setY(i, h);
        const pull = 1 - y * 0.12;
        pos.setX(i, x * pull); pos.setZ(i, z * pull);
      }
      geo.computeVertexNormals();
      return geo;
    };
    const mMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(d.sky.top).multiplyScalar(0.6), fog: false, side: THREE.DoubleSide });
    const wMat = new THREE.MeshBasicMaterial({ color: d.grid, wireframe: true, fog: false, transparent: true, opacity: 0.55 });
    const r1 = ridge(620, 90, 120, 1.3), r2 = ridge(720, 70, 190, 4.1);
    for (const g of [r2, r1]) { G.add(new THREE.Mesh(g, mMat)); G.add(new THREE.Mesh(g, wMat)); }

    // walls
    this.buildWalls();
    // obstacles
    this.buildObstacles();
    // decor
    this.buildDecor();

    // lights
    const hemi = new THREE.HemisphereLight(new THREE.Color(d.sky.mid).lerp(new THREE.Color(0xffffff), 0.5), 0x1a0a2a, 1.1);
    G.add(hemi);
    const sun = new THREE.DirectionalLight(new THREE.Color(d.sun[0]).lerp(new THREE.Color(0xffffff), 0.4), 2.2);
    sun.position.set(-40, 60, -80); G.add(sun);
    const fill = new THREE.DirectionalLight(new THREE.Color(d.grid), 0.8); fill.position.set(50, 30, 60); G.add(fill);
    this.scene.fog = new THREE.Fog(d.fog, 160, 700);
  }

  buildWalls() {
    const d = this.def, G = this.group;
    const wallH = 1.6;
    const chev = this.chevronTex(d.grid);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1028, metalness: 0.6, roughness: 0.4, map: chev, emissive: 0xffffff, emissiveMap: chev, emissiveIntensity: 0.6 });
    const topMat = emissive(d.grid);
    const geos = [], tops = [];
    const seg = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
      const g = new THREE.BoxGeometry(0.8, wallH, len + 0.4); g.rotateY(ang); g.translate((x0 + x1) / 2, wallH / 2, (z0 + z1) / 2);
      // uv repeat along length
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 3);
      geos.push(g);
      const t = new THREE.BoxGeometry(0.9, 0.12, len + 0.4); t.rotateY(ang); t.translate((x0 + x1) / 2, wallH + 0.06, (z0 + z1) / 2); tops.push(t);
    };
    if (d.shape === 'circle') {
      const n = 72, R = d.radius + 0.4;
      for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; seg(Math.cos(a0) * R, Math.sin(a0) * R, Math.cos(a1) * R, Math.sin(a1) * R); }
    } else {
      const hw = d.w / 2 + 0.4, hd = d.d / 2 + 0.4;
      seg(-hw, -hd, hw, -hd); seg(hw, -hd, hw, hd); seg(hw, hd, -hw, hd); seg(-hw, hd, -hw, -hd);
    }
    G.add(new THREE.Mesh(mergeGeometries(geos), wallMat));
    G.add(new THREE.Mesh(mergeGeometries(tops), topMat));
  }

  chevronTex(color) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#120a1e'; g.fillRect(0, 0, 128, 64);
    const col = '#' + new THREE.Color(color).getHexString();
    g.fillStyle = col; g.globalAlpha = 0.85;
    for (let i = -1; i < 3; i++) { g.beginPath(); const x = i * 64; g.moveTo(x, 8); g.lineTo(x + 28, 8); g.lineTo(x + 52, 32); g.lineTo(x + 28, 56); g.lineTo(x, 56); g.lineTo(x + 24, 32); g.closePath(); g.fill(); }
    g.globalAlpha = 1; g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 3); g.fillRect(0, 61, 128, 3);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  buildObstacles() {
    const d = this.def, G = this.group;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c1430, metalness: 0.7, roughness: 0.3 });
    const neon = emissive(d.grid);
    const neon2 = emissive(d.sun[0]);
    for (const o of this.obstacles) {
      if (o.t === 'box') {
        const h = 2.4;
        const m = new THREE.Mesh(new THREE.BoxGeometry(o.w, h, o.d), bodyMat); m.position.set(o.x, h / 2, o.z); m.rotation.y = o.rot; G.add(m);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: d.grid }));
        e.position.copy(m.position); e.rotation.copy(m.rotation); G.add(e);
        const band = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.06, 0.18, o.d + 0.06), neon); band.position.set(o.x, h * 0.62, o.z); band.rotation.y = o.rot; G.add(band);
        const band2 = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.06, 0.08, o.d + 0.06), neon2); band2.position.set(o.x, h * 0.35, o.z); band2.rotation.y = o.rot; G.add(band2);
      } else {
        const h = o.r > 4 ? 9 : 5;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.9, o.r, h, 24), bodyMat); m.position.set(o.x, h / 2, o.z); G.add(m);
        for (let i = 0; i < 4; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(o.r * (0.98 - i * 0.02), 0.09, 6, 32), i % 2 ? neon2 : neon);
          ring.rotation.x = Math.PI / 2; ring.position.set(o.x, 0.8 + i * (h - 1.2) / 3, o.z); G.add(ring);
        }
        const cap = new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), neon2); cap.position.set(o.x, h, o.z); G.add(cap);
        if (o.r > 4) { // central hologram pyramid
          const pyr = new THREE.Mesh(new THREE.OctahedronGeometry(3.2, 0), new THREE.MeshBasicMaterial({ color: d.sun[1], wireframe: true }));
          pyr.position.set(o.x, h + 5, o.z); G.add(pyr); this.holo = pyr;
        }
      }
    }
  }

  buildDecor() {
    const d = this.def, G = this.group;
    const ring = [];
    if (d.shape === 'circle') {
      const R = d.radius + 14;
      for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2 + 0.06; ring.push([Math.cos(a) * R, Math.sin(a) * R, a]); }
    } else {
      const hw = d.w / 2 + 14, hd = d.d / 2 + 14;
      const per = 2 * (d.w + d.d); const n = Math.floor(per / 22);
      for (let i = 0; i < n; i++) {
        let t = i / n * per, x, z;
        if (t < d.w) { x = -hw + t * (2 * hw / d.w); z = -hd; }
        else if ((t -= d.w) < d.d) { x = hw; z = -hd + t * (2 * hd / d.d); }
        else if ((t -= d.d) < d.w) { x = hw - t * (2 * hw / d.w); z = hd; }
        else { t -= d.w; x = -hw; z = hd - t * (2 * hd / d.d); }
        ring.push([x, z, Math.atan2(z, x)]);
      }
    }
    // palms + light towers alternating
    const trunkGeo = [], leafGeo = [], lampPost = [], lampHead = [];
    ring.forEach(([x, z, a], i) => {
      if (i % 3 === 1) { // light tower
        const g = new THREE.CylinderGeometry(0.25, 0.35, 16, 6); g.translate(x, 8, z); lampPost.push(g);
        const h = new THREE.BoxGeometry(3, 1, 1); h.lookAt(new THREE.Vector3(-x, 0, -z)); h.translate(x, 16.3, z); lampHead.push(h);
      } else { // palm tree
        const segs = 7, lean = (i % 2 ? 1 : -1) * 0.25;
        let px = x, py = 0, pz = z;
        for (let s = 0; s < segs; s++) {
          const g = new THREE.CylinderGeometry(0.28 - s * 0.02, 0.32 - s * 0.02, 1.9, 6);
          g.rotateZ(lean * s * 0.15); g.translate(px, py + 0.95, pz); trunkGeo.push(g);
          px += Math.sin(lean * s * 0.15) * -1.9 * 0.5; py += 1.85;
        }
        for (let k = 0; k < 7; k++) {
          const ang = k / 7 * Math.PI * 2;
          const leaf = new THREE.ConeGeometry(0.5, 5.5, 3); leaf.scale(1, 1, 0.15);
          leaf.rotateZ(Math.PI / 2 + 0.5); leaf.translate(2.6, 0, 0); leaf.rotateY(ang); leaf.translate(px, py, pz);
          leafGeo.push(leaf);
        }
      }
    });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1030, roughness: 0.8 });
    const leafMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(d.sky.top).multiplyScalar(0.5) });
    if (trunkGeo.length) G.add(new THREE.Mesh(mergeGeometries(trunkGeo), trunkMat));
    if (leafGeo.length) {
      G.add(new THREE.Mesh(mergeGeometries(leafGeo), leafMat));
      const edge = new THREE.Mesh(mergeGeometries(leafGeo), new THREE.MeshBasicMaterial({ color: d.grid, wireframe: true, transparent: true, opacity: 0.35 }));
      G.add(edge);
    }
    if (lampPost.length) {
      G.add(new THREE.Mesh(mergeGeometries(lampPost), trunkMat));
      G.add(new THREE.Mesh(mergeGeometries(lampHead), emissive(0xfff0d0)));
      const glowM = additive(0xffe0b0, 0.5, glowTex());
      ring.forEach(([x, z], i) => { if (i % 3 === 1) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffd0a0, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.7, depthWrite: false })); s.position.set(x, 16.3, z); s.scale.set(9, 9, 1); G.add(s); } });
    }
    // billboards
    const ads = [
      [{ t: 'NEON', size: 120 }, { t: 'WRECKERS', size: 86 }],
      [{ t: 'VOLT-COLA', size: 92, c1: '#33f0ff', c2: '#ffffff', c3: '#ff2ad4', glow: '#33f0ff' }],
      [{ t: 'RADIO 2086', size: 84, c1: '#3cff9a', c2: '#ffe14a', c3: '#ff7a1a', glow: '#3cff9a' }],
      [{ t: 'ROBO', size: 100 }, { t: 'BURGER', size: 90, c1: '#ffffff', c2: '#ffe14a', c3: '#ffe14a' }],
      [{ t: 'DRIVE', size: 100, c1: '#ff2a8a', c2: '#ff2ad4', c3: '#7a2cff' }, { t: 'FAST', size: 100, c1: '#33f0ff', c2: '#33f0ff', c3: '#7a2cff' }],
    ];
    const nB = 5;
    for (let i = 0; i < nB; i++) {
      const tex = textTexture(ads[i % ads.length]);
      const ang = i / nB * Math.PI * 2 + 0.3;
      let x, z;
      if (d.shape === 'circle') { x = Math.cos(ang) * (d.radius + 26); z = Math.sin(ang) * (d.radius + 26); }
      else { const k = Math.max(Math.abs(Math.cos(ang)) / (d.w / 2 + 26), Math.abs(Math.sin(ang)) / (d.d / 2 + 26)); x = Math.cos(ang) / k; z = Math.sin(ang) / k; }
      const bb = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      bb.position.set(x, 13, z); bb.lookAt(0, 13, 0); G.add(bb);
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), trunkMat); legs.position.set(x, 4, z); G.add(legs);
    }
    // starting chevrons painted on floor? subtle centre logo ring
    const logo = new THREE.Mesh(new THREE.RingGeometry(10, 11, 64), additive(d.sun[1], 0.35));
    logo.rotation.x = -Math.PI / 2; logo.position.y = 0.03; G.add(logo);
  }

  update(dt, camera) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    this.skyMat.uniforms.time.value = this.time;
    this.groundMat.uniforms.time.value = this.time;
    this.groundMat.uniforms.camPos.value.copy(camera.position);
    if (this.holo) { this.holo.rotation.y += dt * 0.8; this.holo.position.y = 14 + Math.sin(this.time * 1.5) * 0.6; }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.userData?.shared) { /* cached mats kept */ } });
    this.scene.fog = null;
  }

  // ---------- collision ----------
  collideCar(car, out) {
    out.length = 0;
    const d = this.def;
    const pts = car.corners();
    if (d.shape === 'circle') {
      const R = d.radius;
      for (const [x, z] of pts) { const r = Math.hypot(x, z); if (r > R) out.push({ px: x, pz: z, nx: -x / r, nz: -z / r, depth: r - R }); }
    } else {
      const hw = d.w / 2, hd = d.d / 2;
      for (const [x, z] of pts) {
        if (x > hw) out.push({ px: x, pz: z, nx: -1, nz: 0, depth: x - hw });
        if (x < -hw) out.push({ px: x, pz: z, nx: 1, nz: 0, depth: -hw - x });
        if (z > hd) out.push({ px: x, pz: z, nx: 0, nz: -1, depth: z - hd });
        if (z < -hd) out.push({ px: x, pz: z, nx: 0, nz: 1, depth: -hd - z });
      }
    }
    const cr = Math.hypot(car.spec.L, car.spec.W) / 2;
    for (const o of this.obstacles) {
      if (o.t === 'cyl') {
        const dx = car.x - o.x, dz = car.z - o.z;
        if (dx * dx + dz * dz > (cr + o.r) ** 2) continue;
        const c = closestOnCar(car, o.x, o.z);
        let nx = c.wx - o.x, nz = c.wz - o.z; let dist = Math.hypot(nx, nz);
        if (c.inside || dist < 1e-4) { nx = dx; nz = dz; dist = Math.hypot(nx, nz) || 1; out.push({ px: c.wx, pz: c.wz, nx: nx / dist, nz: nz / dist, depth: o.r }); continue; }
        if (dist < o.r) out.push({ px: c.wx, pz: c.wz, nx: nx / dist, nz: nz / dist, depth: o.r - dist });
      } else {
        const ext = Math.hypot(o.w, o.d) / 2;
        const dx = car.x - o.x, dz = car.z - o.z;
        if (dx * dx + dz * dz > (cr + ext) ** 2) continue;
        const c = satQuads(o.pts, pts, [o.x, o.z], [car.x, car.z], o.axes, [[Math.cos(car.h), -Math.sin(car.h)], [Math.sin(car.h), Math.cos(car.h)]]);
        if (c) out.push({ px: c.px, pz: c.pz, nx: c.nx, nz: c.nz, depth: c.depth });
      }
    }
    return out;
  }

  // returns fraction t of first blocking hit along segment, or null
  segBlocked(x0, z0, x1, z1) {
    let best = null;
    for (const o of this.obstacles) {
      const t = o.t === 'cyl' ? segVsCircle(x0, z0, x1, z1, o.x, o.z, o.r) : segVsBox(x0, z0, x1, z1, o.x, o.z, o.w, o.d, o.rot);
      if (t !== null && (best === null || t < best)) best = t;
    }
    // boundary
    const d = this.def;
    if (d.shape === 'circle') {
      const r1 = Math.hypot(x1, z1);
      if (r1 > d.radius + 0.5) {
        // find t where radius crosses
        const dx = x1 - x0, dz = z1 - z0, a = dx * dx + dz * dz, b = 2 * (x0 * dx + z0 * dz), c = x0 * x0 + z0 * z0 - (d.radius + 0.5) ** 2;
        const disc = b * b - 4 * a * c; if (disc >= 0) { const t = (-b + Math.sqrt(disc)) / (2 * a); if (t >= 0 && t <= 1 && (best === null || t < best)) best = t; }
      }
    } else {
      const hw = d.w / 2 + 0.5, hd = d.d / 2 + 0.5;
      const tt = [];
      if (x1 > hw && x0 <= hw) tt.push((hw - x0) / (x1 - x0)); if (x1 < -hw && x0 >= -hw) tt.push((-hw - x0) / (x1 - x0));
      if (z1 > hd && z0 <= hd) tt.push((hd - z0) / (z1 - z0)); if (z1 < -hd && z0 >= -hd) tt.push((-hd - z0) / (z1 - z0));
      for (const t of tt) if (best === null || t < best) best = t;
    }
    return best;
  }

  inside(x, z, margin = 0) {
    const d = this.def;
    if (d.shape === 'circle') { if (Math.hypot(x, z) > d.radius - margin) return false; }
    else if (Math.abs(x) > d.w / 2 - margin || Math.abs(z) > d.d / 2 - margin) return false;
    for (const o of this.obstacles) {
      if (o.t === 'cyl') { if (Math.hypot(x - o.x, z - o.z) < o.r + margin) return false; }
      else { const sn = Math.sin(o.rot), cs = Math.cos(o.rot), dx = x - o.x, dz = z - o.z; const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; if (Math.abs(lx) < o.w / 2 + margin && Math.abs(lz) < o.d / 2 + margin) return false; }
    }
    return true;
  }

  spawnPoints(n) {
    const d = this.def; const pts = [];
    const R = d.shape === 'circle' ? d.radius * 0.78 : null;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.PI / 2;
      let x, z;
      if (R) { x = Math.cos(a) * R; z = Math.sin(a) * R; }
      else { const k = Math.max(Math.abs(Math.cos(a)) / (d.w / 2 * 0.8), Math.abs(Math.sin(a)) / (d.d / 2 * 0.8)); x = Math.cos(a) / k; z = Math.sin(a) / k; }
      // nudge out of obstacles
      let tries = 0; while (!this.inside(x, z, 5) && tries++ < 30) { x *= 0.95; z *= 0.95; }
      pts.push({ x, z, h: Math.atan2(-x, -z) }); // face centre
    }
    return pts;
  }

  randomPoint(margin = 6, rng = Math.random) {
    const d = this.def;
    for (let i = 0; i < 60; i++) {
      let x, z;
      if (d.shape === 'circle') { const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (d.radius - margin); x = Math.cos(a) * r; z = Math.sin(a) * r; }
      else { x = (rng() - 0.5) * (d.w - margin * 2); z = (rng() - 0.5) * (d.d - margin * 2); }
      if (this.inside(x, z, margin)) return { x, z };
    }
    return { x: 0, z: d.shape === 'circle' ? d.radius * 0.5 : d.d * 0.3 };
  }
}
