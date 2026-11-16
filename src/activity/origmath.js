// Maths des "Slip Originals" (Dice, Limbo, Keno, Tour du Slip, HiLo). Fonctions pures :
// le hasard est passe en parametre (rnd), donc tout se simule avec scripts/originals-sim.js.
const RTP = 0.98; // le casino garde 2 %
const MAX_MULT = 1000;
const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;

// ---------------------------------------------------------------------------
// DICE : un tirage de 0.00 a 99.99, tu choisis ta chance de gagner (1 a 95 %)
// ---------------------------------------------------------------------------
const DICE_MIN = 1;
const DICE_MAX = 95;
const diceChance = (c) => Math.min(DICE_MAX, Math.max(DICE_MIN, Math.round(Number(c) * 100) / 100 || 50));
const diceMult = (chance) => Math.floor((RTP * 100 / chance) * 10000 + 1e-6) / 10000;
function dice(rnd, chance, over) {
    const roll = Math.floor(rnd() * 10000) / 100;
    // "au-dessus" : les c % du haut ; "en dessous" : les c % du bas
    const won = over ? roll >= 100 - chance - 1e-9 : roll < chance - 1e-9;
    return { roll, won, mult: diceMult(chance), line: over ? Math.round((100 - chance) * 100) / 100 : chance };
}

// ---------------------------------------------------------------------------
// LIMBO : tu vises un multiplicateur, le tirage doit monter au moins jusque-la
// ---------------------------------------------------------------------------
const LIMBO_MIN = 1.01;
const limboTarget = (t) => Math.min(MAX_MULT, Math.max(LIMBO_MIN, floor2(Number(t) || 2)));
function limbo(rnd, target) {
    const u = 1 - rnd(); // ]0, 1]
    const result = Math.max(1, Math.min(1_000_000, floor2(RTP / u)));
    return { result, won: result >= target };
}

// ---------------------------------------------------------------------------
// KENO : 40 numeros, tu en coches 1 a 10, le serveur en tire 10
// ---------------------------------------------------------------------------
const KENO_N = 40;
const KENO_DRAW = 10;
const KENO_RISKS = { low: { alpha: 0.55, from: 0.2 }, medium: { alpha: 0.8, from: 0.3 }, high: { alpha: 1, from: 0.4 } };
const comb = (n, k) => {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
};
/** probabilite d'avoir k bons numeros en en cochant n */
const kenoProb = (n, k) => (comb(n, k) * comb(KENO_N - n, KENO_DRAW - k)) / comb(KENO_N, KENO_DRAW);
const nice = (x) => (x >= 100 ? Math.floor(x) : x >= 10 ? Math.floor(x * 10) / 10 : floor2(x));
const kenoCache = new Map();
/** table des gains : index = nombre de bons numeros. Plus c'est rare, plus ca paie ; plafond x1000. */
function kenoTable(n, risk) {
    const key = `${n}:${risk}`;
    if (kenoCache.has(key)) return kenoCache.get(key);
    const { alpha, from } = KENO_RISKS[risk];
    const k0 = Math.max(1, risk === 'low' ? Math.floor(n * from) : Math.ceil(n * from));
    const p = Array.from({ length: n + 1 }, (_, k) => kenoProb(n, k));
    const capped = new Set();
    let pay = [];
    for (let guard = 0; guard <= n; guard++) {
        let budget = RTP;
        let weight = 0;
        for (let k = k0; k <= n; k++) {
            if (capped.has(k)) budget -= p[k] * MAX_MULT;
            else weight += p[k] ** (1 - alpha);
        }
        const c = weight > 0 ? budget / weight : 0;
        pay = p.map((pk, k) => (k < k0 ? 0 : capped.has(k) ? MAX_MULT : c * pk ** -alpha));
        const over = pay.findIndex((v, k) => v > MAX_MULT && !capped.has(k));
        if (over < 0) break;
        for (let k = over; k <= n; k++) if (pay[k] > MAX_MULT) capped.add(k);
    }
    const table = pay.map(nice);
    kenoCache.set(key, table);
    return table;
}
function kenoDraw(rnd) {
    const pool = Array.from({ length: KENO_N }, (_, i) => i + 1);
    for (let i = 0; i < KENO_DRAW; i++) {
        const j = i + Math.floor(rnd() * (KENO_N - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, KENO_DRAW);
}

// ---------------------------------------------------------------------------
// TOUR DU SLIP : 8 etages, a chaque etage des cases propres et des cases qui puent
// ---------------------------------------------------------------------------
const TOWER_LEVELS = 8;
const TOWER = {
    easy: { cols: 4, safe: 3, label: 'Facile' },
    medium: { cols: 3, safe: 2, label: 'Moyen' },
    hard: { cols: 2, safe: 1, label: 'Dur' },
    expert: { cols: 3, safe: 1, label: 'Expert' },
};
const towerMult = (diff, k) => (k <= 0 ? 1 : floor2(RTP * (TOWER[diff].cols / TOWER[diff].safe) ** k));
/** pour chaque etage, la liste des cases propres */
function towerLayout(rnd, diff) {
    const { cols, safe } = TOWER[diff];
    return Array.from({ length: TOWER_LEVELS }, () => {
        const idx = Array.from({ length: cols }, (_, i) => i);
        for (let i = 0; i < safe; i++) {
            const j = i + Math.floor(rnd() * (cols - i));
            [idx[i], idx[j]] = [idx[j], idx[i]];
        }
        return idx.slice(0, safe).sort((a, b) => a - b);
    });
}

// ---------------------------------------------------------------------------
// HILO : la prochaine carte est-elle plus haute ou plus basse ? (As = 1, Roi = 13, paquet infini)
// ---------------------------------------------------------------------------
const HILO_RANKS = 13;
const hiloCard = (rnd) => ({ r: 1 + Math.floor(rnd() * HILO_RANKS), s: Math.floor(rnd() * 4) });
/** chance de gagner : "hi" = plus haute ou egale, "lo" = plus basse ou egale (As et Roi : stricte, ou "pareil") */
function hiloChance(rank, guess) {
    if (rank === 1) return guess === 'hi' ? 12 / 13 : 1 / 13; // hi = plus haute, lo = encore un As
    if (rank === HILO_RANKS) return guess === 'lo' ? 12 / 13 : 1 / 13; // lo = plus basse, hi = encore un Roi
    return guess === 'hi' ? (HILO_RANKS - rank + 1) / 13 : rank / 13;
}
function hiloWins(rank, guess, next) {
    if (rank === 1) return guess === 'hi' ? next > 1 : next === 1;
    if (rank === HILO_RANKS) return guess === 'lo' ? next < HILO_RANKS : next === HILO_RANKS;
    return guess === 'hi' ? next >= rank : next <= rank;
}
/** multiplicateur affiche a partir du produit brut des cotes (la marge n'est prise qu'une fois) */
const hiloMult = (raw) => floor2(RTP * raw);

module.exports = {
    RTP, MAX_MULT, floor2,
    DICE_MIN, DICE_MAX, diceChance, diceMult, dice,
    LIMBO_MIN, limboTarget, limbo,
    KENO_N, KENO_DRAW, KENO_RISKS, kenoProb, kenoTable, kenoDraw,
    TOWER, TOWER_LEVELS, towerMult, towerLayout,
    HILO_RANKS, hiloCard, hiloChance, hiloWins, hiloMult,
};
