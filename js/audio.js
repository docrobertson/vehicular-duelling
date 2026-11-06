// NEON WRECKERS 2086 - procedural audio engine.
// Everything is synthesized with the Web Audio API: no assets, no dependencies.
//
// Graph:  [track: voices -> channels -> fade] -> musicBus \
//         [sfx voices -> gain -> lowpass -> pan] -> sfxBus  > comp -> limiter -> master -> destination
//         [engine / skid loops] ------------------> sfxBus /
//
// Music uses a lookahead scheduler (setInterval 25 ms, ~0.15 s ahead) over 16th-note steps.
// Each track instance owns its own fade gain, hall reverb, gated reverb and ping-pong delay,
// so crossfades also fade the effect tails.

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const clamp01 = (v) => { v = +v; return v > 0 ? (v < 1 ? v : 1) : 0; }; // NaN -> 0
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const EPS = 0.0001;

const LOOKAHEAD = 0.15;   // seconds scheduled ahead
const TICK_MS = 25;       // scheduler interval
const MAX_SFX = 24;       // simultaneous one-shots
const SFX_RATE = 0.03;    // min seconds between identical sfx names
const MUSIC_TRIM = 0.62;  // music bus headroom
const SFX_TRIM = 0.9;

// ---------------------------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------------------------
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUAL = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7], sus2: [0, 2, 7], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14],
};
const chordCache = new Map();
function chord(name) {
  let c = chordCache.get(name);
  if (c) return c;
  const m = /^([A-G])([#b]?)(.*)$/.exec(name) || [0, 'A', '', 'm'];
  const pc = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const iv = QUAL[m[3]] || QUAL[''];
  const bass = 28 + ((pc - 4 + 12) % 12); // E1..D#2
  const pad = iv.slice(0, 4).map((i) => {
    let n = 48 + pc + i;
    while (n < 50) n += 12;
    while (n > 67) n -= 12;
    return n;
  }).sort((a, b) => a - b);
  const tri = iv.slice(0, 3).map((i) => 57 + (((pc + i - 9) % 12) + 12) % 12).sort((a, b) => a - b);
  const arp = [tri[0], tri[1], tri[2], tri[0] + 12, tri[1] + 12, tri[2] + 12, tri[0] + 24];
  c = { pc, iv, bass, pad, arp };
  chordCache.set(name, c);
  return c;
}

// Arp patterns: indices into chord.arp (triad over ~2 octaves)
const ARP_PATS = [
  [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3],
  [3, 2, 0, 2, 3, 4, 3, 2, 5, 4, 3, 2, 3, 2, 1, 2],
  [0, 0, 3, 0, 1, 0, 4, 0, 2, 0, 5, 0, 4, 0, 3, 0],
  [0, 2, 4, 2, 1, 3, 5, 3, 2, 4, 6, 4, 3, 5, 4, 2],
];
// Bass patterns: semitone offsets per 16th
const BASS_PATS = [
  [0, 12],
  [0, 0, 12, 0],
  [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 7, 19, 7, 12],
];

// Melody note format: [bar, step, midi, lengthInSteps, glide?]
const rep = (notes, barShift) => notes.map((n) => [n[0] + barShift, ...n.slice(1)]);
const riff8 = (bar, notes, len = 1.3) => notes.map((n, i) => [bar, i * 2, n, len]);

// --- battle hooks (A minor) ---
const HOOK_A1 = [
  [0, 0, 76, 3], [0, 3, 81, 3], [0, 6, 79, 2], [0, 8, 76, 4], [0, 12, 74, 2], [0, 14, 76, 2],
  [1, 0, 72, 3], [1, 3, 77, 3], [1, 6, 76, 2], [1, 8, 72, 4], [1, 12, 69, 4],
  [2, 0, 76, 3], [2, 3, 79, 3], [2, 6, 81, 2], [2, 8, 79, 4], [2, 12, 76, 2], [2, 14, 79, 2],
];
const LEAD_BATTLE_A = [
  ...HOOK_A1,
  [3, 0, 74, 6], [3, 6, 71, 2], [3, 8, 74, 4], [3, 12, 79, 4],
  ...rep(HOOK_A1, 4),
  [7, 0, 79, 3], [7, 3, 83, 3], [7, 6, 84, 2], [7, 8, 86, 8, true],
];
const LEAD_BATTLE_B = [
  [0, 0, 81, 8], [0, 8, 84, 8, true],
  [1, 0, 83, 8], [1, 8, 86, 4], [1, 12, 83, 4],
  [2, 0, 84, 12], [2, 12, 83, 2], [2, 14, 81, 2],
  [3, 0, 76, 16, true],
  [4, 0, 81, 8], [4, 8, 84, 8, true],
  [5, 0, 86, 8], [5, 8, 88, 8, true],
  [6, 0, 88, 12], [6, 12, 86, 4],
  [7, 0, 80, 8], [7, 8, 83, 8, true],
];
const LEAD_BATTLE_C = [
  ...riff8(0, [74, 77, 81, 77, 74, 77, 81, 79]),
  ...riff8(1, [77, 81, 84, 81, 77, 81, 84, 83]),
  ...riff8(2, [76, 81, 84, 81, 76, 81, 84, 86]),
  ...riff8(3, [83, 79, 74, 79, 83, 86, 83, 79]),
  ...riff8(4, [74, 77, 81, 77, 74, 77, 81, 79]),
  ...riff8(5, [77, 81, 84, 81, 77, 81, 84, 83]),
  ...riff8(6, [79, 83, 86, 83, 79, 83, 86, 88]),
  [7, 0, 88, 8, true], [7, 8, 86, 4], [7, 12, 83, 4],
];
// --- menu melodies (F# minor) ---
const LEAD_MENU_B = [
  [0, 0, 73, 6], [0, 6, 76, 2], [0, 8, 78, 6], [0, 14, 76, 2],
  [1, 0, 78, 4], [1, 4, 81, 4], [1, 8, 78, 4], [1, 12, 76, 4],
  [2, 0, 76, 6], [2, 6, 73, 2], [2, 8, 76, 4], [2, 12, 81, 4],
  [3, 0, 80, 8], [3, 8, 78, 4], [3, 12, 76, 4],
  [4, 0, 73, 6], [4, 6, 76, 2], [4, 8, 78, 6], [4, 14, 81, 2],
  [5, 0, 83, 4], [5, 4, 81, 4], [5, 8, 78, 8, true],
  [6, 0, 76, 4], [6, 4, 78, 4], [6, 8, 81, 4], [6, 12, 85, 4, true],
  [7, 0, 83, 12], [7, 12, 80, 4],
];
const LEAD_MENU_C = [
  [0, 0, 78, 8], [0, 8, 74, 4], [0, 12, 71, 4],
  [1, 0, 81, 8, true], [1, 8, 78, 8],
  [2, 0, 85, 6], [2, 6, 81, 2], [2, 8, 78, 8],
  [3, 0, 80, 8], [3, 8, 83, 8, true],
  [4, 0, 86, 6], [4, 6, 85, 2], [4, 8, 83, 8],
  [5, 0, 81, 6], [5, 6, 78, 2], [5, 8, 81, 8],
  [6, 0, 80, 8], [6, 8, 76, 8],
  [7, 0, 71, 14],
];
const LEAD_VICTORY = [
  [0, 0, 72, 2], [0, 2, 75, 2], [0, 4, 80, 4], [0, 8, 74, 2], [0, 10, 77, 2], [0, 12, 82, 4],
  [1, 0, 84, 12, true], [1, 12, 82, 2], [1, 14, 84, 2],
  [2, 0, 88, 8, true], [2, 8, 84, 14],
];
const LEAD_DEFEAT = [
  [0, 0, 76, 7.5], [0, 8, 74, 7.5], [1, 0, 72, 7.5], [1, 8, 71, 4], [1, 12, 68, 12, true],
];

// ---------------------------------------------------------------------------------------------
// Song play functions: called once per 16th step with position info p.
// ---------------------------------------------------------------------------------------------
function playLead(E, tr, p, opt) {
  const notes = p.sec._lead && p.sec._lead.get(p.bar * 16 + p.s);
  if (notes) for (const n of notes) E._lead(tr, p.t, n[2], n[3] * p.sd * 0.96, 0.9, opt, !!n[4]);
}

function playBattle(E, tr, p) {
  const { sec, bar, s, t, sd, chord: c } = p;
  const I = E._intensity;
  const kind = sec.kind;
  const last = bar === sec.bars - 1;
  const beat = s % 4 === 0;

  // ----- drums
  if (kind === 'full') {
    if (bar === 0 && s === 0) E._crash(tr, t, 0.8);
    const fill = last && s >= 12;
    if (beat) E._kick(tr, t, 1);
    if (s === 14 && bar % 2 === 1) E._kick(tr, t, 0.55, 'perc');
    if ((s === 4 || s === 12) && !fill) { E._snare(tr, t, 1); E._clap(tr, t, 0.9); }
    if (fill) {
      if (I > 0.3) E._tom(tr, t, [52, 48, 45, 40][s - 12], 0.95);
      else if (s !== 13) E._snare(tr, t, s === 12 ? 1 : 0.6);
    }
    if (s % 4 === 2) { E._hat(tr, t, 0.6, false, 'drums'); E._hat(tr, t, 0.6, true, 'hat16'); }
    else E._hat(tr, t, s % 2 ? 0.32 : 0.45, false, 'hat16');
    if (s % 2 === 1) E._shaker(tr, t, s % 4 === 3 ? 0.7 : 0.45);
  } else if (kind === 'intro') {
    if (beat) E._kick(tr, t, bar < 2 ? 0.85 : 1);
    if (s % 4 === 2) E._hat(tr, t, 0.5, false, 'drums');
    if (bar >= 2 && (s === 4 || s === 12) && !(bar === 3 && s === 12)) E._snare(tr, t, 0.85);
    if (bar === 3 && s >= 8) E._snare(tr, t, 0.35 + 0.07 * (s - 8));
    if (bar === 2 && s === 0) E._riser(tr, t, sd * 32);
  } else { // breakdown
    if (bar === 0 && s === 0) E._crash(tr, t, 0.6);
    if (bar < 2) {
      if (s === 8) E._snare(tr, t, 0.9);
      if (s % 4 === 2) E._hat(tr, t, 0.35, false, 'drums');
    } else if (bar === 2) {
      if (s === 0 || s === 8) E._kick(tr, t, 0.9);
      if (s === 4 || s === 12) E._snare(tr, t, 0.75);
      if (s % 2 === 0) E._hat(tr, t, 0.35, false, 'drums');
      if (s === 0) E._riser(tr, t, sd * 32);
    } else {
      if (beat) E._kick(tr, t, 1);
      E._snare(tr, t, 0.25 + 0.045 * s);
    }
  }

  // ----- bass
  if (kind === 'break' && bar < 3) {
    if (s === 0) E._bass(tr, t, c.bass, sd * 16, 0.9, true);
  } else if (kind !== 'intro' || bar >= 2) {
    const pat = BASS_PATS[sec.bassPat || 0];
    E._bass(tr, t, c.bass + pat[s % pat.length], sd * 0.85, beat ? 1 : 0.8);
  }

  // ----- pad
  if (s === 0) E._pad(tr, t, c.pad, sd * 16 + 0.04, { attack: kind === 'break' ? 0.5 : 0.2 });

  // ----- arp
  if (kind !== 'intro' || bar >= 1) {
    const ai = sec.arp || 0;
    if (ai !== 2 || s % 2 === 0) E._arp(tr, t, c.arp[ARP_PATS[ai][s]], sd, beat ? 0.9 : 0.7);
  }

  // ----- lead (channel gain follows intensity)
  playLead(E, tr, p);
}

function playMenu(E, tr, p) {
  const { sec, bar, s, t, sd, chord: c } = p;
  const kind = sec.kind;
  const last = bar === sec.bars - 1;
  const beat = s % 4 === 0;

  if (kind !== 'break') {
    if (bar === 0 && s === 0) E._crash(tr, t, 0.45);
    const fill = last && s >= 12 && kind === 'groove2';
    if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1)) E._kick(tr, t, 0.85);
    if ((s === 4 || s === 12) && !fill) E._snare(tr, t, 0.6);
    if (fill && s % 2 === 0) E._tom(tr, t, s === 12 ? 47 : 43, 0.7);
    if (fill && s === 15) E._snare(tr, t, 0.5);
    if (s % 2 === 0) E._hat(tr, t, s % 4 === 2 ? 0.4 : 0.22, false, 'drums');
    if (s === 14) E._hat(tr, t, 0.35, true, 'drums');
    if (kind === 'groove2' && s % 2 === 1) E._shaker(tr, t, 0.4);
  } else {
    if (s % 4 === 2) E._hat(tr, t, 0.25, false, 'drums');
    if (bar === 2 && s === 0) E._riser(tr, t, sd * 32);
    if (last) { if (beat) E._kick(tr, t, 0.8); if (s >= 8 && s % 2 === 0) E._snare(tr, t, 0.3 + 0.05 * (s - 8)); }
  }

  // bass: 8th-note octave pulse
  if (kind === 'break' && !last) {
    if (s === 0) E._bass(tr, t, c.bass, sd * 16, 0.8, true);
  } else if (s % 2 === 0) {
    E._bass(tr, t, c.bass + (s % 4 === 2 ? 12 : 0), sd * 1.6, beat ? 1 : 0.8);
  }

  if (s === 0) E._pad(tr, t, c.pad, sd * 16 + 0.05, { attack: 0.35, release: 0.9 });
  E._arp(tr, t, c.arp[ARP_PATS[3][s]], sd, (kind === 'intro' ? 0.85 : 0.6) * (beat ? 1 : 0.8));
  playLead(E, tr, p, { soft: true });
}

function playVictory(E, tr, p) {
  const { bar, s, t, sd } = p;
  const stab = { attack: 0.01, release: 0.25, cut: 4200, stab: true, vol: 1.2 };
  if (bar === 0) {
    if (s === 0) { E._pad(tr, t, [56, 60, 63, 68], sd * 7.5, stab); E._bass(tr, t, 32, sd * 7.5, 1, true); E._kick(tr, t, 1); E._snare(tr, t, 1); E._crash(tr, t, 0.6); }
    if (s === 8) { E._pad(tr, t, [58, 62, 65, 70], sd * 4, stab); E._bass(tr, t, 34, sd * 4, 1, true); E._kick(tr, t, 1); E._snare(tr, t, 1); }
    if (s >= 12) E._tom(tr, t, [52, 48, 45, 41][s - 12], 0.95);
  } else if (bar === 1) {
    if (s === 0) { E._pad(tr, t, [60, 64, 67, 72], sd * 24, { attack: 0.02, release: 0.8, cut: 5000, vol: 1.1 }); E._bass(tr, t, 36, sd * 24, 1, true); E._crash(tr, t, 1); }
    if (s % 4 === 0) E._kick(tr, t, s === 0 ? 1 : 0.8);
    if (s === 0 || s === 4 || s === 12) E._snare(tr, t, s === 0 ? 1 : 0.8);
    E._hat(tr, t, 0.4, s % 4 === 2, 'drums');
    E._arp(tr, t, [72, 76, 79, 84, 88, 91, 96, 91][s % 8], sd, 0.9 - s * 0.02);
  } else if (bar === 2) {
    if (s === 0) { E._kick(tr, t, 0.9); E._snare(tr, t, 0.8); }
    if (s < 8) E._arp(tr, t, [96, 91, 88, 84, 79, 76, 72, 67][s], sd, 0.6);
    if (s === 8) {
      E._kick(tr, t, 1); E._snare(tr, t, 1); E._crash(tr, t, 1);
      E._pad(tr, t, [55, 60, 64, 67, 72], sd * 14, { attack: 0.01, release: 1.4, cut: 5000, stab: true, vol: 1.2 });
      E._bass(tr, t, 36, sd * 14, 1, true);
    }
  }
  playLead(E, tr, p, { bright: true });
}

function playDefeat(E, tr, p) {
  const { bar, s, t, sd } = p;
  const pad = { attack: 0.06, release: 0.6, cut: 1700, vol: 1.1 };
  const step = (padN, bassN, len) => { E._pad(tr, t, padN, sd * len, pad); E._bass(tr, t, bassN, sd * len, 0.9, true); };
  if (bar === 0 && s === 0) { step([57, 60, 64], 33, 8); E._kick(tr, t, 1); E._snare(tr, t, 0.9); E._crash(tr, t, 0.4); }
  if (bar === 0 && s === 8) { step([55, 59, 62], 31, 8); E._kick(tr, t, 0.8); E._snare(tr, t, 0.8); }
  if (bar === 1 && s === 0) { step([53, 57, 60], 29, 8); E._kick(tr, t, 0.9); E._snare(tr, t, 0.85); }
  if (bar === 1 && s === 8) {
    E._pad(tr, t, [52, 56, 59, 64], sd * 18, { attack: 0.05, release: 1.6, cut: 1500, vol: 1.1 });
    E._bass(tr, t, 28, sd * 18, 0.9, true);
    E._kick(tr, t, 1); E._snare(tr, t, 1); E._crash(tr, t, 0.5);
    E._sweep(tr, t + sd * 4, 520, 35, sd * 14);
  }
  if (s % 2 === 0 && !(bar === 1 && s > 8)) E._hat(tr, t, 0.22, false, 'drums');
  playLead(E, tr, p, { soft: true, vib: 28 });
}

// ---------------------------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------------------------
const SONGS = {
  battle: {
    bpm: 140, intensity: true, play: playBattle,
    intro: ['I'], loop: ['A', 'B', 'C', 'A', 'B', 'D'],
    mix: { lead: 0.27, arp: 0.21, pad: 0.2, bass: 0.3, hat16: 0.6, perc: 0.65, duck: 0.32 },
    sections: {
      I: { bars: 4, kind: 'intro', chords: ['Am', 'F', 'C', 'G'] },
      A: { bars: 8, kind: 'full', chords: ['Am', 'F', 'C', 'G'], arp: 0, lead: LEAD_BATTLE_A },
      B: { bars: 8, kind: 'full', chords: ['F', 'G', 'Am', 'Am', 'F', 'G', 'C', 'E'], arp: 1, bassPat: 1, lead: LEAD_BATTLE_B },
      C: { bars: 8, kind: 'full', chords: ['Dm', 'F', 'Am', 'G', 'Dm', 'F', 'G', 'G'], arp: 2, bassPat: 2, lead: LEAD_BATTLE_C },
      D: { bars: 4, kind: 'break', chords: ['F', 'G', 'Am', 'E'], arp: 0 },
    },
  },
  menu: {
    bpm: 104, play: playMenu,
    intro: [], loop: ['A', 'B', 'C', 'D'],
    mix: { lead: 0.17, arp: 0.15, pad: 0.22, bass: 0.27, hat16: 0, perc: 0.55, duck: 0.6 },
    tones: { bass: 1500, pad: 4000, arp: 6000 },
    sections: {
      A: { bars: 8, kind: 'intro', chords: ['F#m7', 'Dmaj7', 'Amaj7', 'E'] },
      B: { bars: 8, kind: 'groove', chords: ['F#m7', 'Dmaj7', 'Amaj7', 'E'], lead: LEAD_MENU_B },
      C: { bars: 8, kind: 'groove2', chords: ['Bm7', 'Dmaj7', 'F#m7', 'E', 'Bm7', 'Dmaj7', 'Esus4', 'E'], lead: LEAD_MENU_C },
      D: { bars: 4, kind: 'break', chords: ['Dmaj7', 'E', 'F#m7', 'E'] },
    },
  },
  victory: {
    bpm: 130, play: playVictory, intro: ['V'], loop: null,
    mix: { lead: 0.22, arp: 0.13, pad: 0.16, bass: 0.4, hat16: 0, perc: 0.5, duck: 0.8 },
    tones: { bass: 2600, pad: 7000, arp: 9000 },
    sections: { V: { bars: 4, kind: 'stinger', chords: ['C'], lead: LEAD_VICTORY } },
  },
  defeat: {
    bpm: 90, play: playDefeat, intro: ['X'], loop: null,
    mix: { lead: 0.16, arp: 0.1, pad: 0.17, bass: 0.4, hat16: 0, perc: 0.5, duck: 0.85 },
    tones: { bass: 900, pad: 2200, arp: 3000 },
    sections: { X: { bars: 3, kind: 'stinger', chords: ['Am'], lead: LEAD_DEFEAT } },
  },
};

// Precompute lead lookup maps and timelines.
for (const song of Object.values(SONGS)) {
  for (const sec of Object.values(song.sections)) {
    sec._chords = sec.chords.map(chord);
    if (sec.lead) {
      sec._lead = new Map();
      for (const n of sec.lead) {
        const k = n[0] * 16 + n[1];
        if (!sec._lead.has(k)) sec._lead.set(k, []);
        sec._lead.get(k).push(n);
      }
    }
  }
  const tl = (names) => {
    let start = 0;
    const out = names.map((name) => {
      const sec = song.sections[name];
      const e = { name, sec, start, steps: sec.bars * 16 };
      start += e.steps;
      return e;
    });
    return { list: out, steps: start };
  };
  song._intro = tl(song.intro || []);
  song._loop = song.loop ? tl(song.loop) : null;
}

// ---------------------------------------------------------------------------------------------
// Sound effects: name -> [durationForVoiceCounting, reverbSend, fn(E, out, t, opts)]
// ---------------------------------------------------------------------------------------------
const SFX = {
  mg: [0.1, 0.05, (E, o, t) => {
    E._nz(o, t, { dur: 0.08, vol: 0.85, type: 'bandpass', f: rand(1400, 1900), f1: 500, Q: 0.9 });
    E._tone(o, t, { type: 'square', f: rand(170, 210), f1: 55, dur: 0.06, vol: 0.32, filter: 1500 });
    E._nz(o, t, { dur: 0.025, vol: 0.45, type: 'highpass', f: 4000 });
  }],
  autocannon: [0.3, 0.12, (E, o, t) => {
    E._tone(o, t, { type: 'sine', f: 150, f1: 38, dur: 0.26, vol: 0.95 });
    E._nz(o, t, { dur: 0.24, vol: 0.9, type: 'lowpass', f: 2400, f1: 280, Q: 1.2, shape: true });
    E._tone(o, t, { type: 'sawtooth', f: 95, f1: 40, dur: 0.12, vol: 0.25, filter: 800 });
    E._nz(o, t, { dur: 0.03, vol: 0.5, type: 'highpass', f: 3000 });
  }],
  rocket: [0.75, 0.2, (E, o, t) => {
    E._nz(o, t, { dur: 0.06, vol: 0.7, type: 'bandpass', f: 900, Q: 1 });
    E._nz(o, t, { dur: 0.75, vol: 0.95, type: 'bandpass', f: 450, f1: 3200, Q: 1.6, attack: 0.06, sweep: 0.55 });
    E._tone(o, t, { type: 'sawtooth', f: 110, f1: 440, dur: 0.55, vol: 0.16, attack: 0.05, filter: 1600 });
  }],
  laser: [0.3, 0.25, (E, o, t) => {
    const f = rand(1500, 1850);
    E._tone(o, t, { type: 'square', f, f1: 170, dur: 0.22, vol: 0.22, filter: 5000 });
    E._tone(o, t, { type: 'sawtooth', f: f * 1.5, f1: 240, dur: 0.18, vol: 0.1, detune: 14 });
    E._tone(o, t + 0.075, { type: 'square', f: f * 0.8, f1: 150, dur: 0.18, vol: 0.07, filter: 3000 });
  }],
  flame: [0.3, 0.05, (E, o, t) => {
    E._nz(o, t, { dur: 0.3, vol: 0.75, type: 'lowpass', f: rand(750, 1100), f1: 420, Q: 2, attack: 0.04 });
    E._nz(o, t, { dur: 0.24, vol: 0.3, type: 'bandpass', f: rand(2500, 3600), Q: 1, attack: 0.02 });
    E._tone(o, t, { type: 'sawtooth', f: rand(55, 72), f1: 45, dur: 0.28, vol: 0.12, attack: 0.03, filter: 320 });
  }],
  grenade: [0.2, 0.1, (E, o, t) => {
    E._tone(o, t, { type: 'sine', f: 260, f1: 70, dur: 0.18, vol: 0.8 });
    E._nz(o, t, { dur: 0.1, vol: 0.5, type: 'lowpass', f: 650, Q: 1 });
    E._tone(o, t, { type: 'square', f: 120, f1: 60, dur: 0.08, vol: 0.18, filter: 600 });
  }],
  mine_drop: [0.2, 0.1, (E, o, t) => {
    E._tone(o, t, { type: 'square', f: 180, f1: 90, dur: 0.1, vol: 0.32, filter: 900 });
    E._tone(o, t, { type: 'sine', f: 1450, dur: 0.05, vol: 0.13 });
    E._nz(o, t, { dur: 0.05, vol: 0.3, type: 'lowpass', f: 1500 });
    E._tone(o, t + 0.08, { type: 'square', f: 140, f1: 80, dur: 0.09, vol: 0.25, filter: 700 });
  }],
  oil: [0.35, 0.1, (E, o, t) => {
    E._nz(o, t, { dur: 0.3, vol: 0.6, type: 'lowpass', f: 1600, f1: 200, Q: 3 });
    E._tone(o, t + 0.05, { type: 'sine', f: 330, f1: 140, dur: 0.12, vol: 0.35 });
    E._tone(o, t + 0.17, { type: 'sine', f: 270, f1: 110, dur: 0.13, vol: 0.3 });
  }],
  smoke: [1.0, 0.15, (E, o, t) => {
    E._nz(o, t, { dur: 1.0, vol: 0.38, type: 'highpass', f: 2500, attack: 0.05 });
    E._nz(o, t, { dur: 0.8, vol: 0.25, type: 'bandpass', f: 900, f1: 500, Q: 0.8, attack: 0.03 });
  }],
  spikes: [0.35, 0.15, (E, o, t) => {
    for (let i = 0; i < 7; i++) {
      E._tone(o, t + i * 0.028 + rand(0, 0.01), { type: i % 2 ? 'square' : 'sine', f: rand(2200, 5200), dur: rand(0.06, 0.14), vol: 0.1, filter: i % 2 ? 6000 : 0 });
    }
    E._nz(o, t, { dur: 0.25, vol: 0.2, type: 'highpass', f: 6000 });
  }],
  emp: [0.75, 0.3, (E, o, t) => {
    E._tone(o, t, { type: 'sawtooth', f: 3200, f1: 90, dur: 0.35, vol: 0.18 });
    E._buzz(o, t, 0.7);
    E._nz(o, t, { dur: 0.4, vol: 0.28, type: 'bandpass', f: 4000, f1: 1500, Q: 2 });
  }],
  explosion_small: [0.8, 0.25, (E, o, t) => {
    E._tone(o, t, { type: 'sine', f: 120, f1: 35, dur: 0.45, vol: 0.9 });
    E._nz(o, t, { dur: 0.75, vol: 0.9, type: 'lowpass', f: 3500, f1: 250, Q: 0.8, shape: true, sweep: 0.6 });
    E._nz(o, t, { dur: 0.15, vol: 0.4, type: 'bandpass', f: 1500, Q: 1 });
  }],
  explosion_big: [2.4, 0.45, (E, o, t) => {
    E._tone(o, t, { type: 'sine', f: 78, f1: 22, dur: 1.3, vol: 1, sweep: 0.9 });
    E._tone(o, t, { type: 'sine', f: 46, f1: 28, dur: 1.6, vol: 0.55, attack: 0.01 });
    E._nz(o, t, { dur: 2.4, vol: 1, type: 'lowpass', f: 6500, f1: 120, Q: 0.7, shape: true, sweep: 1.8 });
    E._nz(o, t, { dur: 0.08, vol: 0.7, type: 'highpass', f: 2000 });
    for (let i = 0; i < 6; i++) E._nz(o, t + rand(0.08, 0.9), { dur: rand(0.04, 0.1), vol: rand(0.12, 0.3), type: 'bandpass', f: rand(1200, 3500), Q: 2 });
  }],
  hit_armor: [0.15, 0.05, (E, o, t) => {
    E._tone(o, t, { type: 'sine', f: 150, f1: 55, dur: 0.14, vol: 0.7 });
    E._nz(o, t, { dur: 0.1, vol: 0.5, type: 'lowpass', f: 700, Q: 1 });
    E._tone(o, t, { type: 'triangle', f: 300, f1: 120, dur: 0.05, vol: 0.2 });
  }],
  hit_metal: [0.5, 0.15, (E, o, t) => {
    const b = rand(800, 1050);
    [1, 1.47, 2.31, 3.13].forEach((m, i) => E._tone(o, t, { type: 'sine', f: b * m, dur: 0.5 - i * 0.08, vol: 0.16 - i * 0.025 }));
    E._nz(o, t, { dur: 0.03, vol: 0.5, type: 'highpass', f: 3000 });
  }],
  ricochet: [0.42, 0.2, (E, o, t) => {
    E._tone(o, t, { type: 'sine', f: rand(2600, 3300), f1: rand(650, 900), dur: 0.4, vol: 0.2, attack: 0.005 });
    E._tone(o, t, { type: 'triangle', f: rand(3900, 4300), f1: 1300, dur: 0.25, vol: 0.06 });
    E._nz(o, t, { dur: 0.02, vol: 0.4, type: 'highpass', f: 4000 });
  }],
  tire_pop: [0.6, 0.1, (E, o, t) => {
    E._nz(o, t, { dur: 0.06, vol: 1, type: 'bandpass', f: 1200, Q: 0.7 });
    E._tone(o, t, { type: 'sine', f: 200, f1: 60, dur: 0.08, vol: 0.5 });
    E._nz(o, t + 0.02, { dur: 0.6, vol: 0.32, type: 'highpass', f: 1500, attack: 0.01 });
  }],
  crash: [0.55, 0.15, (E, o, t) => {
    E._nz(o, t, { dur: 0.5, vol: 0.9, type: 'lowpass', f: 3000, f1: 400, Q: 0.8, shape: true });
    E._tone(o, t, { type: 'sine', f: 110, f1: 40, dur: 0.25, vol: 0.8 });
    let tt = t;
    for (let i = 0; i < 4; i++) { tt += rand(0.015, 0.05); E._nz(o, tt, { dur: 0.08, vol: 0.45, type: 'bandpass', f: rand(800, 2600), Q: 3 }); }
    E._tone(o, t + 0.02, { type: 'sine', f: rand(900, 1300), dur: 0.3, vol: 0.08 });
    E._tone(o, t + 0.05, { type: 'sine', f: rand(1700, 2300), dur: 0.25, vol: 0.06 });
  }],
  pickup: [0.4, 0.3, (E, o, t) => {
    [84, 88, 91, 96].forEach((n, i) => {
      E._tone(o, t + i * 0.055, { type: 'square', f: mtof(n), dur: 0.14, vol: 0.18, filter: 6000 });
      E._tone(o, t + i * 0.055, { type: 'sine', f: mtof(n + 12), dur: 0.12, vol: 0.06 });
    });
  }],
  ui_click: [0.04, 0, (E, o, t) => {
    E._tone(o, t, { type: 'sine', f: 2000, f1: 1200, dur: 0.03, vol: 0.25 });
  }],
  ui_select: [0.16, 0.1, (E, o, t) => {
    E._tone(o, t, { type: 'square', f: 880, dur: 0.06, vol: 0.18, filter: 3000 });
    E._tone(o, t + 0.06, { type: 'square', f: 1320, dur: 0.09, vol: 0.18, filter: 3500 });
  }],
  ui_error: [0.33, 0, (E, o, t) => {
    E._tone(o, t, { type: 'square', f: 180, dur: 0.12, vol: 0.2, filter: 1200 });
    E._tone(o, t + 0.14, { type: 'square', f: 140, dur: 0.18, vol: 0.2, filter: 1000 });
  }],
  countdown: [0.26, 0.1, (E, o, t) => {
    E._tone(o, t, { type: 'square', f: 880, dur: 0.18, vol: 0.16, filter: 4000 });
    E._tone(o, t, { type: 'sine', f: 880, dur: 0.25, vol: 0.2 });
  }],
  go: [0.6, 0.25, (E, o, t) => {
    [81, 85, 88, 93].forEach((n) => {
      E._tone(o, t, { type: 'square', f: mtof(n), dur: 0.55, vol: 0.08, filter: 5000 });
      E._tone(o, t, { type: 'sine', f: mtof(n), dur: 0.6, vol: 0.08 });
    });
  }],
  boost: [0.7, 0.15, (E, o, t) => {
    E._nz(o, t, { dur: 0.7, vol: 1, type: 'bandpass', f: 300, f1: 4000, Q: 2, attack: 0.05, sweep: 0.6 });
    E._tone(o, t, { type: 'sawtooth', f: 150, f1: 900, dur: 0.5, vol: 0.18, filter: 2200, attack: 0.03 });
  }],
  overheat: [0.45, 0.1, (E, o, t) => {
    for (let i = 0; i < 3; i++) E._tone(o, t + i * 0.12, { type: 'square', f: 740, dur: 0.09, vol: 0.2, filter: 2500 });
    E._tone(o, t, { type: 'sawtooth', f: 600, f1: 300, dur: 0.42, vol: 0.1, filter: 1500 });
  }],
  alarm: [0.58, 0.05, (E, o, t) => {
    for (let i = 0; i < 4; i++) E._tone(o, t + i * 0.14, { type: 'square', f: i % 2 ? 720 : 960, dur: 0.13, vol: 0.22, filter: 3000, attack: 0.005 });
  }],
  kill: [0.7, 0.35, (E, o, t) => {
    E._tone(o, t, { type: 'sine', f: 95, f1: 40, dur: 0.3, vol: 0.7 });
    [76, 83, 88].forEach((n) => E._tone(o, t, { type: 'sawtooth', f: mtof(n), dur: 0.35, vol: 0.07, filter: 3500 }));
    E._tone(o, t + 0.07, { type: 'square', f: mtof(88), dur: 0.12, vol: 0.08, filter: 5000 });
    E._tone(o, t + 0.13, { type: 'square', f: mtof(95), dur: 0.2, vol: 0.08, filter: 6000 });
    E._tone(o, t + 0.05, { type: 'sine', f: mtof(100), dur: 0.6, vol: 0.1 });
  }],
  buy: [0.8, 0.2, (E, o, t) => {
    E._tone(o, t, { type: 'square', f: 1976, dur: 0.05, vol: 0.1, filter: 5000 });
    E._tone(o, t + 0.06, { type: 'square', f: 2637, dur: 0.08, vol: 0.1, filter: 6000 });
    E._nz(o, t + 0.1, { dur: 0.05, vol: 0.22, type: 'highpass', f: 5000 });
    E._tone(o, t + 0.1, { type: 'sine', f: 3136, dur: 0.7, vol: 0.11 });
    E._tone(o, t + 0.1, { type: 'sine', f: 4186, dur: 0.5, vol: 0.05 });
  }],
};

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this._musicVol = 0.6;
    this._sfxVol = 0.8;
    this._muted = false;
    this._intensity = 0.5;
    this._insts = [];
    this._cur = null;
    this._trackName = null;
    this._pending = null;
    this._timer = null;
    this._sfxEnds = [];
    this._sfxLast = Object.create(null);
    this._motor = null;
    this._skid = null;
    this._motorLast = 0;
    this._skidLast = 0;
    this._resumeOnShow = false;
    this._tick = this._tick.bind(this);
    this._onVis = this._onVis.bind(this);
  }

  // ----------------------------------------------------------------- lifecycle
  init() {
    try {
      if (!this.ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return;
        try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { this.ctx = new AC(); }
        this._build();
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVis);
        // iOS unlock: play one silent sample inside the gesture.
        try {
          const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
          const s = this.ctx.createBufferSource();
          s.buffer = b; s.connect(this.ctx.destination); s.start(0);
        } catch (e) { /* ignore */ }
        if (this._pending) { const p = this._pending; this._pending = null; this.playMusic(p); }
      }
      if (this.ctx.state !== 'running' && !(typeof document !== 'undefined' && document.hidden)) {
        const p = this.ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* audio unavailable */ }
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }
  get muted() { return this._muted; }

  setMusicVolume(v) {
    this._musicVol = clamp01(v);
    if (this.ctx) this._musicBus.gain.setTargetAtTime(this._musicVol * MUSIC_TRIM, this.ctx.currentTime, 0.05);
  }
  setSfxVolume(v) {
    this._sfxVol = clamp01(v);
    if (this.ctx) this._sfxBus.gain.setTargetAtTime(this._sfxVol * SFX_TRIM, this.ctx.currentTime, 0.05);
  }
  setMuted(b) {
    this._muted = !!b;
    if (this.ctx) this._master.gain.setTargetAtTime(this._muted ? 0 : 1, this.ctx.currentTime, 0.03);
  }
  toggleMute() { this.setMuted(!this._muted); return this._muted; }

  _onVis() {
    const c = this.ctx;
    if (!c) return;
    try {
      if (document.hidden) {
        if (c.state === 'running') { this._resumeOnShow = true; c.suspend().catch(() => {}); }
      } else if (this._resumeOnShow) {
        this._resumeOnShow = false;
        c.resume().catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  _build() {
    const c = this.ctx;
    this._master = this._g(this._muted ? 0 : 1);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.001; lim.release.value = 0.1;
    comp.connect(lim); lim.connect(this._master); this._master.connect(c.destination);
    this._musicBus = this._g(this._musicVol * MUSIC_TRIM); this._musicBus.connect(comp);
    this._sfxBus = this._g(this._sfxVol * SFX_TRIM); this._sfxBus.connect(comp);

    // shared buffers
    const sr = c.sampleRate;
    this._noiseBuf = c.createBuffer(1, Math.floor(sr * 2), sr);
    const nd = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this._hallIR = this._makeIR(2.2, false);
    this._gatedIR = this._makeIR(0.3, true);
    this._shapeCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; this._shapeCurve[i] = Math.tanh(x * 2.5) / Math.tanh(2.5); }

    // sfx reverb
    this._sfxRev = c.createConvolver();
    this._sfxRev.buffer = this._hallIR;
    const rv = this._g(0.6); this._sfxRev.connect(rv); rv.connect(this._sfxBus);
  }

  _makeIR(sec, gated) {
    const c = this.ctx, sr = c.sampleRate, len = Math.max(1, Math.floor(sr * sec));
    const b = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const x = i / len;
        let env;
        if (gated) env = x < 0.82 ? 1 - 0.35 * x : (1 - x) / 0.18 * 0.7;
        else env = Math.pow(1 - x, 3.2) * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
        d[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return b;
  }

  // ----------------------------------------------------------------- node helpers
  _g(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _flt(type, f, Q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; }
  _pan(v) {
    if (this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = v; return p; }
    return this._g(1);
  }
  _env(p, t, peak, a, dur) {
    peak = Math.max(peak, 0.0002);
    p.setValueAtTime(EPS, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(EPS, t + Math.max(dur, a + 0.01));
  }
  _nsrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf; s.loop = true;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
    return s;
  }
  // generic pitched blip with optional exp sweep
  _tone(out, t, o) {
    const c = this.ctx, dur = o.dur || 0.2;
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.sweep || dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = c.createGain();
    this._env(g.gain, t, o.vol == null ? 0.5 : o.vol, o.attack || 0.003, dur);
    let n = osc;
    if (o.filter) { const f = this._flt('lowpass', o.filter, 0.7); osc.connect(f); n = f; }
    n.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.03);
  }
  // generic filtered noise burst with optional sweep and saturation
  _nz(out, t, o) {
    const dur = o.dur || 0.2;
    const src = this._nsrc(t, dur);
    const f = this._flt(o.type || 'bandpass', o.f || 1000, o.Q || 1);
    if (o.f1) {
      f.frequency.setValueAtTime(o.f, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.sweep || dur));
    }
    const g = this.ctx.createGain();
    this._env(g.gain, t, o.vol == null ? 0.5 : o.vol, o.attack || 0.002, dur);
    src.connect(f);
    let n = f;
    if (o.shape) { const ws = this.ctx.createWaveShaper(); ws.curve = this._shapeCurve; f.connect(ws); n = ws; }
    n.connect(g); g.connect(out);
  }
  // amplitude-modulated electric buzz (EMP)
  _buzz(out, t, dur) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(58, t);
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.setValueAtTime(117, t);
    const am = c.createGain(); am.gain.value = 0.5;
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.setValueAtTime(22, t);
    lfo.frequency.linearRampToValueAtTime(9, t + dur);
    const lg = this._g(0.5); lfo.connect(lg); lg.connect(am.gain);
    const bp = this._flt('bandpass', 1400, 1.5);
    bp.frequency.setValueAtTime(1800, t); bp.frequency.exponentialRampToValueAtTime(350, t + dur);
    const g = c.createGain(); this._env(g.gain, t, 0.35, 0.01, dur);
    o.connect(am); o2.connect(am); am.connect(bp); bp.connect(g); g.connect(out);
    for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + dur + 0.03); }
  }

  // ----------------------------------------------------------------- music: tracks
  playMusic(track) {
    if (!SONGS[track]) return;
    if (!this.ctx) { this._pending = track; return; }
    try {
      if (track === this._trackName && this._cur) return;
      const stinger = !SONGS[track].loop;
      const hadCur = !!this._cur;
      this._fadeOutCurrent(stinger ? 0.7 : 1.0);
      const inst = this._makeTrack(track);
      const now = this.ctx.currentTime;
      const fin = !hadCur || stinger ? 0.04 : 1.0;
      inst.fade.gain.setValueAtTime(0, now);
      inst.fade.gain.linearRampToValueAtTime(1, now + fin);
      this._cur = inst;
      this._trackName = track;
      this._insts.push(inst);
      this._startTimer();
    } catch (e) { /* ignore */ }
  }

  stopMusic() {
    this._pending = null;
    if (!this.ctx) return;
    try { this._fadeOutCurrent(0.8); } catch (e) { /* ignore */ }
    this._trackName = null;
  }

  setIntensity(x) {
    this._intensity = clamp01(x);
    if (!this.ctx) return;
    try {
      for (const tr of this._insts) if (tr.song.intensity && !tr.dieAt) this._applyIntensity(tr, false);
    } catch (e) { /* ignore */ }
  }

  _fadeOutCurrent(sec) {
    const tr = this._cur;
    if (!tr) return;
    const now = this.ctx.currentTime, gp = tr.fade.gain;
    gp.cancelScheduledValues(now);
    gp.setValueAtTime(gp.value, now);
    gp.linearRampToValueAtTime(0, now + sec);
    tr.dieAt = now + sec + 0.05;
    this._cur = null;
  }

  _makeTrack(name) {
    const c = this.ctx, song = SONGS[name], mix = song.mix;
    const tr = {
      name, song, step: 0, stepDur: 60 / song.bpm / 4, nextTime: c.currentTime + 0.06,
      done: false, dieAt: 0, ch: {}, tones: {}, lv: mix, lastLead: null, duckDepth: mix.duck,
    };
    const fade = this._g(0); fade.connect(this._musicBus); tr.fade = fade;
    const send = (src, dest, amt) => { const s = this._g(amt); src.connect(s); s.connect(dest); };

    // effects
    const rev = c.createConvolver(); rev.buffer = this._hallIR; rev.connect(fade);
    const gated = c.createConvolver(); gated.buffer = this._gatedIR;
    const gOut = this._g(0.8); gated.connect(gOut); gOut.connect(fade);
    const dIn = this._g(1), dl = c.createDelay(2), dr = c.createDelay(2);
    dl.delayTime.value = dr.delayTime.value = tr.stepDur * 3; // dotted 8th
    const damp = this._flt('lowpass', 3200, 0.5), fbR = this._g(0.42), fbL = this._g(0.42);
    dIn.connect(dl); dl.connect(damp); damp.connect(fbR); fbR.connect(dr); dr.connect(fbL); fbL.connect(dl);
    const pL = this._pan(-0.75), pR = this._pan(0.75), dWet = this._g(0.7);
    dl.connect(pL); dr.connect(pR); pL.connect(dWet); pR.connect(dWet); dWet.connect(fade);
    send(dWet, rev, 0.2);

    // channels
    const mk = (key, level, dest) => { const g = this._g(level); g.connect(dest || fade); tr.ch[key] = g; return g; };
    const duck = this._g(1); duck.connect(fade); tr.duck = duck;
    send(mk('drums', 0.8), rev, 0.05);
    const sn = mk('snare', 0.7); send(sn, gated, 0.6); send(sn, rev, 0.1);
    mk('hat16', mix.hat16);
    send(mk('perc', mix.perc), rev, 0.12);
    const bt = this._flt('lowpass', 2000, 0.6); bt.connect(duck); tr.tones.bass = bt;
    const pt = this._flt('lowpass', 3000, 0.5); pt.connect(duck); send(pt, rev, 0.4); tr.tones.pad = pt;
    const at = this._flt('lowpass', 4000, 0.5); at.connect(duck); send(at, dIn, 0.45); send(at, rev, 0.12); tr.tones.arp = at;
    mk('bass', mix.bass, bt);
    mk('pad', mix.pad, pt);
    mk('arp', mix.arp, at);
    const ld = mk('lead', mix.lead); send(ld, dIn, 0.3); send(ld, rev, 0.3);
    send(mk('fx', 0.35), rev, 0.5);

    if (song.intensity) this._applyIntensity(tr, true);
    else {
      const tn = song.tones;
      bt.frequency.value = tn.bass; pt.frequency.value = tn.pad; at.frequency.value = tn.arp;
    }
    return tr;
  }

  _applyIntensity(tr, immediate) {
    const I = this._intensity, now = this.ctx.currentTime, lv = tr.lv;
    const set = (p, v) => { if (immediate) p.setValueAtTime(v, now); else p.setTargetAtTime(v, now, 0.4); };
    set(tr.ch.lead.gain, lv.lead * smooth(0.35, 0.65, I));
    set(tr.ch.hat16.gain, lv.hat16 * smooth(0.15, 0.45, I));
    set(tr.ch.perc.gain, lv.perc * smooth(0.55, 0.85, I));
    set(tr.ch.arp.gain, lv.arp * (0.55 + 0.45 * I));
    set(tr.tones.arp.frequency, 1400 * Math.pow(10, I));
    set(tr.tones.pad.frequency, 1000 * Math.pow(8, I));
    set(tr.tones.bass.frequency, 450 * Math.pow(8, I));
  }

  _startTimer() {
    if (this._timer == null) this._timer = setInterval(this._tick, TICK_MS);
    this._tick();
  }

  _tick() {
    const c = this.ctx;
    if (!c) return;
    try {
      const now = c.currentTime, ahead = now + LOOKAHEAD;
      let busy = false;
      for (let i = this._insts.length - 1; i >= 0; i--) {
        const tr = this._insts[i];
        if (tr.dieAt && now >= tr.dieAt) {
          try { tr.fade.disconnect(); } catch (e) { /* ignore */ }
          this._insts.splice(i, 1);
          continue;
        }
        busy = busy || !!tr.dieAt;
        if (tr.done) continue;
        busy = true;
        // fell behind (timer throttled while running): skip silently to keep time
        if (tr.nextTime < now - 0.1) {
          const skip = Math.ceil((now - tr.nextTime) / tr.stepDur);
          tr.step += skip; tr.nextTime += skip * tr.stepDur;
        }
        while (tr.nextTime < ahead && !tr.done) {
          this._scheduleStep(tr, tr.nextTime);
          tr.step++;
          tr.nextTime += tr.stepDur;
        }
      }
      if (!busy && this._timer != null) { clearInterval(this._timer); this._timer = null; }
    } catch (e) { /* ignore */ }
  }

  _scheduleStep(tr, t) {
    const song = tr.song;
    let k = tr.step, tl;
    if (k < song._intro.steps) tl = song._intro;
    else if (song._loop) { tl = song._loop; k = (k - song._intro.steps) % song._loop.steps; }
    else { tr.done = true; return; }
    let e = tl.list[0];
    for (const x of tl.list) if (k >= x.start) e = x;
    const local = k - e.start, bar = local >> 4, s = local & 15, sec = e.sec;
    const p = { sec, name: e.name, bar, s, t, sd: tr.stepDur, chord: sec._chords[bar % sec._chords.length] };
    try { song.play(this, tr, p); } catch (err) { /* keep the sequencer alive */ }
  }

  // ----------------------------------------------------------------- music: voices
  _kick(tr, t, vel, chKey) {
    const c = this.ctx, out = tr.ch[chKey || 'drums'];
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.002);
    g.gain.setTargetAtTime(vel * 0.6, t + 0.002, 0.08);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.42);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.45);
    const k = c.createOscillator(), kg = c.createGain();
    k.type = 'square';
    k.frequency.setValueAtTime(1800, t); k.frequency.exponentialRampToValueAtTime(250, t + 0.012);
    kg.gain.setValueAtTime(vel * 0.16, t); kg.gain.exponentialRampToValueAtTime(EPS, t + 0.016);
    k.connect(kg); kg.connect(out); k.start(t); k.stop(t + 0.02);
    if (!chKey && tr.duck) {
      const d = tr.duck.gain;
      d.cancelScheduledValues(t);
      d.setTargetAtTime(tr.duckDepth, t, 0.004);
      d.setTargetAtTime(1, t + 0.05, 0.075);
    }
  }

  _snare(tr, t, vel) {
    const out = tr.ch.snare;
    this._nz(out, t, { dur: 0.2, vol: vel * 0.8, type: 'bandpass', f: 1800, Q: 0.6 });
    this._nz(out, t, { dur: 0.06, vol: vel * 0.35, type: 'highpass', f: 6000 });
    this._tone(out, t, { type: 'triangle', f: 230, f1: 160, sweep: 0.05, dur: 0.1, vol: vel * 0.55 });
  }

  _clap(tr, t, vel) {
    const src = this._nsrc(t, 0.2), f = this._flt('bandpass', 1400, 1.2), g = this.ctx.createGain();
    const v = vel * 0.5;
    g.gain.setValueAtTime(EPS, t);
    for (let i = 0; i < 3; i++) {
      const ti = t + i * 0.011;
      g.gain.setValueAtTime(v, ti);
      g.gain.exponentialRampToValueAtTime(v * 0.2, ti + 0.009);
    }
    g.gain.setValueAtTime(v, t + 0.034);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.18);
    src.connect(f); f.connect(g); g.connect(tr.ch.perc);
  }

  _hat(tr, t, vel, open, chKey) {
    this._nz(tr.ch[chKey], t, { dur: open ? 0.24 : 0.045, vol: vel * 0.38, type: 'highpass', f: open ? 6500 : 7500, Q: 0.7, attack: 0.001 });
  }

  _shaker(tr, t, vel) {
    this._nz(tr.ch.perc, t, { dur: 0.06, vol: vel * 0.22, type: 'bandpass', f: 9000, Q: 1.2, attack: 0.012 });
  }

  _tom(tr, t, midi, vel) {
    const f = mtof(midi);
    this._tone(tr.ch.snare, t, { type: 'sine', f: f * 1.7, f1: f, sweep: 0.12, dur: 0.4, vol: vel * 0.8 });
    this._nz(tr.ch.snare, t, { dur: 0.05, vol: vel * 0.2, type: 'bandpass', f: f * 4, Q: 1 });
  }

  _crash(tr, t, vel) {
    this._nz(tr.ch.drums, t, { dur: 1.8, vol: vel * 0.22, type: 'highpass', f: 5500, Q: 0.5 });
    this._nz(tr.ch.drums, t, { dur: 0.9, vol: vel * 0.1, type: 'bandpass', f: 9000, Q: 0.8 });
  }

  _riser(tr, t, dur) {
    const src = this._nsrc(t, dur + 0.1), f = this._flt('bandpass', 400, 3), g = this.ctx.createGain();
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.95);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.05);
    src.connect(f); f.connect(g); g.connect(tr.ch.fx);
  }

  _sweep(tr, t, f0, f1, dur) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator();
    o.type = 'sawtooth'; o2.type = 'sawtooth'; o2.detune.value = 15;
    for (const x of [o, o2]) { x.frequency.setValueAtTime(f0, t); x.frequency.exponentialRampToValueAtTime(f1, t + dur); }
    const f = this._flt('lowpass', 2000, 4);
    f.frequency.setValueAtTime(2500, t); f.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = c.createGain(); this._env(g.gain, t, 0.35, 0.05, dur);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(tr.ch.fx);
    for (const x of [o, o2]) { x.start(t); x.stop(t + dur + 0.05); }
  }

  _bass(tr, t, midi, dur, vel = 1, long = false) {
    const c = this.ctx, f = mtof(midi);
    const flt = this._flt('lowpass', 1000, long ? 2 : 5);
    flt.frequency.setValueAtTime(long ? 1800 : 2600, t);
    flt.frequency.exponentialRampToValueAtTime(long ? 300 : 420, t + (long ? 0.6 : 0.09));
    const g = c.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.setTargetAtTime(vel * 0.7, t + 0.004, 0.05);
    g.gain.setTargetAtTime(EPS, t + dur, long ? 0.08 : 0.015);
    const end = t + dur + (long ? 0.5 : 0.12);
    for (const d of [-7, 7]) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
      o.connect(flt); o.start(t); o.stop(end);
    }
    if (long) {
      const sub = c.createOscillator(), sg = this._g(0.6);
      sub.type = 'sine'; sub.frequency.value = f;
      sub.connect(sg); sg.connect(g); sub.start(t); sub.stop(end);
    }
    flt.connect(g); g.connect(tr.ch.bass);
  }

  _arp(tr, t, midi, dur, vel) {
    const c = this.ctx, f = mtof(midi);
    const o = c.createOscillator(), o2 = c.createOscillator();
    o.type = 'square'; o.frequency.value = f;
    o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 9;
    const flt = this._flt('lowpass', 3500, 2);
    flt.frequency.setValueAtTime(4500, t); flt.frequency.exponentialRampToValueAtTime(1200, t + dur * 1.5);
    const g = c.createGain(), g2 = this._g(0.5);
    this._env(g.gain, t, Math.max(0.05, vel), 0.002, dur * 1.6);
    tr.arpSide = -(tr.arpSide || 0.3);
    const pn = this._pan(tr.arpSide);
    o.connect(flt); o2.connect(g2); g2.connect(flt); flt.connect(g); g.connect(pn); pn.connect(tr.ch.arp);
    o.start(t); o2.start(t); o.stop(t + dur * 1.7); o2.stop(t + dur * 1.7);
  }

  _pad(tr, t, notes, dur, o = {}) {
    const c = this.ctx;
    const rel = o.release == null ? 0.6 : o.release, vol = (o.vol == null ? 1 : o.vol) * 0.14;
    const a = Math.min(o.attack == null ? 0.3 : o.attack, dur * 0.5);
    const cut = o.cut || 2600;
    const flt = this._flt('lowpass', cut, 0.8);
    if (o.stab) { flt.frequency.setValueAtTime(cut * 2, t); flt.frequency.exponentialRampToValueAtTime(cut * 0.6, t + 0.35); }
    const g = c.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + dur);
    g.gain.setTargetAtTime(EPS, t + dur, rel / 3);
    const pl = this._pan(-0.85), pr = this._pan(0.85);
    pl.connect(flt); pr.connect(flt); flt.connect(g); g.connect(tr.ch.pad);
    const dets = [-11, 0, 11], end = t + dur + rel + 0.1;
    for (const n of notes.slice(0, 5)) {
      const f = mtof(n);
      for (let i = 0; i < 3; i++) {
        const osc = c.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = dets[i] + rand(-2, 2);
        osc.connect(i === 0 ? pl : i === 2 ? pr : flt);
        osc.start(t); osc.stop(end);
      }
    }
  }

  _lead(tr, t, midi, dur, vel = 1, o = {}, glide = false) {
    const c = this.ctx, f = mtof(midi);
    const prev = tr.lastLead;
    const doGlide = glide && prev && t - prev.end < 0.1;
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = o.soft ? 'triangle' : 'sawtooth';
    o2.type = 'square'; o2.detune.value = 6;
    for (const x of [o1, o2]) {
      if (doGlide) { x.frequency.setValueAtTime(mtof(prev.midi), t); x.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
      else x.frequency.setValueAtTime(f, t);
    }
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 5.6;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(o.vib || 14, t + Math.min(0.35, dur * 0.6) + 0.01);
    lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
    const cut = o.soft ? 2200 : o.bright ? 5000 : 3800;
    const flt = this._flt('lowpass', cut, 2);
    flt.frequency.setValueAtTime(cut * 0.45, t); flt.frequency.exponentialRampToValueAtTime(cut, t + 0.06);
    const m2 = this._g(o.soft ? 0.25 : 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(vel, t + (doGlide ? 0.004 : 0.012));
    g.gain.setTargetAtTime(vel * 0.75, t + 0.02, 0.1);
    g.gain.setTargetAtTime(EPS, t + dur, 0.07);
    o1.connect(flt); o2.connect(m2); m2.connect(flt); flt.connect(g); g.connect(tr.ch.lead);
    const end = t + dur + 0.45;
    for (const x of [o1, o2, lfo]) { x.start(t); x.stop(end); }
    tr.lastLead = { midi, end: t + dur / 0.96 };
  }

  // ----------------------------------------------------------------- sfx
  sfx(name, opts = {}) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const def = SFX[name];
    if (!def) return;
    try {
      const o = opts || {};
      const now = c.currentTime;
      const last = this._sfxLast[name];
      if (last != null && now - last < SFX_RATE && now >= last) return;
      const dist = Math.max(0, +o.dist || 0);
      if (dist > 150) return;
      let ends = this._sfxEnds;
      if (ends.length >= MAX_SFX) { ends = this._sfxEnds = ends.filter((e) => e > now); if (ends.length >= MAX_SFX) return; }
      let vol = o.volume == null ? 1 : +o.volume;
      if (!(vol > 0)) return;
      vol = Math.min(vol, 2) / (1 + dist / 25);
      if (dist > 120) vol *= (150 - dist) / 30;
      this._sfxLast[name] = now;
      ends.push(now + def[0] + 0.05);

      const t = now + 0.005;
      const g = this._g(vol);
      let n = g;
      if (dist > 15) { const lp = this._flt('lowpass', 18000 / (1 + (dist - 15) / 20), 0.7); g.connect(lp); n = lp; }
      const pan = Math.max(-1, Math.min(1, +o.pan || 0));
      if (pan) { const p = this._pan(pan); n.connect(p); n = p; }
      n.connect(this._sfxBus);
      if (def[1] > 0) { const s = this._g(Math.min(1, def[1] * (1 + dist / 60))); g.connect(s); s.connect(this._sfxRev); }
      def[2](this, g, t, o);
    } catch (e) { /* ignore */ }
  }

  // ----------------------------------------------------------------- continuous loops
  _ensureMotor() {
    if (this._motor) return this._motor;
    const c = this.ctx, now = c.currentTime;
    const out = this._g(0); out.connect(this._sfxBus);
    const lp = this._flt('lowpass', 900, 1.5); lp.connect(out);
    const mkO = (type, f, gain, dest) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f;
      const g = this._g(gain); o.connect(g); g.connect(dest); o.start(now);
      return [o, g];
    };
    const [o1] = mkO('sawtooth', 50, 0.3, lp);
    const [o2] = mkO('square', 100, 0.12, lp);
    const [wh] = mkO('sine', 300, 0.2, out);       // inverter whine
    const [wh2] = mkO('triangle', 450, 0.06, out); // whine harmonic
    const [bo, bg] = mkO('triangle', 800, 0, out); // boost harmonic
    bg.gain.value = 0;
    const flut = c.createOscillator(); flut.frequency.value = 23;
    const fg = this._g(7); flut.connect(fg); fg.connect(o1.detune); fg.connect(wh.detune); flut.start(now);
    const ns = c.createBufferSource(); ns.buffer = this._noiseBuf; ns.loop = true;
    const bp = this._flt('bandpass', 1200, 1.2), ng = this._g(0);
    ns.connect(bp); bp.connect(ng); ng.connect(out); ns.start(now);
    this._motor = { out, lp, o1, o2, wh, wh2, bo, bg, bp, ng, srcs: [o1, o2, wh, wh2, bo, flut, ns] };
    return this._motor;
  }

  setEngine(speed01, throttle01, boost) {
    const c = this.ctx;
    if (!c) return;
    try {
      const now = c.currentTime;
      if (this._motor && now - this._motorLast < 0.03) return;
      this._motorLast = now;
      const s = clamp01(speed01), th = clamp01(throttle01);
      const b = typeof boost === 'number' ? clamp01(boost) : (boost ? 1 : 0);
      const m = this._ensureMotor(), tc = 0.06;
      const f = 42 + s * 210 + th * 12;
      const w = 280 + s * 2400 + th * 120 + b * 300;
      m.o1.frequency.setTargetAtTime(f, now, tc);
      m.o2.frequency.setTargetAtTime(f * 2.003, now, tc);
      m.wh.frequency.setTargetAtTime(w, now, tc);
      m.wh2.frequency.setTargetAtTime(w * 1.5, now, tc);
      m.bo.frequency.setTargetAtTime(w * 2.01, now, tc);
      m.lp.frequency.setTargetAtTime(450 + s * 1800 + th * 1600, now, tc);
      m.out.gain.setTargetAtTime(0.05 + th * 0.11 + s * 0.06, now, 0.08);
      m.bg.gain.setTargetAtTime(b * 0.07, now, 0.1);
      m.ng.gain.setTargetAtTime(b * 0.2, now, 0.1);
      m.bp.frequency.setTargetAtTime(900 + s * 3000, now, tc);
    } catch (e) { /* ignore */ }
  }

  _ensureSkid() {
    if (this._skid) return this._skid;
    const c = this.ctx, now = c.currentTime;
    const out = this._g(0); out.connect(this._sfxBus);
    const ns = c.createBufferSource(); ns.buffer = this._noiseBuf; ns.loop = true;
    const b1 = this._flt('bandpass', 2300, 9), b2 = this._flt('bandpass', 3500, 11);
    const g1 = this._g(1.2), g2 = this._g(0.8);
    ns.connect(b1); ns.connect(b2); b1.connect(g1); b2.connect(g2); g1.connect(out); g2.connect(out);
    const sq = c.createOscillator(); sq.type = 'triangle'; sq.frequency.value = 1750;
    const sqg = this._g(0.05); sq.connect(sqg); sqg.connect(out);
    const lfo = c.createOscillator(); lfo.frequency.value = 9;
    const lg = this._g(220); lfo.connect(lg); lg.connect(b1.frequency); lg.connect(b2.frequency);
    const lg2 = this._g(60); lfo.connect(lg2); lg2.connect(sq.frequency);
    ns.start(now); sq.start(now); lfo.start(now);
    this._skid = { out, srcs: [ns, sq, lfo] };
    return this._skid;
  }

  setSkid(amount01) {
    const c = this.ctx;
    if (!c) return;
    try {
      const a = clamp01(amount01);
      if (!this._skid && a <= 0.001) return;
      const now = c.currentTime;
      if (this._skid && now - this._skidLast < 0.03 && a > 0.001) return;
      this._skidLast = now;
      this._ensureSkid().out.gain.setTargetAtTime(a * 0.45, now, 0.05);
    } catch (e) { /* ignore */ }
  }

  stopLoops() {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime;
    for (const key of ['_motor', '_skid']) {
      const m = this[key];
      if (!m) continue;
      this[key] = null;
      try {
        m.out.gain.cancelScheduledValues(now);
        m.out.gain.setTargetAtTime(0, now, 0.04);
        for (const s of m.srcs) { try { s.stop(now + 0.3); } catch (e) { /* ignore */ } }
        setTimeout(() => { try { m.out.disconnect(); } catch (e) { /* ignore */ } }, 400);
      } catch (e) { /* ignore */ }
    }
  }
}

export default AudioEngine;
