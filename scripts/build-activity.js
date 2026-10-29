// Compile l'interface de l'Activity (Plinko) : bundle JS + polices dans activity/dist.
// Lance automatiquement par Docker et par "npm start".
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'activity', 'dist');

if (process.argv.includes('--if-missing') && fs.existsSync(path.join(DIST, 'app.js'))) process.exit(0);

let esbuild;
try {
    esbuild = require('esbuild');
} catch {
    console.warn('[build] esbuild absent (npm install sans --omit=dev) : interface Plinko non compilee');
    process.exit(0);
}

fs.mkdirSync(path.join(DIST, 'fonts'), { recursive: true });
const fonts = [
    ['@fontsource/shrikhand/files/shrikhand-latin-400-normal.woff2', 'shrikhand.woff2'],
    ['@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2', 'bricolage.woff2'],
];
for (const [src, dst] of fonts) fs.copyFileSync(require.resolve(src), path.join(DIST, 'fonts', dst));

esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'activity', 'src', 'main.js')],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    minify: true,
    sourcemap: false,
    outfile: path.join(DIST, 'app.js'),
    logLevel: 'warning',
});
console.log('[build] interface Plinko compilee -> activity/dist');
