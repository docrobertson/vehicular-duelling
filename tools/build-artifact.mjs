// Bundles the whole game (three.js included) into ONE self-contained HTML file:
//   dist/neon-wreckers-2086.html
// Used for publishing as a claude.ai Artifact (sandboxed frame: no external scripts,
// no dialogs) and handy for sharing as a single file. Run: npm run build:artifact
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, 'vendor/three');

// Resolve the same bare specifiers the browser import map provides.
const threeAlias = {
  name: 'three-alias',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: resolve(vendor, 'build/three.module.min.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: resolve(vendor, 'examples/jsm', a.path.slice('three/addons/'.length)) }));
  },
};

const res = await build({
  entryPoints: [resolve(root, 'js/main.js')],
  bundle: true, minify: true, format: 'esm', target: 'es2020', write: false,
  plugins: [threeAlias], legalComments: 'none',
});
let js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'css/style.css'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"')).trim();
const fonts = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];

// The artifact host wraps this in its own <!doctype>/<head>/<body> skeleton,
// so emit page content only: title + meta first, then styles, markup, script.
const out = `<title>Neon Wreckers 2086</title>
<meta name="theme-color" content="#1a0638" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
${fonts}
<style>
:root { color-scheme: dark; }
body { background: #0d0420; }
${css}
</style>
${body}
<script type="module">
${js}
</script>
`;
mkdirSync(resolve(root, 'dist'), { recursive: true });
const outPath = resolve(root, 'dist/neon-wreckers-2086.html');
writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${(out.length / 1024).toFixed(0)} KB)`);
