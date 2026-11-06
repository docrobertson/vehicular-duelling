// NEON WRECKERS 2086 — app shell: renderer, screens, persistence, main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Garage } from './garage.js';
import { Battle } from './battle.js';
import { presets, computeStats, validate, autoDesign } from './design.js';
import { ARENAS, DIVISIONS, PAINTS, TEAM_COLORS } from './data.js';
import { makeEnvMap } from './gfx.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const SILENT = { sfx() {}, setEngine() {}, setSkid() {}, setIntensity() {}, stopLoops() {} };

class Game {
  constructor() {
    const touch = matchMedia('(pointer: coarse)').matches;
    this.settings = Object.assign({ quality: touch ? 'medium' : 'high', music: 0.6, sfx: 0.8, shake: true, forceTouch: false }, store.get('nw86.settings', {}));
    this.career = Object.assign({ credits: 0, battles: 0, wins: 0, kills: 0 }, store.get('nw86.career', {}));
    this.audio = new AudioEngine();
    this.audio.setMusicVolume(this.settings.music); this.audio.setSfxVolume(this.settings.sfx);
    this.input = new Input();
    this.loadDesigns();
    this.setupRenderer();
    this.hud = new HUD($('#hud'));
    this.garage = new Garage(this, $('#scr-garage'));
    this.input.buildTouch($('#touch'));
    this.input.bindCanvas(this.renderer.domElement);
    this.input.onTouchMode = () => this.applyTouchMode();
    this.applyTouchMode();
    this.envCache = new Map();
    this.screen = null; this.prev = 'title';
    this.setup = Object.assign({ mode: 'ffa4', arena: 'sunset', diff: 'pro' }, store.get('nw86.setup', {}));
    this.bindUI();
    this.clock = new THREE.Clock();
    this.show('title');
    this.startDemo();
    this.loop();
    $('#loading').classList.add('gone');
  }

  // ---------- persistence ----------
  loadDesigns() {
    const saved = store.get('nw86.designs', []);
    this.designs = [...presets(), ...saved.filter(d => d && d.body && !d.preset)];
    this.currentId = store.get('nw86.current', 'preset_miami');
    if (!this.designs.find(d => d.id === this.currentId)) this.currentId = this.designs[1].id;
  }
  currentDesign() { return this.designs.find(d => d.id === this.currentId) || this.designs[0]; }
  saveDesign(d, quiet) {
    if (!this.designs.includes(d)) this.designs.push(d);
    this.currentId = d.id;
    store.set('nw86.designs', this.designs.filter(x => !x.preset));
    store.set('nw86.current', this.currentId);
  }
  deleteDesign(id) {
    this.designs = this.designs.filter(d => d.id !== id);
    this.currentId = this.designs[0].id;
    store.set('nw86.designs', this.designs.filter(x => !x.preset));
    store.set('nw86.current', this.currentId);
  }
  saveSettings() { store.set('nw86.settings', this.settings); }

  // ---------- rendering ----------
  setupRenderer() {
    const canvas = $('#gl');
    const r = new THREE.WebGLRenderer({ canvas, antialias: this.settings.quality === 'low', powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.renderer = r;
    this.buildComposer();
    addEventListener('resize', () => this.resize());
    this.resize();
  }
  buildComposer() {
    const q = this.settings.quality;
    this.pixelRatio = Math.min(devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    if (this.composer) this.composer.dispose?.();
    this.composer = null;
    if (q !== 'low') {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 2 });
      const c = new EffectComposer(this.renderer, rt);
      this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
      c.addPass(this.renderPass);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), q === 'high' ? 0.85 : 0.7, 0.55, 0.62);
      c.addPass(this.bloom);
      c.addPass(new OutputPass());
      this.composer = c;
    }
    this.resize();
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(this.pixelRatio); this.composer.setSize(w, h); }
    if (this.battle) this.battle.setAspect(w / h, h * this.pixelRatio);
    if (this.demo) this.demo.setAspect(w / h, h * this.pixelRatio);
  }
  envFor(arenaId) {
    if (!this.envCache.has(arenaId)) { const a = ARENAS[arenaId]; this.envCache.set(arenaId, makeEnvMap(this.renderer, a.sky, a.grid)); }
    return this.envCache.get(arenaId);
  }
  renderScene(scene, camera) {
    if (this.composer) { this.renderPass.scene = scene; this.renderPass.camera = camera; this.composer.render(); }
    else this.renderer.render(scene, camera);
  }

  applyTouchMode() { document.body.classList.toggle('touch-on', this.input.touchMode || this.settings.forceTouch); this.hud && (this.hud.touch = document.body.classList.contains('touch-on')); }

  // ---------- screens ----------
  show(name) {
    if (name === 'back') name = this.prev || 'title';
    if (name === 'campaign') { this.toast('Road Campaign is coming soon — build your fleet now!'); this.audio.sfx('ui_error'); return; }
    if (['help', 'settings'].includes(name)) this.prev = this.screen;
    $$('.screen').forEach(s => s.classList.remove('on'));
    $('#scr-' + name).classList.add('on');
    this.screen = name;
    this.input.enabled = name === 'battle';
    if (this.battle && !['battle', 'results'].includes(name)) this.endBattle();
    if (name === 'title') { this.renderCareer(); if (!this.demo) this.startDemo(); this.music('menu'); }
    if (name === 'garage') { this.garage.open(this.currentDesign()); this.music('menu'); }
    if (name === 'setup') this.renderSetup();
    if (name === 'settings') this.renderSettings();
    if (name !== 'title' && name !== 'help' && name !== 'settings' && this.demo) { this.demo.dispose(); this.demo = null; }
  }
  music(t) { if (this.audio.ready) this.audio.playMusic(t); else this.pendingMusic = t; }

  toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(this._toast); this._toast = setTimeout(() => t.classList.remove('show'), 2200); }

  renderCareer() {
    const c = this.career;
    $('#career').innerHTML = c.battles ? `Career: <b>${c.battles}</b> battles · <b>${c.wins}</b> wins · <b>${c.kills}</b> wrecks · <b>${money(c.credits)}</b> earned` : 'Build a car. Wreck the competition. Be home by midnight.';
  }

  bindUI() {
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]');
      if (g) { this.audio.sfx('ui_click'); this.show(g.dataset.go); }
    });
    const unlock = () => {
      this.audio.init();
      if (this.pendingMusic) { this.audio.playMusic(this.pendingMusic); this.pendingMusic = null; }
      else if (this.screen === 'title' || this.screen === 'garage') this.audio.playMusic('menu');
    };
    addEventListener('pointerdown', unlock, { once: false, capture: true });
    addEventListener('keydown', unlock, { capture: true });
    // setup
    $('#pick-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.setup.mode = b.dataset.v; this.audio.sfx('ui_click'); this.renderSetup(); });
    $('#pick-diff').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.setup.diff = b.dataset.v; this.audio.sfx('ui_click'); this.renderSetup(); });
    $('#pick-arena').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.setup.arena = b.dataset.v; this.audio.sfx('ui_click'); this.renderSetup(); });
    $('#pick-cars').addEventListener('click', (e) => { const b = e.target.closest('.pcar'); if (!b) return; this.currentId = b.dataset.id; store.set('nw86.current', this.currentId); this.audio.sfx('ui_select'); this.renderSetup(); });
    $('#btn-start').addEventListener('click', () => this.startBattle());
    $('#btn-again').addEventListener('click', () => this.startBattle());
    $('#btn-resume').addEventListener('click', () => this.togglePause(false));
    $('#btn-restart').addEventListener('click', () => { this.togglePause(false); this.startBattle(); });
    $('#btn-quit').addEventListener('click', () => { this.togglePause(false); this.endBattle(); this.show('garage'); });
    $('#btn-camera').addEventListener('click', () => { if (this.battle) { this.battle.camMode = (this.battle.camMode + 1) % 3; this.updatePauseLabels(); } });
    $('#btn-mute').addEventListener('click', () => { this.audio.toggleMute(); this.updatePauseLabels(); });
    $('#h-pause').addEventListener('click', () => this.togglePause(true));
    $('#h-pause').addEventListener('touchstart', (e) => { e.preventDefault(); this.togglePause(true); }, { passive: false });
    // settings
    $('#set-quality').addEventListener('change', (e) => { this.settings.quality = e.target.value; this.saveSettings(); this.buildComposer(); this.toast('Graphics: ' + e.target.value + (this.battle ? ' (effects apply next battle)' : '')); });
    $('#set-music').addEventListener('input', (e) => { this.settings.music = +e.target.value; this.audio.setMusicVolume(this.settings.music); this.saveSettings(); });
    $('#set-sfx').addEventListener('input', (e) => { this.settings.sfx = +e.target.value; this.audio.setSfxVolume(this.settings.sfx); this.saveSettings(); });
    $('#set-sfx').addEventListener('change', () => this.audio.sfx('mg'));
    $('#set-shake').addEventListener('change', (e) => { this.settings.shake = e.target.checked; this.saveSettings(); });
    $('#set-touch').addEventListener('change', (e) => { this.settings.forceTouch = e.target.checked; this.saveSettings(); this.applyTouchMode(); });
    addEventListener('blur', () => { if (this.screen === 'battle' && !this.paused) this.togglePause(true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.screen === 'battle' && !this.paused) this.togglePause(true); });
  }

  renderSettings() {
    $('#set-quality').value = this.settings.quality; $('#set-music').value = this.settings.music; $('#set-sfx').value = this.settings.sfx;
    $('#set-shake').checked = this.settings.shake; $('#set-touch').checked = this.settings.forceTouch;
  }

  renderSetup() {
    const cur = this.currentDesign();
    $('#pick-cars').innerHTML = this.designs.map(d => {
      const st = computeStats(d), ok = validate(d, st).ok, p = PAINTS.find(x => x.id === d.paint) || PAINTS[0];
      return `<button class="pcar ${d.id === cur.id ? 'on' : ''} ${ok ? '' : 'bad'}" data-id="${d.id}">
        <span class="sw" style="background:linear-gradient(#${p.body.toString(16).padStart(6, '0')} 65%, #${p.trim.toString(16).padStart(6, '0')} 65%)"></span>
        <span>${d.name.replace(/</g, '&lt;')}${d.preset ? ' ★' : ''}<small>${st.kmh.toFixed(0)} km/h · ${st.ap} AP · ${d.weapons.length} weapons${ok ? '' : ' · NOT LEGAL'}</small></span>
        <span class="dv" style="color:${st.division.color}">${st.division.short}<br>${money(st.cost)}</span></button>`;
    }).join('');
    $$('#pick-mode button').forEach(b => b.classList.toggle('on', b.dataset.v === this.setup.mode));
    $$('#pick-diff button').forEach(b => b.classList.toggle('on', b.dataset.v === this.setup.diff));
    $('#pick-arena').innerHTML = Object.values(ARENAS).map(a => `<button data-v="${a.id}" class="${this.setup.arena === a.id ? 'on' : ''}" title="${a.desc}">${a.name}</button>`).join('') + `<button data-v="random" class="${this.setup.arena === 'random' ? 'on' : ''}">Random</button>`;
    const st = computeStats(cur), div = st.division, ok = validate(cur, st).ok;
    const budget = money(Math.min(isFinite(div.max) ? div.max : Infinity, Math.max(st.cost * 1.1, div.min + 2000, 7000)));
    $('#bracket').innerHTML = ok
      ? `<b>${cur.name}</b> costs <b>${money(st.cost)}</b> → <b style="color:${div.color}">${div.name}</b>${isFinite(div.max) ? ` (up to ${money(div.max)})` : ''}.<br>Rivals are custom-built on budgets up to <b>${budget}</b>. Prize purse: <b>${money(div.prize)}</b>.`
      : `<b style="color:#ff6a8a">${cur.name} isn't street legal.</b> Fix it in the Garage first.`;
    $('#btn-start').disabled = !ok;
    store.set('nw86.setup', this.setup);
  }

  // ---------- battle ----------
  startDemo() {
    if (this.demo) return;
    try {
      const d = autoDesign(20000); d.paint = 'cyan';
      this.demo = new Battle(this, { demo: true, playerDesign: d, mode: 'ffa', opponents: 5, arena: ['sunset', 'grid', 'boulevard'][Math.floor(Math.random() * 3)], difficulty: 'pro', timeLimit: 90, audio: SILENT });
      this.demo.setAspect(this.W / this.H, this.H * this.pixelRatio);
      this.demo.countdown = 0.01;
    } catch (e) { console.error(e); this.demo = null; }
  }

  startBattle() {
    const d = this.currentDesign();
    if (!validate(d).ok) { this.toast('Car is not street legal!'); return; }
    this.endBattle();
    if (this.demo) { this.demo.dispose(); this.demo = null; }
    const m = this.setup.mode;
    const arena = this.setup.arena === 'random' ? Object.keys(ARENAS)[Math.floor(Math.random() * 3)] : this.setup.arena;
    const cfg = {
      playerDesign: JSON.parse(JSON.stringify(d)), arena, difficulty: this.setup.diff,
      mode: m.startsWith('t') ? 'teams' : 'ffa', teamSize: m.startsWith('t') ? +m[1] : 0, opponents: m === 'ffa6' ? 5 : 3,
    };
    this.lastCfg = cfg;
    this.battle = new Battle(this, cfg);
    this.battle.setAspect(this.W / this.H, this.H * this.pixelRatio);
    this.hud.reset(this.battle);
    this.hud.touch = document.body.classList.contains('touch-on');
    // hide irrelevant touch buttons
    const P = this.battle.player, has = (pred) => P.weapons.some(pred);
    $('.tb-turret').classList.toggle('hide', !has(w => w.loc === 'top') || P.gunnerAlive);
    $('.tb-side').classList.toggle('hide', !has(w => w.loc === 'left' || w.loc === 'right') || P.gunnerAlive);
    $('.tb-rear').classList.toggle('hide', !has(w => w.loc === 'back' || w.loc === 'bottom'));
    this.paused = false; this.resultShown = false;
    this.show('battle');
    this.music('battle');
  }
  endBattle() { if (this.battle) { this.battle.dispose(); this.battle = null; } }

  togglePause(on) {
    if (!this.battle || this.battle.over) return;
    this.paused = on ?? !this.paused;
    $('#scr-pause').classList.toggle('on', this.paused);
    if (this.paused) { this.audio.stopLoops(); this.updatePauseLabels(); }
    this.audio.sfx('ui_click');
  }
  updatePauseLabels() {
    $('#cam-name').textContent = ['High', 'Top-down', 'Low'][this.battle ? this.battle.camMode : 0];
    $('#mute-name').textContent = this.audio.muted ? 'Off' : 'On';
  }

  showResults() {
    const r = this.battle.result, P = this.battle.player;
    this.resultShown = true;
    this.career.battles++; if (r.won) this.career.wins++; this.career.kills += P.score.kills; this.career.credits += r.prize;
    store.set('nw86.career', this.career);
    $('#res-title').textContent = `${r.division.name} · ${r.mode === 'teams' ? 'Team Battle' : 'Free-for-all'}`;
    const rows = r.rank.map((v, i) => {
      const acc = v.score.shots ? Math.round(v.score.hits / v.score.shots * 100) + '%' : '—';
      const team = this.battle.teams ? `<span style="color:#${TEAM_COLORS[v.team].toString(16).padStart(6, '0')}">■</span> ` : '';
      return `<tr class="${v.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${team}<b>${v.name.replace(/</g, '&lt;')}</b><br><small>${v.isPlayer ? 'You' : v.driverName} · ${v.B.cls}</small></td>
        <td class="${v.out ? 'out' : ''}">${v.out ? v.outReason : 'Survived'}</td><td>${v.score.kills}</td><td>${Math.round(v.score.dmgDealt)}</td><td>${acc}</td></tr>`;
    }).join('');
    $('#res-body').innerHTML = `<div class="res-banner ${r.won ? 'win' : 'lose'}">${r.won ? 'VICTORY!' : P.out ? 'WRECKED' : 'OUTGUNNED'}</div>
      <table class="res-table"><tr><th>#</th><th>Car</th><th>Status</th><th>Wrecks</th><th>Damage</th><th>Accuracy</th></tr>${rows}</table>
      <div class="res-prize">Prize money: ${money(r.prize)}</div>`;
    this.show('results');
    this.music(r.won ? 'victory' : 'defeat');
  }

  // ---------- loop ----------
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    const inp = this.input.state();
    if (inp.mute) { this.audio.toggleMute(); this.toast(this.audio.muted ? 'Sound off' : 'Sound on'); }
    const r = this.renderer;
    if (this.screen === 'garage') {
      this.garage.update(dt);
      const view = $('#g-view');
      if (view) {
        const rc = view.getBoundingClientRect();
        r.setScissorTest(false); r.setViewport(0, 0, this.W, this.H); r.setClearColor(0x0d0420); r.clear();
        if (rc.width > 10 && rc.height > 10) {
          const y = this.H - rc.bottom;
          r.setViewport(rc.left, y, rc.width, rc.height); r.setScissor(rc.left, y, rc.width, rc.height); r.setScissorTest(true);
          this.garage.camera.aspect = rc.width / rc.height; this.garage.camera.updateProjectionMatrix();
          this.garage.scene.environment = this.envFor('sunset');
          r.render(this.garage.scene, this.garage.camera);
          r.setScissorTest(false); r.setViewport(0, 0, this.W, this.H);
        }
      }
      return;
    }
    if (this.battle && ['battle', 'results'].includes(this.screen) || (this.battle && this.paused)) {
      if (!this.paused) {
        if (inp.pause && this.screen === 'battle') { this.togglePause(true); }
        else {
          this.battle.update(dt, inp);
          if (this.screen === 'battle') this.hud.update(dt, this.W, this.H);
          if (this.battle.over && !this.resultShown) {
            this.resultT = (this.resultT || 0) + dt;
            if (this.resultT > 1.2) { this.resultT = 0; this.audio.stopLoops(); this.showResults(); }
          }
        }
      } else if (inp.pause) this.togglePause(false);
      this.renderScene(this.battle.scene, this.battle.camera);
      return;
    }
    if (this.demo) {
      this.demo.update(dt, inp);
      if (this.demo.over) { this.demo.dispose(); this.demo = null; this.startDemo(); }
      if (this.demo) this.renderScene(this.demo.scene, this.demo.camera);
      return;
    }
    r.setClearColor(0x0d0420); r.clear();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try { window.game = new Game(); }
  catch (e) { console.error(e); $('#loading').textContent = 'Failed to start: ' + e.message; }
});
