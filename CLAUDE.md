# CLAUDE.md

## Standing instruction from the owner
- **Browser games → always publish a playable Artifact.** Whenever you build or substantially update an HTML/JS (three.js, canvas, WebGL) game, also publish it as a claude.ai Artifact so it can be played right away on phone or desktop, and give the link. Don't wait to be asked.
  - For this repo: `npm install && npm run build:artifact` bundles everything (three.js included) into `dist/neon-wreckers-2086.html`; publish that file and update the same artifact URL: https://claude.ai/artifact/5CKPf9P9xdLkAEqr4wiNmS
  - Artifact sandbox rules to respect: no `alert`/`confirm`/`prompt` (use in-page confirms), no `window.open`/print/downloads, wrap all storage in try/catch, start audio from a user gesture, no external scripts except allowlisted CDNs (prefer inlining via the build).

## Project notes
- Static site, no build needed for local play: `python3 -m http.server 8000`. three.js is vendored in `vendor/` and mapped with an import map in `index.html`.
- Balance/tuning lives in `js/data.js` (parts, weapons, divisions) plus `DMG_SCALE` and ram constants in `js/battle.js`.
