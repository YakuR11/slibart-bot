// Roulette europeenne (0 a 36, un seul zero) : la table de tous les paris possibles et leurs gains.
// Fichier partage entre le bot (=roulette), le serveur de l'app et l'interface : aucune dependance.
// Chaque pari couvre une liste de numeros et rend 36 / (nombre de numeros) fois la mise,
// mise comprise : plein x36, cheval x18, transversale x12, carre x9, sixain x6, douzaine et
// colonne x3, chances simples x2. Retour au joueur : 36/37 = 97,3 % quel que soit le pari.
const REDS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const RED = new Set(REDS);
// ordre des cases sur la roue
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const color = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** id -> { nums, kind, label } */
const BETS = new Map();
const add = (id, nums, kind, label) => BETS.set(id, { id, nums, kind, label, mult: 36 / nums.length });

for (let n = 0; n <= 36; n++) add(`n${n}`, [n], 'plein', String(n));
for (let n = 1; n <= 36; n++) {
    if (n + 3 <= 36) add(`s${n}-${n + 3}`, [n, n + 3], 'cheval', `${n}-${n + 3}`); // voisins de colonne
    if (n % 3 !== 0) add(`s${n}-${n + 1}`, [n, n + 1], 'cheval', `${n}-${n + 1}`); // voisins de rangee
    if (n % 3 !== 0 && n + 4 <= 36) add(`c${n}`, [n, n + 1, n + 3, n + 4], 'carré', `${n}-${n + 4}`);
}
for (let f = 1; f <= 34; f += 3) {
    add(`t${f}`, [f, f + 1, f + 2], 'transversale', `${f}-${f + 2}`);
    if (f + 5 <= 36) add(`l${f}`, range(f, f + 5), 'sixain', `${f}-${f + 5}`);
}
for (const n of [1, 2, 3]) add(`s0-${n}`, [0, n], 'cheval', `0-${n}`);
add('t0a', [0, 1, 2], 'transversale', '0-1-2');
add('t0b', [0, 2, 3], 'transversale', '0-2-3');
add('c0', [0, 1, 2, 3], 'carré', '0-3');
for (const d of [1, 2, 3]) add(`d${d}`, range(d * 12 - 11, d * 12), 'douzaine', `${d * 12 - 11}-${d * 12}`);
for (const k of [1, 2, 3]) add(`k${k}`, range(1, 36).filter((n) => n % 3 === k % 3), 'colonne', `colonne ${k}`);
add('red', REDS, 'simple', 'rouge');
add('black', range(1, 36).filter((n) => !RED.has(n)), 'simple', 'noir');
add('even', range(1, 36).filter((n) => n % 2 === 0), 'simple', 'pair');
add('odd', range(1, 36).filter((n) => n % 2 === 1), 'simple', 'impair');
add('low', range(1, 18), 'simple', '1-18');
add('high', range(19, 36), 'simple', '19-36');

const MAX_BETS = 60; // paris differents sur un meme tour

/**
 * Nettoie une liste [{ id, amount }] : paris connus, montants entiers > 0, doublons additionnes.
 * Retourne { bets, total } ou { error }.
 */
function normalize(list) {
    if (!Array.isArray(list) || !list.length) return { error: 'Pose au moins un jeton.' };
    const sum = new Map();
    for (const b of list) {
        const id = String(b?.id || '');
        const amount = Math.floor(Number(b?.amount));
        if (!BETS.has(id)) return { error: 'Pari inconnu.' };
        if (!(amount > 0) || !Number.isSafeInteger(amount)) return { error: 'Montant invalide.' };
        sum.set(id, (sum.get(id) || 0) + amount);
    }
    if (sum.size > MAX_BETS) return { error: `${MAX_BETS} paris différents maximum par tour.` };
    const bets = [...sum].map(([id, amount]) => ({ id, amount }));
    return { bets, total: bets.reduce((a, b) => a + b.amount, 0) };
}

const spin = (rnd) => Math.floor(rnd() * 37);

/** ce que rend chaque pari si la bille tombe sur n : { payout, wins: [{ id, amount, pay }] } */
function settle(bets, n) {
    const wins = [];
    let payout = 0;
    for (const b of bets) {
        const def = BETS.get(b.id);
        if (!def.nums.includes(n)) continue;
        const pay = Math.floor(b.amount * def.mult);
        payout += pay;
        wins.push({ id: b.id, amount: b.amount, pay });
    }
    return { payout, wins };
}

// ---------------------------------------------------------------------------
// paris tapes dans le chat : "rouge", "pair", "17", "17-18", "d2", "c3", "1-18"...
// ---------------------------------------------------------------------------
const WORDS = {
    rouge: 'red', red: 'red', r: 'red', noir: 'black', black: 'black', n: 'black', b: 'black',
    pair: 'even', even: 'even', p: 'even', impair: 'odd', odd: 'odd', i: 'odd',
    manque: 'low', bas: 'low', '1-18': 'low', passe: 'high', haut: 'high', '19-36': 'high',
    vert: 'n0', green: 'n0', g: 'n0', v: 'n0', zero: 'n0',
    d1: 'd1', d2: 'd2', d3: 'd3', '1-12': 'd1', '13-24': 'd2', '25-36': 'd3',
    c1: 'k1', c2: 'k2', c3: 'k3', col1: 'k1', col2: 'k2', col3: 'k3',
};
/** un mot -> id de pari, ou null */
function parseBet(word) {
    const w = String(word).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (WORDS[w]) return WORDS[w];
    if (/^\d{1,2}$/.test(w) && Number(w) <= 36) return `n${Number(w)}`;
    // plusieurs numeros colles par des tirets : cheval, transversale, carre, sixain
    const parts = w.split(/[-/+]/).map(Number);
    if (parts.length >= 2 && parts.every((x) => Number.isInteger(x) && x >= 0 && x <= 36)) {
        const want = [...new Set(parts)].sort((a, b) => a - b).join(',');
        for (const def of BETS.values()) {
            if (def.kind === 'simple' || def.kind === 'douzaine' || def.kind === 'colonne') continue;
            if ([...def.nums].sort((a, b) => a - b).join(',') === want) return def.id;
        }
        // "1-6" ou "31-36" : les deux bouts d'un sixain ou d'une transversale
        if (parts.length === 2) for (const def of BETS.values()) if ((def.kind === 'sixain' || def.kind === 'transversale') && def.nums[0] === parts[0] && def.nums[def.nums.length - 1] === parts[1]) return def.id;
    }
    return null;
}

module.exports = { REDS, WHEEL, BETS, MAX_BETS, color, normalize, spin, settle, parseBet };
