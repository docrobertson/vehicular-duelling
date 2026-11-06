// Shared graphics helpers: procedural textures, env map, cached materials.
import * as THREE from 'three';

const texCache = new Map();

export function radialTexture(key = 'glow', inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128, mid = null) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  if (mid) grd.addColorStop(mid[0], mid[1]);
  grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t); return t;
}

export function glowTex() { return radialTexture('glow', 'rgba(255,255,255,1)', 'rgba(255,255,255,0)', 128, [0.25, 'rgba(255,255,255,0.55)']); }
export function shadowTex() { return radialTexture('shadow', 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0)', 128, [0.55, 'rgba(0,0,0,0.5)']); }
export function smokeTex() {
  if (texCache.has('smoke')) return texCache.get('smoke');
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = s / 2 + (Math.random() - 0.5) * s * 0.35, y = s / 2 + (Math.random() - 0.5) * s * 0.35, r = s * (0.18 + Math.random() * 0.18);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  }
  const t = new THREE.CanvasTexture(c); texCache.set('smoke', t); return t;
}

// Text texture for billboards / signs
export function textTexture(lines, opts = {}) {
  const w = opts.w || 512, h = opts.h || 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, opts.bg1 || '#1a0638'); grd.addColorStop(1, opts.bg2 || '#3a0a5a');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.strokeStyle = opts.border || '#ff2ad4'; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((ln, i) => {
    const size = ln.size || (n === 1 ? 110 : 80);
    g.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`;
    const y = h / 2 + (i - (n - 1) / 2) * (h / (n + 0.6));
    const tg = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    tg.addColorStop(0, ln.c1 || '#ffe14a'); tg.addColorStop(0.5, ln.c2 || '#ff7a1a'); tg.addColorStop(1, ln.c3 || '#ff2a8a');
    g.shadowColor = ln.glow || '#ff2ad4'; g.shadowBlur = 24;
    g.fillStyle = tg; g.fillText(ln.t, w / 2, y);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Synthwave environment map so chrome & paint reflect sunset gradients.
export function makeEnvMap(renderer, sky = { top: 0x1a0638, mid: 0xb0186e, horizon: 0xff9a3c }, grid = 0xff2ad4) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(sky.top) }, mid: { value: new THREE.Color(sky.mid) }, hor: { value: new THREE.Color(sky.horizon) }, grid: { value: new THREE.Color(grid) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform vec3 top, mid, hor, grid; varying vec3 vp;
      void main(){ float y = vp.y; vec3 c;
        if (y > 0.0) { c = mix(hor*1.6, mid, smoothstep(0.0, 0.25, y)); c = mix(c, top, smoothstep(0.25, 0.9, y)); }
        else { c = vec3(0.02,0.0,0.05); float gx = abs(fract(vp.x*8.0/(abs(y)+0.05)) - 0.5); float gz = abs(fract(vp.z*8.0/(abs(y)+0.05)) - 0.5);
          c += grid * (smoothstep(0.46,0.5,gx)+smoothstep(0.46,0.5,gz)) * 0.8 * smoothstep(0.0,-0.3,y); }
        // bright stripes for crisp chrome highlights
        float band = smoothstep(0.02, 0.0, abs(y - 0.05)) * 2.0;
        c += vec3(1.0,0.8,0.6) * band;
        gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  // a couple of soft-box lights for highlights
  const box = (x, y, z, w, h, col) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); scene.add(m); };
  box(0, 40, 0, 40, 40, 0x886699);
  box(30, 12, 20, 14, 6, 0xffffff);
  box(-30, 10, -15, 10, 5, 0x66ffff);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.02);
  pm.dispose(); geo.dispose(); mat.dispose();
  return rt.texture;
}

// ---- material cache ----
const matCache = new Map();
export function mat(key, make) { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); }

export function stdMats() {
  return {
    chrome: mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xe8e8f4, metalness: 1, roughness: 0.12 })),
    dark: mat('dark', () => new THREE.MeshStandardMaterial({ color: 0x15121c, metalness: 0.4, roughness: 0.6 })),
    rubber: mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x0c0b10, metalness: 0, roughness: 0.85 })),
    gun: mat('gun', () => new THREE.MeshStandardMaterial({ color: 0x3a3848, metalness: 0.85, roughness: 0.35 })),
    armor: mat('armor', () => new THREE.MeshStandardMaterial({ color: 0x55556a, metalness: 0.75, roughness: 0.4 })),
    glass: mat('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x0a0418, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.2 })),
    head: mat('head', () => new THREE.MeshBasicMaterial({ color: 0xfff6dd })),
    tail: mat('tail', () => new THREE.MeshBasicMaterial({ color: 0xff1030 })),
    amber: mat('amber', () => new THREE.MeshBasicMaterial({ color: 0xffa020 })),
    hazard: mat('hazard', () => new THREE.MeshStandardMaterial({ color: 0xffd400, metalness: 0.2, roughness: 0.5 })),
    white: mat('white', () => new THREE.MeshStandardMaterial({ color: 0xf4f4f8, metalness: 0.2, roughness: 0.35 })),
    stripeY: mat('stripeY', () => new THREE.MeshStandardMaterial({ color: 0xffe14a, metalness: 0.3, roughness: 0.3, emissive: 0x332200 })),
    stripeO: mat('stripeO', () => new THREE.MeshStandardMaterial({ color: 0xff7a1a, metalness: 0.3, roughness: 0.3, emissive: 0x331100 })),
    stripeP: mat('stripeP', () => new THREE.MeshStandardMaterial({ color: 0xff2a8a, metalness: 0.3, roughness: 0.3, emissive: 0x330011 })),
  };
}

export function emissive(color) { return mat('emis_' + color, () => new THREE.MeshBasicMaterial({ color })); }
export function additive(color, opacity = 1, tex = null) {
  return mat(`add_${color}_${opacity}_${tex ? tex.uuid : ''}`, () => new THREE.MeshBasicMaterial({ color, map: tex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
}
