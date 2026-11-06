// Garage: vehicle designer UI + 3D preview scene.
import * as THREE from 'three';
import {
  BODIES, MOTORS, BATTERIES, TIRES, BRAKES, SUSPENSIONS, ARMORS, COMPUTERS, WEAPONS, ACCESSORIES,
  LOCATIONS, LOC_LABEL, PAINTS, DRIVER_PERKS, DIVISIONS,
} from './data.js';
import { computeStats, validate, mountsUsed, ammoCap, TURRET_COST, blankDesign, cloneDesign } from './design.js';
import { buildCar, disposeCar } from './carmodel.js';
import { glowTex, additive } from './gfx.js';

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const kg = (n) => Math.round(n).toLocaleString('en-US') + ' kg';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TABS = [
  ['body', 'Body'], ['power', 'Power'], ['chassis', 'Chassis'], ['armor', 'Armor'],
  ['weapons', 'Weapons'], ['gear', 'Gear'], ['crew', 'Crew'],
];

export class Garage {
  constructor(game, root) {
    this.game = game; this.root = root;
    this.tab = 'body'; this.weaponLoc = 'front';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    this.angle = 0.6; this.dragging = false;
    this.setupScene();
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => this.onInput(e));
    root.addEventListener('change', (e) => this.onInput(e, true));
  }

  setupScene() {
    const s = this.scene;
    s.background = new THREE.Color(0x0d0420);
    s.add(new THREE.HemisphereLight(0xff88dd, 0x220044, 1.3));
    const d = new THREE.DirectionalLight(0xfff0e0, 2.4); d.position.set(4, 8, 5); s.add(d);
    const r = new THREE.DirectionalLight(0x33f0ff, 1.4); r.position.set(-6, 3, -4); s.add(r);
    // turntable
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.16, 64), new THREE.MeshStandardMaterial({ color: 0x1a0f2e, metalness: 0.8, roughness: 0.25 }));
    disk.position.y = -0.08; s.add(disk);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.04, 8, 96), new THREE.MeshBasicMaterial({ color: 0xff2ad4 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; s.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.02, 8, 96), new THREE.MeshBasicMaterial({ color: 0x33f0ff })); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.01; s.add(ring2);
    const grid = new THREE.GridHelper(80, 40, 0xff2ad4, 0x5a1a8a); grid.position.y = -0.2; grid.material.transparent = true; grid.material.opacity = 0.45; s.add(grid);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), additive(0x7a2cff, 0.35, glowTex())); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02; s.add(glow);
    // sun backdrop
    const sunC = document.createElement('canvas'); sunC.width = sunC.height = 256; const g = sunC.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, '#ffe14a'); grd.addColorStop(0.55, '#ff7a1a'); grd.addColorStop(1, '#ff2a8a');
    g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) { const y = 140 + i * 17; g.fillRect(0, y, 256, 3 + i * 1.3); }
    const sunT = new THREE.CanvasTexture(sunC); sunT.colorSpace = THREE.SRGBColorSpace;
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({ map: sunT, transparent: true, fog: false }));
    sun.position.set(0, 3, -40); s.add(sun); this.sun = sun;
    s.fog = new THREE.Fog(0x0d0420, 25, 70);
    this.carHolder = new THREE.Group(); s.add(this.carHolder);
  }

  open(design) {
    this.design = design;
    this.render();
    this.rebuildCar();
  }

  rebuildCar() {
    if (this.car) { this.carHolder.remove(this.car.root); disposeCar(this.car); }
    this.car = buildCar(this.design);
    this.carHolder.add(this.car.root);
    if (this.car.turret) this.car.turret.rotation.y = 0.5;
  }

  changed(rebuild = true) {
    this.render();
    if (rebuild) { clearTimeout(this._rb); this._rb = setTimeout(() => this.rebuildCar(), 60); }
    this.game.saveDesign(this.design, true);
  }

  update(dt) {
    if (!this.dragging) this.angle += dt * 0.35;
    this.carHolder.rotation.y = this.angle;
    if (this.car?.turret) this.car.turret.rotation.y = Math.sin(performance.now() / 1500) * 0.8;
    const L = BODIES[this.design.body].L;
    const dist = 6 + L * 1.2;
    this.camera.position.set(0, 2.6 + L * 0.35, dist);
    this.camera.lookAt(0, 0.6, 0);
  }

  // ---------- rendering ----------
  render(skipPanel = false) {
    const d = this.design, st = computeStats(d), val = validate(d, st);
    this.stats = st;
    const div = st.division;
    const r = this.root;
    if (!r.querySelector('.g-wrap')) {
      r.innerHTML = `
        <div class="g-wrap">
          <div class="g-left">
            <div class="g-head">
              <select id="g-list" class="g-list"></select>
              <button class="btn sm" data-act="new">+ New</button>
              <button class="btn sm" data-act="dup">Copy</button>
              <button class="btn sm danger" data-act="del">Del</button>
            </div>
            <div class="g-view" id="g-view"><div class="g-badge" id="g-badge"></div></div>
            <div class="g-namebar"><input id="g-name" maxlength="22" spellcheck="false" /><div class="g-cost" id="g-cost"></div></div>
          </div>
          <div class="g-right">
            <div class="g-tabs" id="g-tabs"></div>
            <div class="g-panel" id="g-panel"></div>
          </div>
          <div class="g-bottom">
            <div class="g-stats" id="g-stats"></div>
            <div class="g-actions">
              <button class="btn ghost" data-act="back">◀ Menu</button>
              <button class="btn hot" data-act="battle">Quick Battle ▶</button>
            </div>
          </div>
        </div>`;
      const view = r.querySelector('#g-view');
      let lx = 0;
      const down = (x) => { this.dragging = true; lx = x; };
      const move = (x) => { if (this.dragging) { this.angle += (x - lx) * 0.01; lx = x; } };
      view.addEventListener('pointerdown', (e) => { down(e.clientX); view.setPointerCapture(e.pointerId); });
      view.addEventListener('pointermove', (e) => move(e.clientX));
      view.addEventListener('pointerup', () => this.dragging = false);
      view.addEventListener('pointercancel', () => this.dragging = false);
    }
    // design list
    const list = r.querySelector('#g-list');
    list.innerHTML = this.game.designs.map(x => `<option value="${x.id}" ${x.id === d.id ? 'selected' : ''}>${esc(x.name)}${x.preset ? ' ★' : ''}</option>`).join('');
    const nameEl = r.querySelector('#g-name'); if (document.activeElement !== nameEl) nameEl.value = d.name;
    r.querySelector('#g-cost').innerHTML = `<b>${money(st.cost)}</b>`;
    r.querySelector('#g-badge').innerHTML = `<span style="color:${div.color};border-color:${div.color}">${div.name}</span><small>${BODIES[d.body].cls}</small>`;
    r.querySelector('#g-tabs').innerHTML = TABS.map(([k, n]) => `<button class="tab ${this.tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('');
    if (!skipPanel) r.querySelector('#g-panel').innerHTML = this['tab_' + this.tab](d, st);
    // stats
    const massF = st.mass / st.maxGross, spF = st.space / st.maxSpace;
    const bar = (f, label, txt) => `<div class="sbar ${f > 1 ? 'over' : ''}"><div class="sl">${label}<span>${txt}</span></div><div class="st"><i style="width:${Math.min(100, f * 100)}%"></i></div></div>`;
    r.querySelector('#g-stats').innerHTML = `
      ${bar(massF, 'Weight', `${kg(st.mass)} / ${kg(st.maxGross)}`)}
      ${bar(spF, 'Space', `${st.space} / ${st.maxSpace} SP`)}
      <div class="nums">
        <span><b>${Math.round(st.kmh)}</b> km/h</span>
        <span><b>${st.accel > 30 ? '—' : st.accel.toFixed(1)}s</b> 0-100</span>
        <span><b>${st.handling.toFixed(2)}</b> handling</span>
        <span><b>${st.ap}</b> armor</span>
        <span><b>${st.dps.toFixed(0)}</b> dps</span>
        <span class="${st.heatRate > st.dissipation ? 'warn' : ''}"><b>${st.heatRate.toFixed(1)}/${st.dissipation.toFixed(1)}</b> heat</span>
      </div>
      <div class="msgs">${val.errs.map(e => `<div class="err">✖ ${esc(e)}</div>`).join('')}${val.warns.map(e => `<div class="warn">▲ ${esc(e)}</div>`).join('')}${val.ok && !val.warns.length ? '<div class="ok">✔ Street legal (sort of)</div>' : ''}</div>`;
    r.querySelector('[data-act="battle"]').disabled = !val.ok;
    this.valid = val.ok;
  }

  card(group, key, sel, title, lines, price, extra = '') {
    return `<button class="card ${sel ? 'sel' : ''}" data-set="${group}" data-val="${key}">
      <div class="ct">${title}</div><div class="cl">${lines}</div><div class="cp">${price}</div>${extra}</button>`;
  }

  tab_body(d) {
    return `<p class="hint">Pick a chassis. Bigger bodies carry more armor and guns but handle like furniture.</p><div class="cards">` +
      Object.values(BODIES).map(B => this.card('body', B.id, d.body === B.id, `${B.name} <small>${B.cls}</small>`,
        `${B.desc}<br>Max ${kg(B.maxGross)} · ${B.space} SP · ${B.armorMax} AP/side · Mounts F${B.mounts.front} B${B.mounts.back} L${B.mounts.left} R${B.mounts.right} T${B.mounts.top} U${B.mounts.bottom}`,
        money(B.cost))).join('') + '</div>';
  }

  tab_power(d) {
    return `<h4>Electric Motor</h4><div class="cards">` +
      Object.values(MOTORS).map(M => this.card('motor', M.id, d.motor === M.id, M.name, `${M.kW} kW · ${kg(M.mass)} · ${M.space} SP · heat ×${M.heat}`, money(M.cost))).join('') +
      `</div><h4>Battery Pack</h4><p class="hint">Drained by driving, boosting and energy weapons. Empty = crawl.</p><div class="cards">` +
      Object.values(BATTERIES).map(B => this.card('battery', B.id, d.battery === B.id, B.name, `${B.kWh} kWh · ${kg(B.mass)} · ${B.space} SP · ${B.dp} DP`, money(B.cost))).join('') + '</div>';
  }

  tab_chassis(d) {
    return `<h4>Tires</h4><div class="cards">` +
      Object.values(TIRES).map(T => this.card('tires', T.id, d.tires === T.id, T.name, `${T.desc}<br>Grip ${T.grip} · ${T.dp} DP each`, money(T.cost * 4))).join('') +
      `</div><h4>Brakes</h4><div class="cards">` +
      Object.values(BRAKES).map(B => this.card('brakes', B.id, d.brakes === B.id, B.name, `Force ×${B.force}${B.abs ? ' · ABS (no lock-ups)' : ''}`, B.cost ? money(B.cost) : 'Stock')).join('') +
      `</div><h4>Suspension</h4><div class="cards">` +
      Object.values(SUSPENSIONS).map(S => this.card('suspension', S.id, d.suspension === S.id, S.name, `Handling ×${S.handling} · Load ×${S.loadMul}`, S.cost ? money(S.cost) : 'Stock')).join('') + '</div>';
  }

  tab_armor(d) {
    const B = BODIES[d.body], A = ARMORS[d.armorType];
    const rows = LOCATIONS.map(l => `
      <div class="arow"><label>${LOC_LABEL[l]}</label>
        <button class="btn xs" data-arm="${l}" data-d="-5">−</button>
        <input type="range" min="0" max="${B.armorMax}" step="1" value="${d.armor[l]}" data-armr="${l}" />
        <button class="btn xs" data-arm="${l}" data-d="5">+</button>
        <span class="av">${d.armor[l]}</span></div>`).join('');
    return `<h4>Armor Type</h4><div class="cards">` +
      Object.values(ARMORS).map(X => this.card('armorType', X.id, d.armorType === X.id, X.name,
        `${(X.massPerAP * B.armorWeightMul).toFixed(1)} kg/AP · ${money(X.costPerAP)}/AP<br>vs bullets ×${X.resist.ballistic} · blast ×${X.resist.explosive} · laser ×${X.resist.energy} · fire ×${X.resist.fire} · ram ×${X.resist.ram}`, '')).join('') +
      `</div><h4>Plating per side <small>(max ${B.armorMax})</small></h4>${rows}
      <div class="row"><button class="btn sm" data-act="armfill">Auto-fill to budget</button><button class="btn sm ghost" data-act="armclear">Strip</button></div>
      <p class="hint">Once a side is breached, hits go straight to the guts: weapons, motor, battery, crew and tires on that side.</p>`;
  }

  tab_weapons(d) {
    const B = BODIES[d.body], used = mountsUsed(d);
    const L = this.weaponLoc;
    const locBtn = (l) => `<button class="locb ${L === l ? 'on' : ''} ${B.mounts[l] === 0 ? 'na' : ''}" data-loc="${l}">${LOC_LABEL[l]}<small>${used[l]}/${B.mounts[l]}</small></button>`;
    const fitted = d.weapons.map((w, i) => {
      const W = WEAPONS[w.w]; const cap = ammoCap(d, w);
      const ammo = isFinite(W.maxAmmo) && W.maxAmmo ? `<span class="am"><button class="btn xs" data-ammo="${i}" data-d="-1">−</button>${w.ammo}<small>/${cap}</small><button class="btn xs" data-ammo="${i}" data-d="1">+</button></span>` : `<span class="am">${W.type === 'beam' ? '⚡ battery' : '—'}</span>`;
      return `<div class="fit"><span class="fl">${LOC_LABEL[w.loc]}</span><b>${W.name}</b>${ammo}<button class="btn xs danger" data-rmw="${i}">✕</button></div>`;
    }).join('') || '<p class="hint">Nothing fitted yet. Pick a side, then add hardware.</p>';
    const avail = Object.values(WEAPONS).filter(W => W.allowed.includes(L));
    const full = used[L] >= B.mounts[L];
    const items = avail.map(W => {
      const dmg = W.type === 'passive' ? 'Ram ×1.8' : W.dmg[1] ? `${W.dmg[0]}-${W.dmg[1]} dmg` : 'utility';
      const rate = W.rof ? ` · ${W.rof}/s` : '';
      const rng = W.range ? ` · ${W.range}m` : '';
      const ammo = isFinite(W.maxAmmo) && W.maxAmmo ? ` · ${W.ammo} rds (${money(W.ammoCost)}/rd)` : W.energy ? ` · ${W.energy} kWh/shot` : '';
      const turret = L === 'top' ? ` +turret ${money(TURRET_COST)}` : '';
      return `<button class="card wcard" data-addw="${W.id}" ${full ? 'disabled' : ''}>
        <div class="ct">${W.name} <small class="dt ${W.dtype}">${W.dtype}</small></div>
        <div class="cl">${W.desc}<br>${dmg}${rate}${rng}${ammo}<br>${kg(W.mass)} · ${W.space} SP · heat ${W.heat}/shot</div>
        <div class="cp">${money(W.cost)}${turret}</div></button>`;
    }).join('');
    return `<div class="locs">${LOCATIONS.map(locBtn).join('')}</div>
      <h4>Fitted</h4><div class="fits">${fitted}</div>
      <h4>Add to ${LOC_LABEL[L]} ${full ? '<small class="warn">(mounts full)</small>' : ''}</h4>
      ${L === 'top' ? '<p class="hint">Top weapons sit in a 360° turret. With a gunner aboard it aims & fires itself.</p>' : ''}
      ${L === 'bottom' || L === 'back' ? '<p class="hint">Droppers lay mines, oil, spikes or smoke behind you.</p>' : ''}
      <div class="cards">${items || '<p class="hint">No hardware fits here.</p>'}</div>`;
  }

  tab_gear(d) {
    const acc = d.accessories;
    return `<h4>Targeting Computer</h4><div class="cards">` +
      Object.values(COMPUTERS).map(C => this.card('computer', C.id, d.computer === C.id, C.name,
        C.id === 'none' ? 'Point and pray.' : `Spread ×${C.spreadMul} · Aim-assist ${C.assist}° · Missile lock ${C.lockTime}s`, C.cost ? money(C.cost) : 'Free')).join('') +
      `</div><h4>Accessories</h4><div class="cards">` +
      Object.values(ACCESSORIES).map(X => {
        const n = acc[X.id] || 0;
        return `<div class="card acc ${n ? 'sel' : ''}"><div class="ct">${X.name} ${X.max > 1 ? `<small>×${n}/${X.max}</small>` : ''}</div>
          <div class="cl">${X.desc}<br>${kg(X.mass)} · ${X.space} SP</div>
          <div class="cp">${money(X.cost)} <span class="accb"><button class="btn xs" data-acc="${X.id}" data-d="-1" ${n ? '' : 'disabled'}>−</button><button class="btn xs" data-acc="${X.id}" data-d="1" ${n >= X.max ? 'disabled' : ''}>+</button></span></div></div>`;
      }).join('') + '</div>';
  }

  tab_crew(d) {
    const B = BODIES[d.body];
    return `<h4>Driver</h4>
      <div class="row"><label class="lbl">Callsign</label><input id="g-driver" maxlength="16" value="${esc(d.driver?.name || 'You')}" /></div>
      <div class="cards">${Object.values(DRIVER_PERKS).map(P => this.card('perk', P.id, d.driver?.perk === P.id, P.name, P.desc, '')).join('')}</div>
      <h4>Gunner</h4>
      <div class="cards">
        ${this.card('gunner', 'no', !d.gunner, 'Solo Driver', 'You fire everything yourself. Saves 85 kg & 2 SP.', '')}
        ${this.card('gunner', 'yes', d.gunner, 'Bring a Gunner', B.mounts.top ? 'Auto-aims & fires turret and side weapons. Takes over if the driver goes down.' : 'Extra crew & backup driver. (This body has no turret.)', '')}
      </div>
      <h4>Paint Job</h4>
      <div class="paints">${PAINTS.map(p => `<button class="paint ${d.paint === p.id ? 'sel' : ''}" data-set="paint" data-val="${p.id}" title="${p.name}" style="background:linear-gradient(135deg, #${p.body.toString(16).padStart(6, '0')} 60%, #${p.trim.toString(16).padStart(6, '0')} 60%)"></button>`).join('')}</div>`;
  }

  // ---------- events ----------
  onClick(e) {
    const t = e.target.closest('button, [data-tab]'); if (!t) return;
    let d = this.design; const a = this.game.audio;
    if (t.dataset.tab) { this.tab = t.dataset.tab; a.sfx('ui_click'); this.render(); return; }
    if (t.dataset.loc) { this.weaponLoc = t.dataset.loc; a.sfx('ui_click'); this.render(); return; }
    if (d.preset && (t.dataset.set || t.dataset.addw || t.dataset.rmw !== undefined || t.dataset.ammo !== undefined || t.dataset.acc || t.dataset.arm || t.dataset.act?.startsWith('arm'))) {
      d = this.forkPreset();
    }
    if (t.dataset.set) {
      const k = t.dataset.set, v = t.dataset.val;
      if (k === 'perk') d.driver = { ...(d.driver || {}), perk: v };
      else if (k === 'gunner') d.gunner = v === 'yes';
      else {
        d[k] = v;
        if (k === 'body') {
          const B = BODIES[v];
          for (const l of LOCATIONS) d.armor[l] = Math.min(d.armor[l], B.armorMax);
          // drop weapons that no longer fit mounts
          const used = {}; d.weapons = d.weapons.filter(w => { used[w.loc] = (used[w.loc] || 0) + 1; return used[w.loc] <= B.mounts[w.loc]; });
        }
      }
      a.sfx('ui_select'); this.changed(); return;
    }
    if (t.dataset.addw) {
      const W = WEAPONS[t.dataset.addw];
      if (W.id === 'ram' && d.weapons.some(w => w.w === 'ram' && w.loc === this.weaponLoc)) { a.sfx('ui_error'); return; }
      d.weapons.push({ w: W.id, loc: this.weaponLoc, ammo: isFinite(W.ammo) ? W.ammo : 0 });
      a.sfx('buy'); this.changed(); return;
    }
    if (t.dataset.rmw !== undefined) { d.weapons.splice(+t.dataset.rmw, 1); a.sfx('ui_click'); this.changed(); return; }
    if (t.dataset.ammo !== undefined) {
      const w = d.weapons[+t.dataset.ammo], W = WEAPONS[w.w];
      const step = Math.max(1, Math.round(W.ammo / 4)) * +t.dataset.d;
      w.ammo = Math.max(0, Math.min(ammoCap(d, w), w.ammo + step));
      a.sfx('ui_click'); this.changed(false); return;
    }
    if (t.dataset.acc) {
      const X = ACCESSORIES[t.dataset.acc]; const n = (d.accessories[X.id] || 0) + +t.dataset.d;
      if (n <= 0) delete d.accessories[X.id]; else d.accessories[X.id] = Math.min(X.max, n);
      for (const w of d.weapons) w.ammo = Math.min(w.ammo, ammoCap(d, w));
      a.sfx(+t.dataset.d > 0 ? 'buy' : 'ui_click'); this.changed(X.id === 'spoiler'); return;
    }
    if (t.dataset.arm) {
      const B = BODIES[d.body]; const l = t.dataset.arm;
      d.armor[l] = Math.max(0, Math.min(B.armorMax, d.armor[l] + +t.dataset.d)); a.sfx('ui_click'); this.changed(); return;
    }
    switch (t.dataset.act) {
      case 'armfill': this.autoArmor(); a.sfx('buy'); this.changed(); break;
      case 'armclear': for (const l of LOCATIONS) d.armor[l] = 0; a.sfx('ui_click'); this.changed(); break;
      case 'new': { const nd = blankDesign('sedan'); nd.weapons = [{ w: 'mg', loc: 'front', ammo: 200 }]; nd.name = 'Custom ' + (this.game.designs.length + 1); this.game.designs.push(nd); this.game.currentId = nd.id; this.open(nd); this.game.saveDesign(nd); a.sfx('ui_select'); break; }
      case 'dup': { const c = cloneDesign(d); delete c.preset; c.name = d.name.slice(0, 18) + ' II'; this.game.designs.push(c); this.game.currentId = c.id; this.open(c); this.game.saveDesign(c); a.sfx('ui_select'); break; }
      case 'del': {
        if (d.preset) { this.game.toast('Factory cars can\'t be scrapped.'); a.sfx('ui_error'); break; }
        // two-tap confirm (native confirm() dialogs are blocked in sandboxed frames)
        const now = performance.now();
        if (this._delArm !== d.id || now - this._delT > 3000) {
          this._delArm = d.id; this._delT = now;
          t.textContent = 'Sure?'; this.game.toast(`Tap Del again to scrap "${d.name}"`); a.sfx('ui_error');
          setTimeout(() => { if (t.isConnected) t.textContent = 'Del'; }, 3000);
          break;
        }
        this._delArm = null;
        this.game.deleteDesign(d.id); this.open(this.game.currentDesign()); a.sfx('explosion_small'); break;
      }
      case 'back': a.sfx('ui_click'); this.game.show('title'); break;
      case 'battle': if (this.valid) { a.sfx('ui_select'); this.game.show('setup'); } else a.sfx('ui_error'); break;
    }
  }

  onInput(e, commit) {
    const t = e.target, d = this.design;
    if (t.id === 'g-list' && commit) { this.game.currentId = t.value; this.open(this.game.currentDesign()); this.game.audio.sfx('ui_click'); return; }
    if (t.id === 'g-name' || t.id === 'g-driver') {
      const forked = d.preset; const dd = forked ? this.forkPreset() : d;
      if (t.id === 'g-name') dd.name = t.value.trim() || 'Nameless';
      else dd.driver = { ...(dd.driver || {}), name: t.value.trim() || 'You' };
      this.game.saveDesign(dd, true);
      if (commit || forked) this.render(true);
      else if (t.id === 'g-name') this.root.querySelector('#g-list').selectedOptions[0].textContent = dd.name;
      return;
    }
    if (t.dataset.armr) {
      const dd = d.preset ? this.forkPreset() : d;
      dd.armor[t.dataset.armr] = +t.value;
      if (commit) this.changed(); else { const av = t.parentElement.querySelector('.av'); if (av) av.textContent = t.value; this.render(true); }
    }
  }

  forkPreset() {
    const c = cloneDesign(this.design); delete c.preset; c.name = this.design.name.slice(0, 17) + ' Mk2';
    this.game.designs.push(c); this.design = c; this.game.currentId = c.id;
    this.game.toast('Factory car copied — edit away!');
    return c;
  }

  autoArmor() {
    const d = this.design, B = BODIES[d.body];
    const w = { front: 2.5, back: 1.8, left: 2, right: 2, top: 1, bottom: 0.8 };
    for (const l of LOCATIONS) d.armor[l] = 0;
    const div = DIVISIONS.find(x => computeStats(d).cost <= x.max) || DIVISIONS[DIVISIONS.length - 1];
    const cap = isFinite(div.max) ? div.max : Infinity;
    for (let g = 0; g < 800; g++) {
      let best = null, br = Infinity;
      for (const l of LOCATIONS) { if (d.armor[l] >= B.armorMax) continue; const r = d.armor[l] / w[l]; if (r < br) { br = r; best = l; } }
      if (!best) break;
      d.armor[best] += 1;
      const st = computeStats(d);
      if (!validate(d, st).ok || st.cost > cap) { d.armor[best] -= 1; break; }
    }
  }
}
