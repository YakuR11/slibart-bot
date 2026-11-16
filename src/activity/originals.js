// Slip Originals : Dice, Limbo, Keno, Tour du Slip, HiLo.
// Les maths sont dans origmath.js ; ici on prend la mise, on tire, on paie.
const games = require('./games');
const feed = require('./feed');
const eco = require('../lib/economy');
const m = require('./origmath');

const { stake, settleLater, rnd } = games;
const round2 = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// DICE
// ---------------------------------------------------------------------------
async function dice(player, { bet, chance, over }) {
    const c = m.diceChance(chance);
    const s = await stake(player, bet);
    if (s.error) return s;
    const up = !!over;
    const feedId = feed.start({ player, game: 'dice', bet: s.bet, allin: s.allin, balBefore: s.before, text: `${up ? 'au-dessus de' : 'en dessous de'} ${up ? round2(100 - c) : c}` });
    const r = m.dice(rnd, c, up);
    const payout = r.won ? Math.floor(s.bet * r.mult) : 0;
    const res = await settleLater(player, { game: 'dice', bet: s.bet, payout, allin: s.allin, feedId, mult: r.won ? r.mult : 0, text: `🎲 ${r.roll.toFixed(2)}` }, 550);
    return { roll: r.roll, won: r.won, mult: r.mult, chance: c, over: up, line: r.line, payout, ...res };
}

// ---------------------------------------------------------------------------
// LIMBO
// ---------------------------------------------------------------------------
async function limbo(player, { bet, target }) {
    const t = m.limboTarget(target);
    const s = await stake(player, bet);
    if (s.error) return s;
    const feedId = feed.start({ player, game: 'limbo', bet: s.bet, allin: s.allin, balBefore: s.before, text: `vise ×${t}` });
    const r = m.limbo(rnd, t);
    const payout = r.won ? Math.floor(s.bet * t) : 0;
    const res = await settleLater(player, { game: 'limbo', bet: s.bet, payout, allin: s.allin, feedId, mult: r.won ? t : 0, text: `×${r.result.toFixed(2)}` }, 900);
    return { result: r.result, won: r.won, target: t, payout, ...res };
}

// ---------------------------------------------------------------------------
// KENO
// ---------------------------------------------------------------------------
function kenoPicks(raw) {
    if (!Array.isArray(raw)) return null;
    const set = new Set(raw.map((x) => Math.floor(Number(x))).filter((x) => x >= 1 && x <= m.KENO_N));
    return set.size >= 1 && set.size <= 10 && set.size === raw.length ? [...set] : null;
}
const kenoRisk = (r) => (m.KENO_RISKS[r] ? r : 'medium');

/** toutes les tables d'un risque (l'app les affiche sous la grille) */
function kenoInfo({ risk }) {
    const r = kenoRisk(risk);
    return { risk: r, tables: Array.from({ length: 10 }, (_, i) => m.kenoTable(i + 1, r)) };
}

async function keno(player, { bet, picks, risk }) {
    const mine = kenoPicks(picks);
    if (!mine) return { error: 'Coche entre 1 et 10 numéros.' };
    const r = kenoRisk(risk);
    const s = await stake(player, bet);
    if (s.error) return s;
    const feedId = feed.start({ player, game: 'keno', bet: s.bet, allin: s.allin, balBefore: s.before, text: `${mine.length} numéro${mine.length > 1 ? 's' : ''}` });
    const draw = m.kenoDraw(rnd);
    const hits = draw.filter((n) => mine.includes(n));
    const table = m.kenoTable(mine.length, r);
    const mult = table[hits.length];
    const payout = Math.floor(s.bet * mult);
    const res = await settleLater(player, { game: 'keno', bet: s.bet, payout, allin: s.allin, feedId, mult, text: `${hits.length}/${mine.length} bons` }, 2400);
    return { draw, hits, mult, table, payout, ...res };
}

// ---------------------------------------------------------------------------
// TOUR DU SLIP (partie en plusieurs coups, comme les Mines)
// ---------------------------------------------------------------------------
const towers = new Map();

function towerView(t) {
    const { cols, safe } = m.TOWER[t.diff];
    return {
        diff: t.diff, cols, safe, levels: m.TOWER_LEVELS, bet: t.bet, path: [...t.path], level: t.path.length,
        mult: m.towerMult(t.diff, t.path.length), next: m.towerMult(t.diff, t.path.length + 1),
        ladder: Array.from({ length: m.TOWER_LEVELS }, (_, i) => m.towerMult(t.diff, i + 1)),
    };
}

async function towerEnd(player, t, cashed, refund = false) {
    towers.delete(player.id);
    clearTimeout(t.timer);
    const k = t.path.length;
    const mult = refund ? 1 : cashed ? m.towerMult(t.diff, k) : 0;
    const payout = Math.floor(t.bet * mult);
    const res = await settleLater(player, { game: 'tower', bet: t.bet, payout, allin: t.allin, feedId: t.feedId, mult, text: refund ? 'mise rendue' : cashed ? `étage ${k}` : `tombé à l'étage ${k + 1}` }, cashed ? 300 : 900);
    return { done: true, cashed, ...towerView(t), mult, payout, layout: t.layout, ...res };
}

async function tower(player, { action, bet, diff, col }) {
    let t = towers.get(player.id);
    if (action === 'state') return t ? { done: false, resume: true, ...towerView(t) } : { idle: true };
    if (action === 'start') {
        if (t) return { done: false, resume: true, ...towerView(t) };
        const d = m.TOWER[diff] ? diff : 'medium';
        const s = await stake(player, bet);
        if (s.error) return s;
        t = { bet: s.bet, allin: s.allin, diff: d, layout: m.towerLayout(rnd, d), path: [] };
        t.feedId = feed.start({ player, game: 'tower', bet: s.bet, allin: s.allin, balBefore: s.before, text: m.TOWER[d].label.toLowerCase() });
        towers.set(player.id, t);
        // 3 min sans rien faire : on encaisse ce qui est monte (ou on rend la mise si rien n'est joue)
        t.arm = () => {
            clearTimeout(t.timer);
            t.timer = setTimeout(() => { if (towers.get(player.id) === t) towerEnd(player, t, t.path.length > 0, t.path.length === 0).catch(() => {}); }, 180_000);
        };
        t.arm();
        return { done: false, ...towerView(t), balance: await eco.balance(player.id) };
    }
    if (!t) return { error: 'Pas de partie en cours.' };
    t.arm();
    if (action === 'cashout') {
        if (!t.path.length) return { error: 'Monte au moins un étage.' };
        return towerEnd(player, t, true);
    }
    if (action === 'pick') {
        const c = Math.floor(Number(col));
        if (!(c >= 0 && c < m.TOWER[t.diff].cols)) return { error: 'Case invalide.' };
        const level = t.path.length;
        if (!t.layout[level].includes(c)) {
            const out = await towerEnd(player, t, false);
            return { ...out, boom: { level, col: c } };
        }
        t.path.push(c);
        if (t.path.length === m.TOWER_LEVELS) return towerEnd(player, t, true);
        return { done: false, safe: { level, col: c }, ...towerView(t), gain: Math.floor(t.bet * m.towerMult(t.diff, t.path.length)) };
    }
    return { error: 'Action inconnue.' };
}

// ---------------------------------------------------------------------------
// HILO
// ---------------------------------------------------------------------------
const hilos = new Map();
const HILO_AUTO = 500; // au-dela, on encaisse tout seul

function hiloView(h) {
    const mult = m.hiloMult(h.raw);
    return {
        card: h.card, steps: h.steps, bet: h.bet, mult: h.steps ? mult : 1, history: h.history.slice(-12),
        hi: { chance: m.hiloChance(h.card.r, 'hi'), mult: m.hiloMult(h.raw / m.hiloChance(h.card.r, 'hi')) },
        lo: { chance: m.hiloChance(h.card.r, 'lo'), mult: m.hiloMult(h.raw / m.hiloChance(h.card.r, 'lo')) },
    };
}

async function hiloEnd(player, h, cashed, refund = false) {
    hilos.delete(player.id);
    clearTimeout(h.timer);
    const mult = refund ? 1 : cashed ? m.hiloMult(h.raw) : 0;
    const payout = Math.floor(h.bet * mult);
    const res = await settleLater(player, { game: 'hilo', bet: h.bet, payout, allin: h.allin, feedId: h.feedId, mult, text: refund ? 'mise rendue' : cashed ? `${h.steps} carte${h.steps > 1 ? 's' : ''}` : `raté à la carte ${h.steps + 1}` }, cashed ? 300 : 800);
    return { done: true, cashed, card: h.card, steps: h.steps, history: h.history.slice(-12), mult, payout, ...res };
}

async function hilo(player, { action, bet, guess }) {
    let h = hilos.get(player.id);
    if (action === 'state') return h ? { done: false, resume: true, ...hiloView(h) } : { idle: true };
    if (action === 'start') {
        if (h) return { done: false, resume: true, ...hiloView(h) };
        const s = await stake(player, bet);
        if (s.error) return s;
        const first = m.hiloCard(rnd);
        h = { bet: s.bet, allin: s.allin, card: first, raw: 1, steps: 0, skips: 0, history: [first] };
        h.feedId = feed.start({ player, game: 'hilo', bet: s.bet, allin: s.allin, balBefore: s.before });
        hilos.set(player.id, h);
        h.arm = () => {
            clearTimeout(h.timer);
            h.timer = setTimeout(() => { if (hilos.get(player.id) === h) hiloEnd(player, h, h.steps > 0, h.steps === 0).catch(() => {}); }, 180_000);
        };
        h.arm();
        return { done: false, ...hiloView(h), balance: await eco.balance(player.id) };
    }
    if (!h) return { error: 'Pas de partie en cours.' };
    h.arm();
    if (action === 'cashout') {
        if (!h.steps) return { error: 'Devine au moins une carte.' };
        return hiloEnd(player, h, true);
    }
    if (action === 'skip') {
        if (h.skips >= 20) return { error: 'Plus de changement de carte sur cette partie.' };
        h.skips++;
        h.card = m.hiloCard(rnd);
        h.history.push({ ...h.card, skip: true });
        return { done: false, skipped: true, ...hiloView(h) };
    }
    if (action === 'guess') {
        if (guess !== 'hi' && guess !== 'lo') return { error: 'Plus haut ou plus bas ?' };
        const next = m.hiloCard(rnd);
        const ok = m.hiloWins(h.card.r, guess, next.r);
        const p = m.hiloChance(h.card.r, guess);
        h.card = next;
        h.history.push({ ...next, ok });
        if (!ok) return hiloEnd(player, h, false);
        h.raw /= p;
        h.steps++;
        if (m.hiloMult(h.raw) >= HILO_AUTO) return hiloEnd(player, h, true);
        return { done: false, ok: true, ...hiloView(h), gain: Math.floor(h.bet * m.hiloMult(h.raw)) };
    }
    return { error: 'Action inconnue.' };
}

module.exports = { dice, limbo, keno, kenoInfo, tower, hilo };
