// In-battle HUD (DOM overlay).
import * as THREE from 'three';
import { LOCATIONS, LOC_SHORT, TEAM_NAMES } from './data.js';

const $ = (s, r = document) => r.querySelector(s);
const colFor = (f) => f <= 0 ? '#5a1020' : f < 0.25 ? '#ff2a4a' : f < 0.5 ? '#ff9a2a' : f < 0.75 ? '#ffe14a' : '#3cff9a';
const hex = (c) => '#' + new THREE.Color(c).getHexString();
const GROUP_KEYS = { front: 'SPACE', top: 'F', left: 'Q', right: 'E', back: 'R', bottom: 'R' };

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="h-top">
        <div class="h-timer" id="h-timer">0:00</div>
        <div class="h-mode" id="h-mode"></div>
      </div>
      <div class="h-feed" id="h-feed"></div>
      <div class="h-panel h-car">
        <div class="h-name" id="h-name"></div>
        <div class="dmg">
          <div class="tire t0"></div><div class="tire t1"></div><div class="tire t2"></div><div class="tire t3"></div>
          <div class="cell c-front" data-l="front"></div>
          <div class="cell c-left" data-l="left"></div>
          <div class="cell c-top" data-l="top"></div>
          <div class="cell c-right" data-l="right"></div>
          <div class="cell c-back" data-l="back"></div>
        </div>
        <div class="h-row"><span class="lbl">UNDER</span><span id="h-under"></span><span class="lbl">STRUCT</span><span id="h-struct"></span></div>
        <div class="h-crew" id="h-crew"></div>
      </div>
      <div class="h-panel h-gauges">
        <div class="h-speed"><span id="h-speed">0</span><small>KM/H</small></div>
        <div class="bar heat"><i id="h-heat"></i><b>HEAT</b></div>
        <div class="bar energy"><i id="h-energy"></i><b>BATT</b></div>
        <div class="h-status" id="h-status"></div>
      </div>
      <div class="h-panel h-weapons" id="h-weapons"></div>
      <div class="h-target" id="h-target"></div>
      <div class="reticle" id="reticle"><span></span></div>
      <div class="arrows" id="h-arrows"></div>
      <canvas class="radar" id="radar" width="160" height="160"></canvas>
      <div class="h-alerts" id="h-alerts"></div>
      <div class="h-count" id="h-count"></div>
      <div class="h-hitdir" id="h-hitdir"></div>
      <div class="h-killflash" id="h-killflash">WRECKED 'EM!</div>
      <div class="h-hitmark" id="h-hitmark">✕</div>
      <button class="h-pause" id="h-pause" aria-label="Pause">❚❚</button>
    `;
    this.el = {};
    for (const id of ['h-timer', 'h-mode', 'h-feed', 'h-name', 'h-under', 'h-struct', 'h-crew', 'h-speed', 'h-heat', 'h-energy', 'h-status', 'h-weapons', 'h-target', 'reticle', 'h-arrows', 'radar', 'h-alerts', 'h-count', 'h-hitdir', 'h-killflash', 'h-hitmark', 'h-pause']) this.el[id] = $('#' + id, root);
    this.cells = {}; root.querySelectorAll('.cell').forEach(c => this.cells[c.dataset.l] = c);
    this.tires = [...root.querySelectorAll('.tire')];
    this.ctx = this.el['radar'].getContext('2d');
    this.slowT = 0; this.alertList = []; this.arrowEls = [];
    this.v3 = new THREE.Vector3();
  }

  reset(battle) {
    this.b = battle;
    this.el['h-feed'].innerHTML = ''; this.el['h-alerts'].innerHTML = ''; this.feedN = 0;
    this.el['h-mode'].textContent = (battle.teams ? `${battle.cfg.teamSize} vs ${battle.cfg.teamSize}` : 'FREE-FOR-ALL') + ' · ' + battle.division.short;
    this.weaponSig = '';
  }

  update(dt, w, h) {
    const b = this.b, P = b.player, el = this.el;
    // countdown
    if (!b.started) { const n = Math.ceil(b.countdown); el['h-count'].textContent = n > 3 ? '' : n; el['h-count'].className = 'h-count show'; }
    else if (b.time < 4.6) { el['h-count'].textContent = 'WRECK \'EM!'; el['h-count'].className = 'h-count show go'; }
    else el['h-count'].className = 'h-count';

    this.slowT -= dt;
    if (this.slowT <= 0) { this.slowT = 0.08; this.slow(); }

    // reticle / target bracket
    const t = P.target, cam = b.camera;
    if (t && !t.out && !P.out) {
      this.v3.set(t.x, 1.2, t.z).project(cam);
      const sx = (this.v3.x * 0.5 + 0.5) * w, sy = (-this.v3.y * 0.5 + 0.5) * h;
      const on = this.v3.z < 1 && sx > -50 && sx < w + 50 && sy > -50 && sy < h + 50;
      el['reticle'].style.display = on ? 'block' : 'none';
      el['reticle'].style.transform = `translate(${sx}px, ${sy}px)`;
      const locked = P.weapons.some(x => x.locked && x.lockTarget === t);
      el['reticle'].classList.toggle('locked', locked);
    } else el['reticle'].style.display = 'none';

    // offscreen arrows
    const enemies = b.vehicles.filter(v => v !== P && !v.out);
    while (this.arrowEls.length < enemies.length) { const a = document.createElement('div'); a.className = 'arrow'; el['h-arrows'].appendChild(a); this.arrowEls.push(a); }
    this.arrowEls.forEach((a, i) => {
      const v = enemies[i]; if (!v) { a.style.display = 'none'; return; }
      this.v3.set(v.x, 1, v.z).project(cam);
      let sx = this.v3.x, sy = -this.v3.y;
      const behind = this.v3.z > 1;
      if (behind) { sx = -sx; sy = -sy; }
      if (!behind && Math.abs(sx) < 0.95 && Math.abs(sy) < 0.95) { a.style.display = 'none'; return; }
      const m = Math.max(Math.abs(sx), Math.abs(sy)) || 1; sx /= m; sy /= m;
      const px = (sx * 0.5 + 0.5) * (w - 40) + 20, py = (sy * 0.5 + 0.5) * (h - 40) + 20;
      const ang = Math.atan2(sy, sx);
      a.style.display = 'block';
      const friend = b.teams && v.team === P.team;
      a.style.borderLeftColor = friend ? '#3cff9a' : hex(v.color);
      a.style.transform = `translate(${px}px, ${py}px) rotate(${ang}rad)`;
      a.style.opacity = friend ? 0.5 : 1;
    });

    // hit direction
    if (b.hitDirT > 0) {
      b.hitDirT -= dt;
      const rel = b.hitDir - b.camYaw; // world angle relative to camera
      el['h-hitdir'].style.opacity = Math.min(1, b.hitDirT * 2);
      el['h-hitdir'].style.transform = `translate(-50%, -50%) rotate(${-rel}rad)`;
    } else el['h-hitdir'].style.opacity = 0;
    if (b.killFlash > 0) { b.killFlash -= dt; el['h-killflash'].classList.add('show'); } else el['h-killflash'].classList.remove('show');
    if (b.hitMarker > 0) { b.hitMarker -= dt; el['h-hitmark'].style.opacity = 1; } else el['h-hitmark'].style.opacity = 0;

    // alerts from player vehicle
    for (const a of P.alerts) this.pushAlert(a.msg, a.kind);
    P.alerts.length = 0;
    this.alertList = this.alertList.filter(a => { a.t -= dt; if (a.t <= 0) { a.el.remove(); return false; } if (a.t < 0.4) a.el.style.opacity = a.t / 0.4; return true; });
    this.radar();
  }

  pushAlert(msg, kind) {
    if (this.alertList.some(a => a.msg === msg && a.t > 1.2)) return;
    const d = document.createElement('div'); d.className = 'alert ' + kind; d.textContent = msg;
    this.el['h-alerts'].prepend(d);
    this.alertList.push({ msg, el: d, t: 2.4 });
    while (this.alertList.length > 4) { const a = this.alertList.shift(); a.el.remove(); }
  }

  slow() {
    const b = this.b, P = b.player, el = this.el;
    const tl = Math.max(0, b.timeLimit - Math.max(0, b.time - 3.6));
    el['h-timer'].textContent = `${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}`;
    el['h-timer'].classList.toggle('low', tl < 30);
    const alive = b.vehicles.filter(v => !v.out);
    if (b.teams) {
      const a0 = alive.filter(v => v.team === 0).length, a1 = alive.filter(v => v.team === 1).length;
      el['h-name'].innerHTML = `<span style="color:#33f0ff">${a0}</span> <small>vs</small> <span style="color:#ff2a8a">${a1}</span> · ${P.name}`;
    } else el['h-name'].innerHTML = `${P.name} <small>· ${alive.length} left</small>`;
    // damage cells
    for (const l of ['front', 'back', 'left', 'right', 'top']) {
      const f = P.armor[l] / P.armorMax[l];
      const c = this.cells[l];
      c.style.background = colFor(P.armorMax[l] <= 1 && P.armor[l] <= 0 ? 0 : f);
      c.textContent = Math.ceil(P.armor[l]);
      c.classList.toggle('breach', P.armor[l] <= 0);
    }
    el['h-under'].textContent = Math.ceil(P.armor.bottom);
    el['h-under'].style.color = colFor(P.armor.bottom / P.armorMax.bottom);
    el['h-struct'].textContent = `${Math.max(0, Math.ceil(P.structure))}/${P.structureMax}`;
    el['h-struct'].style.color = colFor(P.structure / P.structureMax);
    P.tires.forEach((t, i) => { this.tires[i].style.background = colFor(t / P.tireMax); this.tires[i].classList.toggle('dead', t <= 0); });
    const c = P.comps;
    const crewIcon = (cp, label) => cp ? `<span class="crew ${cp.dp <= 0 ? 'dead' : cp.dp < cp.max ? 'hurt' : ''}">${label}</span>` : '';
    el['h-crew'].innerHTML = crewIcon(c.driver, 'DRV') + crewIcon(c.gunner, 'GNR') + crewIcon(c.motor, 'MTR') + crewIcon(c.battery, 'BAT');
    // gauges
    el['h-speed'].textContent = Math.round(Math.abs(P.phys.vf) * 3.6);
    const hf = Math.min(1.5, P.heat / P.heatMax);
    el['h-heat'].style.width = Math.min(100, hf * 100) + '%';
    el['h-heat'].parentElement.classList.toggle('over', P.overheated);
    el['h-energy'].style.width = (P.energy / P.energyMax * 100) + '%';
    el['h-energy'].parentElement.classList.toggle('low', P.energy / P.energyMax < 0.2);
    const st = [];
    if (P.overheated) st.push('<b class="bad">OVERHEAT</b>');
    if (P.burning > 0) st.push('<b class="bad">FIRE</b>');
    if (P.empT > 0) st.push('<b class="bad">EMP</b>');
    if (P.oilT > 0) st.push('<b class="warn">OIL</b>');
    if (P.energy <= 0) st.push('<b class="bad">NO POWER</b>');
    if (P.input.boost) st.push('<b class="good">BOOST</b>');
    if (P.smokeHidden) st.push('<b class="warn">SMOKE</b>');
    el['h-status'].innerHTML = st.join(' ');
    // weapons
    const groups = {};
    for (const w of P.weapons) { if (w.def.type === 'passive') continue; (groups[w.loc === 'bottom' ? 'back' : w.loc] ||= []).push(w); }
    const auto = P.gunnerAlive;
    let html = '';
    for (const g of ['front', 'top', 'left', 'right', 'back']) {
      if (!groups[g]) continue;
      const key = (g === 'top' || g === 'left' || g === 'right') && auto ? 'AUTO' : (this.touch ? { front: 'FIRE', top: 'TURRET', left: 'SIDES', right: 'SIDES', back: 'REAR' }[g] : GROUP_KEYS[g]);
      html += `<div class="wg"><span class="wk">${key}</span>`;
      for (const w of groups[g]) {
        const status = w.destroyed ? 'dead' : !(w.ammo > 0) ? 'empty' : (w.def.heat > 0.5 && P.overheated) || P.empT > 0 ? 'jam' : w.cd > 0 ? 'cd' : 'ok';
        const ammo = isFinite(w.ammo) ? w.ammo : '∞';
        const lock = w.def.homing ? (w.locked ? ' <i class="lk">LOCK</i>' : '') : '';
        html += `<span class="w ${status}">${w.def.short}<em>${w.destroyed ? 'X' : ammo}</em>${lock}</span>`;
      }
      html += '</div>';
    }
    el['h-weapons'].innerHTML = html;
    // target
    const t = P.target;
    if (t && !t.out) {
      const d = Math.hypot(t.x - P.x, t.z - P.z);
      el['h-target'].style.display = 'block';
      el['h-target'].innerHTML = `<div class="tn" style="color:${hex(t.color)}">${t.name}</div><div class="td">${t.driverName} · ${t.B.cls} · ${Math.round(d)}m</div><div class="tb"><i style="width:${t.healthFrac() * 100}%"></i></div>`;
    } else el['h-target'].style.display = 'none';
    // feed
    const f = b.feed;
    if (f.length !== this.feedN) {
      for (let i = this.feedN; i < f.length; i++) {
        const e = f[i]; const d = document.createElement('div'); d.className = 'fe';
        const nm = (v) => `<span style="color:${hex(v.color)}">${v.isPlayer ? 'YOU' : v.name}</span>`;
        d.innerHTML = e.killer ? `${nm(e.killer)} <b>▶</b> ${nm(e.victim)} <small>${e.reason}</small>` : `${nm(e.victim)} <small>${e.reason}</small>`;
        this.el['h-feed'].prepend(d);
        setTimeout(() => d.remove(), 7000);
      }
      this.feedN = f.length;
    }
  }

  radar() {
    const b = this.b, P = b.focus || b.player, g = this.ctx, S = 160, R = 75, range = 110;
    g.clearRect(0, 0, S, S);
    g.save(); g.translate(S / 2, S / 2);
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fillStyle = 'rgba(20,6,40,0.55)'; g.fill();
    g.strokeStyle = 'rgba(255,42,212,0.6)'; g.lineWidth = 1.5; g.stroke();
    g.beginPath(); g.arc(0, 0, R / 2, 0, Math.PI * 2); g.strokeStyle = 'rgba(51,240,255,0.25)'; g.stroke();
    const yaw = b.camYaw, c = Math.cos(yaw), s = Math.sin(yaw);
    const toR = (x, z) => { const dx = x - P.x, dz = z - P.z; const rx = -(dx * c - dz * s), ry = -(dx * s + dz * c); return [rx / range * R, ry / range * R]; };
    for (const o of b.arena.obstacles) {
      const [x, y] = toR(o.x, o.z); if (Math.hypot(x, y) > R) continue;
      g.fillStyle = 'rgba(160,120,255,0.45)';
      const r = Math.max(2, (o.r || Math.max(o.w, o.d) / 2) / range * R); g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (const pk of b.pickups) { const [x, y] = toR(pk.x, pk.z); if (Math.hypot(x, y) > R) continue; g.fillStyle = hex(pk.color); g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    for (const v of b.vehicles) {
      let [x, y] = toR(v.x, v.z); const d = Math.hypot(x, y);
      if (d > R - 4) { x *= (R - 4) / d; y *= (R - 4) / d; }
      g.save(); g.translate(x, y); g.rotate(-(v.h - yaw));
      g.fillStyle = v.out ? '#444' : v.isPlayer ? '#fff' : (b.teams && v.team === b.player.team ? '#3cff9a' : hex(v.color));
      g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.closePath(); g.fill();
      if (v === b.player.target) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(-7, -7, 14, 14); }
      g.restore();
    }
    g.restore();
  }
}
