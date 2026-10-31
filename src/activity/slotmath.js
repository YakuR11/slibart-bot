// Moteur des slots facon "video slot" (grille 6 x 5, gains en paquets, cascades).
// - 8 symboles identiques ou plus n'importe ou sur la grille = gain (8-9, 10-11, 12+)
// - les symboles gagnants explosent, le reste tombe, de nouveaux symboles arrivent (cascade)
// - bombes multiplicatrices : additionnees puis appliquees au gain de la cascade
// - 4 slips (scatter) ou plus = 10 tours gratuits ; pendant les tours gratuits, les bombes
//   s'additionnent dans un multiplicateur qui monte jusqu'a la fin du bonus
// - gain plafonne a MAX_WIN fois la mise
// Tout est tire ici, cote serveur. Le client ne fait que rejouer l'animation.
const crypto = require('node:crypto');

const COLS = 6;
const ROWS = 5;
const MAX_WIN = 5000;
const FS_START = 10;
const FS_RETRIGGER = 5;

// a cerise, b citron, c raisin, d pasteque, e cloche, f diamant, g couronne, h 7 ; s = slip (scatter) ; xN = bombe
// pays[0] = 8-9 symboles, pays[1] = 10-11, pays[2] = 12+ (en multiples de la mise)
const SYMBOLS = [
    { id: 'a', w: 22, pays: [0.25, 0.75, 2] },
    { id: 'b', w: 20, pays: [0.4, 0.9, 4] },
    { id: 'c', w: 18, pays: [0.5, 1, 5] },
    { id: 'd', w: 16, pays: [0.8, 1.2, 8] },
    { id: 'e', w: 12, pays: [1, 1.5, 10] },
    { id: 'f', w: 10, pays: [1.5, 2, 12] },
    { id: 'g', w: 8, pays: [2, 5, 15] },
    { id: 'h', w: 6, pays: [8, 20, 40] },
];
const SCATTER = 's';
const SCATTER_PAY = { 4: 3, 5: 5, 6: 100 }; // 6+ -> x100
// reglages verifies par simulation (voir scripts/slots-sim.js) : RTP ~95 % en jeu normal et a l'achat du bonus
const TUNE = {
    payScale: { base: 0.47, fs: 1.05 },
    scatterW: { base: 2.2, fs: 2.2 },
    bombW: { base: 1.1, fs: 3.2 },
};
const BOMBS = [
    [2, 300], [3, 220], [4, 160], [5, 130], [6, 90], [8, 60], [10, 45], [12, 30], [15, 20], [20, 14], [25, 9], [50, 4], [100, 1],
];
const BOMB_TOTAL = BOMBS.reduce((a, b) => a + b[1], 0);

const rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

function drawBomb() {
    let n = rnd() * BOMB_TOTAL;
    for (const [v, w] of BOMBS) if ((n -= w) < 0) return v;
    return 2;
}

function drawCell(mode) {
    const sw = TUNE.scatterW[mode];
    const bw = TUNE.bombW[mode];
    const total = SYMBOLS.reduce((a, s) => a + s.w, 0) + sw + bw;
    let n = rnd() * total;
    for (const s of SYMBOLS) if ((n -= s.w) < 0) return s.id;
    if ((n -= sw) < 0) return SCATTER;
    return `x${drawBomb()}`;
}

const isBomb = (c) => c[0] === 'x';
const bombValue = (c) => Number(c.slice(1));
const PAY = Object.fromEntries(SYMBOLS.map((s) => [s.id, s.pays]));

/** grille en colonnes : grid[col][row], row 0 en haut */
function newGrid(mode) {
    return Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => drawCell(mode)));
}

function countScatters(grid) {
    let n = 0;
    for (const col of grid) for (const c of col) if (c === SCATTER) n++;
    return n;
}

function evaluate(grid, payScale) {
    const pos = {};
    grid.forEach((col, x) => col.forEach((c, y) => {
        if (PAY[c]) (pos[c] ||= []).push([x, y]);
    }));
    const wins = [];
    for (const [sym, cells] of Object.entries(pos)) {
        const n = cells.length;
        if (n < 8) continue;
        const p = PAY[sym][n >= 12 ? 2 : n >= 10 ? 1 : 0] * payScale;
        wins.push({ sym, count: n, pay: p, cells });
    }
    return wins;
}

/** enleve les cases gagnantes, fait tomber le reste, complete par le haut */
function tumble(grid, wins, mode) {
    const gone = new Set();
    for (const w of wins) for (const [x, y] of w.cells) gone.add(`${x}:${y}`);
    return grid.map((col, x) => {
        const keep = col.filter((_, y) => !gone.has(`${x}:${y}`));
        const fresh = Array.from({ length: ROWS - keep.length }, () => drawCell(mode));
        return [...fresh, ...keep];
    });
}

/**
 * Un tour (avec toutes ses cascades). Retourne les etapes pour l'animation et le gain en x mise.
 * bombMode 'spin' : les bombes de ce tour multiplient son gain (jeu normal)
 * bombMode 'acc'  : les bombes s'ajoutent au multiplicateur du bonus (tours gratuits)
 */
function playSpin(mode, { payScale = TUNE.payScale[mode] } = {}) {
    let grid = newGrid(mode);
    const steps = [];
    let base = 0;
    for (let guard = 0; guard < 40; guard++) {
        const wins = evaluate(grid, payScale);
        steps.push({ grid, wins: wins.map((w) => ({ sym: w.sym, count: w.count, pay: round2(w.pay), cells: w.cells })) });
        if (!wins.length) break;
        base += wins.reduce((a, w) => a + w.pay, 0);
        grid = tumble(grid, wins, mode);
    }
    const last = steps[steps.length - 1].grid;
    // les bombes comptent si le tour a gagne quelque chose
    let bombs = 0;
    if (base > 0) for (const col of last) for (const c of col) if (isBomb(c)) bombs += bombValue(c);
    const scatters = countScatters(steps[0].grid);
    return { steps, base: round2(base), bombs, scatters };
}

const round2 = (v) => Math.round(v * 100) / 100;

/** tours gratuits : le multiplicateur du bonus s'accumule */
function playFreeSpins(count, opts) {
    const spins = [];
    let left = count;
    let acc = 0;
    let total = 0;
    let played = 0;
    while (left > 0 && played < 60) {
        left--;
        played++;
        const s = playSpin('fs', opts);
        acc += s.bombs;
        const win = s.base * (acc > 0 && s.base > 0 ? acc : 1);
        total += win;
        let extra = 0;
        if (s.scatters >= 3) {
            extra = FS_RETRIGGER;
            left += extra;
        }
        spins.push({ ...s, mult: acc, win: round2(win), extra });
        if (total >= MAX_WIN) break;
    }
    return { spins, total: round2(Math.min(total, MAX_WIN)) };
}

/**
 * Un tour complet en x mise. buy = true : bonus achete (le tour de base n'est qu'un declencheur garanti).
 * Retourne { spin, scatterPay, fs, total }
 */
function play({ buy = false, opts = {} } = {}) {
    let spin;
    if (buy) {
        // grille de depart avec 4 slips garantis, sans gain de base
        spin = playSpin('base', opts);
        const g = spin.steps[0].grid.map((c) => [...c]);
        const spots = [];
        while (spots.length < 4) {
            const k = Math.floor(rnd() * COLS * ROWS);
            if (!spots.includes(k)) spots.push(k);
        }
        for (const k of spots) g[k % COLS][Math.floor(k / COLS)] = SCATTER;
        spin = { steps: [{ grid: g, wins: [] }], base: 0, bombs: 0, scatters: countScatters(g) };
    } else {
        spin = playSpin('base', opts);
    }
    const mult = spin.bombs > 0 && spin.base > 0 ? spin.bombs : 1;
    const baseWin = spin.base * mult;
    const sc = spin.scatters;
    const scatterPay = buy ? 0 : sc >= 6 ? SCATTER_PAY[6] : SCATTER_PAY[sc] || 0;
    const fs = sc >= 4 ? playFreeSpins(FS_START, opts) : null;
    const total = round2(Math.min(MAX_WIN, baseWin + scatterPay + (fs ? fs.total : 0)));
    return { spin: { ...spin, mult, win: round2(baseWin) }, scatterPay, fs, total };
}

module.exports = { COLS, ROWS, MAX_WIN, SYMBOLS, SCATTER, SCATTER_PAY, FS_START, FS_RETRIGGER, TUNE, play, playSpin, playFreeSpins };
