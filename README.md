# NEON WRECKERS 2086

An 80s-flavoured vehicular combat arena game built with three.js, inspired by the car-duelling games of the 1980s.
It's the 2080s and civilisation has gone sideways, but the vibe is pure neon sunset: armed electric cars,
chrome, palm trees, and a pumping synthwave soundtrack.

**Play now:** [Neon Wreckers 2086 artifact](https://claude.ai/artifact/5CKPf9P9xdLkAEqr4wiNmS) (private to the owner unless shared). Single-file build: `npm install && npm run build:artifact` → `dist/neon-wreckers-2086.html`.

**Play locally:** serve the folder with any static web server and open `index.html`. ES modules won't load from
`file://`. For example:

```bash
python3 -m http.server 8000
```

Then browse to <http://localhost:8000>. It also works as-is on GitHub Pages (Settings → Pages → deploy from branch).
three.js is vendored in `vendor/`, so it needs no build step and no npm. It runs on desktop (keyboard/mouse or gamepad) and on mobile (touch controls, landscape or portrait).

## Modes
- **Quick Battle**: free-for-all (4 or 6 cars) or team battles (2v2, 3v3, 4v4) across three arenas, against Rookie, Pro or Legend AI.
- **Brackets**: your car's total cost sets its division (10k / 20k / 35k / 60k / Unlimited). Rival cars are auto-designed to a matching budget.
- **Road Campaign**: placeholder. Career stats and prize money are already saved for it.

## Garage (vehicle designer)
- **Bodies**: Mini, Sports Coupe, Sedan, SUV, Pickup and Van. Each has its own weight limit, space, armor cap, mount points and handling.
- **Power**: five electric motors (60–380 kW) and four battery packs (kWh drives the motor, boost and energy weapons).
- **Chassis**: tires (street, slicks, heavy-duty, solid), brakes (incl. ABS / carbon-ceramic) and suspension.
- **Armor**: four types with different damage resistances. Armor is set per location: front, back, left, right, top and under.
- **Weapons (14)**: MG, autocannon, rockets, seeker missiles, pulse and heavy lasers, flamethrower, grenade launcher, arc/EMP projector and ram spikes, plus mine, oil, spike and smoke droppers.
  - Each weapon tracks weight, cost, space, heat and ammo.
  - Each weapon only mounts where it makes sense. Top weapons go in a 360° turret.
- **Gear**: targeting computers (tighter spread, aim assist, missile lock) and accessories (heat sinks, fire suppression, overdrive capacitor, spoiler, jammer, crew armor, nanite repair, ammo bay).
- **Crew**: a driver with a perk, plus an optional gunner. The gunner auto-fires the turret and side guns, and takes the wheel if the driver dies.
- **Paint**: ten 80s paint jobs. Fitted weapons, armor plates and spoilers all show on the 3D model.

## Combat model
- **Physics**: bicycle-model car physics with load transfer, a friction circle, an electric torque curve and brake lock-up (ABS prevents it). Includes some arcade assists.
- **Damage by location**: once a side's armor is breached, hits damage the components on that side: weapons, motor, battery, driver, gunner and tires. Hits also damage the structure.
- **Heat**: weapons, boosting and fire add heat. Overheating jams heavy weapons and throttles the motor; sustained overheating damages components.
- **Battery energy**: running flat puts you in limp mode. EMP drains it.
- **Other systems**: fires, blown tires (sparking rims), oil slicks, spikes, mines and smoke (which breaks target locks).
- **Ramming**: damage depends on closing speed and mass.
- **Pickups**: repair, ammo and coolant/recharge.

## Controls
| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Drive / brake-reverse / steer | W S A D or arrow keys | RT / LT / left stick |
| Fire front | Space or left click | A |
| Fire turret | F or right click | B |
| Fire left / right | Q / E | LB / RB |
| Fire rear & droppers | R | X |
| Boost | Shift | Y |
| Handbrake | X | stick click |
| Cycle target / camera | Tab / C | Back / – |
| Pause / mute | Esc or P / M | Start |

## Code map
| File | Contents |
|---|---|
| `js/data.js` | All parts, weapons, divisions and arenas (the place to tune balance) |
| `js/design.js` | Design stats and validation, the AI auto-designer, factory presets |
| `js/physics.js` | Car dynamics and collision helpers |
| `js/vehicle.js` | Runtime damage, heat and energy model |
| `js/battle.js` | Match simulation, weapons, projectiles, drops, pickups, camera |
| `js/ai.js` | AI drivers |
| `js/carmodel.js`, `js/arena.js`, `js/effects.js`, `js/gfx.js` | Procedural graphics |
| `js/garage.js`, `js/hud.js`, `js/input.js`, `js/main.js` | UI, input, app shell |
| `js/audio.js` | Procedural Web Audio synthwave music and SFX (no audio files) |
