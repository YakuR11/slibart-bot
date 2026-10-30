// Jeux de l'app (les memes maths que les anciennes commandes du chat) :
// roulette, slots (jackpot progressif), blackjack, mines, duel pierre-feuille-ciseaux.
// Le serveur tire tout ; l'interface ne fait qu'animer le resultat.
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const eco = require('../lib/economy');
const casino = require('../lib/casino');
const progress = require('../lib/progress');
const announce = require('../lib/announce');
const log = require('../lib/logger');
const { fmt } = require('../lib/utils');
const feed = require('./feed');

const MIN_BET = 10;
const MAX_BET = 1_000_000;
const rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const pickOne = (a) => a[Math.floor(rnd() * a.length)];

function clean(s) {
    return String(s).replace(/<a?:\w+:\d+>/g, 'RB').replace(/\*\*|__|`/g, '').replace(/\*(.+?)\*/g, '$1');
}

// ---------------------------------------------------------------------------
// commun : prendre la mise, regler, progression
// ---------------------------------------------------------------------------
async function stake(player, rawBet) {
    const bet = Math.floor(Number(rawBet));
    if (!Number.isFinite(bet) || bet < MIN_BET) return { error: `Mise minimum : ${MIN_BET}.` };
    if (bet > MAX_BET) return { error: `Mise maximum : ${fmt(MAX_BET)}.` };
    const before = await eco.balance(player.id);
    if (!(await eco.takeRb(player.id, bet))) return { error: `Solde insuffisant (${fmt(before)}).` };
    return { bet, before, allin: bet >= before };
}

async function settle(player, { game, bet, payout, allin, feedId, mult = null, text = null, meta = {} }) {
    const { net, bal, cut } = await casino.settle({ user: { id: player.id } }, bet, payout);
    feed.finish(feedId, { net, mult, text });
    let notices = [];
    try {
        notices = (await progress.track(
            { user: { id: player.id, username: player.name }, channel: null, displayName: player.name },
            { play: 1, win: net > 0 ? 1 : 0, wager: bet },
            { bet, net, allin, ...meta },
        )) || [];
    } catch (e) {
        log.warn('[jeux] progression', e.message);
    }
    if (net >= 3000) {
        announce.send({ content: `🚨 **${player.name}** vient de gagner **${fmt(net)}** ${config.rbEmoji} au **${feed.GAMES[game]?.label || game}** dans l'app !` }).catch(() => {});
    }
    return { net, balance: bal, cut, notices: notices.map(clean) };
}

// ---------------------------------------------------------------------------
// ROULETTE : rouge/noir x2, vert x14 (1 chance sur 15)
// ---------------------------------------------------------------------------
// la roue : 15 cases (7 rouges, 7 noires, 1 verte)
const WHEEL = ['red', 'black', 'red', 'black', 'red', 'black', 'red', 'green', 'black', 'red', 'black', 'red', 'black', 'red', 'black'];
const GREEN_CHANCE = 1 / 15;

async function roulette(player, { color, bet }) {
    if (!['red', 'black', 'green'].includes(color)) return { error: 'Choisis rouge, noir ou vert.' };
    const s = await stake(player, bet);
    if (s.error) return s;
    const feedId = feed.start({ player, game: 'roulette', bet: s.bet, allin: s.allin, balBefore: s.before, text: { red: 'sur 🔴', black: 'sur ⚫', green: 'sur 🟢' }[color] });
    const outcome = color === 'green'
        ? (rnd() < GREEN_CHANCE ? 'green' : pickOne(['red', 'black']))
        : (rnd() < 0.5 ? 'red' : 'black');
    const won = outcome === color;
    const mult = won ? (color === 'green' ? 14 : 2) : 0;
    const cells = WHEEL.map((c, i) => (c === outcome ? i : -1)).filter((i) => i >= 0);
    const cell = pickOne(cells);
    // le resultat n'est revele dans le centre qu'a la fin de l'animation (3 s)
    const res = await settleLater(player, { game: 'roulette', bet: s.bet, payout: s.bet * mult, allin: s.allin, feedId, mult: won ? mult : 0, text: { red: '🔴', black: '⚫', green: '🟢' }[outcome] }, 3000);
    return { outcome, cell, mult, wheel: WHEEL, ...res };
}

/**
 * Regle tout de suite (l'argent est a jour) mais n'annonce le resultat dans le centre
 * qu'apres l'animation du joueur, pour ne pas spoiler.
 */
async function settleLater(player, opts, delayMs) {
    const { feedId, ...rest } = opts;
    const res = await settle(player, { ...rest, feedId: null });
    setTimeout(() => feed.finish(feedId, { net: res.net, mult: opts.mult, text: opts.text }), delayMs);
    return res;
}

// ---------------------------------------------------------------------------
// SLOTS : 3 rouleaux, paire = moitie, triple = x5 a x2000, jackpot progressif sur 777
// ---------------------------------------------------------------------------
const REELS = [
    { s: '🍒', w: 35, x3: 5 },
    { s: '🍋', w: 30, x3: 8 },
    { s: '🍇', w: 20, x3: 15 },
    { s: '🔔', w: 10, x3: 50 },
    { s: '💎', w: 4, x3: 250 },
    { s: '7️⃣', w: 1, x3: 2000 },
];
const REEL_TOTAL = REELS.reduce((a, r) => a + r.w, 0);
const PAIR_PAYOUT = 0.5;
const JACKPOT_BASE = 5000;
const JACKPOT_CUT = 0.03;
const JACKPOT_MIN_BET = 100;

function spinReel() {
    let n = rnd() * REEL_TOTAL;
    for (const r of REELS) if ((n -= r.w) < 0) return r;
    return REELS[0];
}
async function jackpotAdd(n) {
    await db.exec(
        `INSERT INTO settings (k, v) VALUES ('jackpot', ?) ON DUPLICATE KEY UPDATE v = CAST(v AS SIGNED) + ?`,
        [String(JACKPOT_BASE + n), n],
    );
}
const jackpot = async () => Number(await db.getSetting('jackpot', String(JACKPOT_BASE)));
async function jackpotClaim() {
    return db.tx(async (conn) => {
        const [[row]] = await conn.query(`SELECT v FROM settings WHERE k = 'jackpot' FOR UPDATE`);
        const pot = Number(row?.v || JACKPOT_BASE);
        await conn.query(`INSERT INTO settings (k, v) VALUES ('jackpot', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)`, [String(JACKPOT_BASE)]);
        return pot;
    });
}

async function slots(player, { bet }) {
    const s = await stake(player, bet);
    if (s.error) return s;
    const feedId = feed.start({ player, game: 'slots', bet: s.bet, allin: s.allin, balBefore: s.before });
    const res = [spinReel(), spinReel(), spinReel()];
    const [a, b, c] = res;
    await jackpotAdd(Math.max(1, Math.floor(s.bet * JACKPOT_CUT)));
    let payout = 0;
    let kind = 'none';
    let pot = 0;
    const isJackpot = a.s === '7️⃣' && b.s === '7️⃣' && c.s === '7️⃣';
    if (a.s === b.s && b.s === c.s) {
        payout = s.bet * a.x3;
        if (isJackpot && s.bet >= JACKPOT_MIN_BET) pot = await jackpotClaim();
        payout += pot;
        kind = isJackpot ? 'jackpot' : 'triple';
    } else if (a.s === b.s || b.s === c.s || a.s === c.s) {
        payout = Math.floor(s.bet * PAIR_PAYOUT);
        kind = 'pair';
    }
    const mult = Math.round((payout / s.bet) * 100) / 100;
    const text = kind === 'jackpot' ? '777 JACKPOT' : kind === 'triple' ? `triple ${a.s}` : kind === 'pair' ? 'paire' : res.map((r) => r.s).join('');
    const out = await settleLater(player, { game: 'slots', bet: s.bet, payout, allin: s.allin, feedId, mult, text, meta: { jackpot: isJackpot } }, 2600);
    return { reels: res.map((r) => r.s), kind, payout, mult, pot, jackpot: await jackpot(), ...out };
}

// ---------------------------------------------------------------------------
// BLACKJACK : naturel x2.5, croupier tire jusqu'a 17
// ---------------------------------------------------------------------------
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const card = () => ({ r: pickOne(RANKS), s: pickOne(SUITS) });
function handValue(h) {
    let v = 0;
    let aces = 0;
    for (const c of h) {
        if (c.r === 'A') { v += 11; aces++; } else if (['J', 'Q', 'K'].includes(c.r)) v += 10;
        else v += Number(c.r);
    }
    while (v > 21 && aces) { v -= 10; aces--; }
    return v;
}
const tables = new Map(); // joueur -> main en cours

function bjView(t, reveal = false) {
    return {
        player: t.player,
        dealer: reveal ? t.dealer : [t.dealer[0], null],
        pv: handValue(t.player),
        dv: reveal ? handValue(t.dealer) : handValue([t.dealer[0]]),
        bet: t.bet,
        doubled: t.doubled,
    };
}

async function bjFinish(player, t, outcome) {
    tables.delete(player.id);
    clearTimeout(t.timer);
    const payout = { blackjack: Math.floor(t.bet * 2.5), win: t.bet * 2, push: t.bet, lose: 0, bust: 0 }[outcome];
    const mult = Math.round((payout / t.bet) * 100) / 100;
    const text = { blackjack: 'Blackjack !', win: 'gagné', push: 'égalité', lose: 'perdu', bust: 'sauté' }[outcome];
    const res = await settleLater(player, { game: 'blackjack', bet: t.bet, payout, allin: t.allin, feedId: t.feedId, mult, text, meta: { blackjack: outcome === 'blackjack' } }, 1200);
    return { done: true, outcome, ...bjView(t, true), ...res };
}

function dealerPlays(t) {
    while (handValue(t.dealer) < 17) t.dealer.push(card());
    const pv = handValue(t.player);
    const dv = handValue(t.dealer);
    if (dv > 21 || pv > dv) return 'win';
    if (pv === dv) return 'push';
    return 'lose';
}

async function blackjack(player, { action, bet }) {
    let t = tables.get(player.id);
    if (action === 'deal') {
        if (t) return { error: 'Tu as déjà une main en cours.', ...bjView(t) };
        const s = await stake(player, bet);
        if (s.error) return s;
        t = { bet: s.bet, allin: s.allin, player: [card(), card()], dealer: [card(), card()], doubled: false };
        t.feedId = feed.start({ player, game: 'blackjack', bet: s.bet, allin: s.allin, balBefore: s.before });
        tables.set(player.id, t);
        // 2 min sans rien faire : on reste
        const arm = () => {
            clearTimeout(t.timer);
            t.timer = setTimeout(() => { if (tables.get(player.id) === t) bjFinish(player, t, dealerPlays(t)).catch(() => {}); }, 120_000);
        };
        t.arm = arm;
        arm();
        const pBJ = handValue(t.player) === 21;
        const dBJ = handValue(t.dealer) === 21;
        if (pBJ || dBJ) return bjFinish(player, t, pBJ && dBJ ? 'push' : pBJ ? 'blackjack' : 'lose');
        return { done: false, canDouble: (await eco.balance(player.id)) >= t.bet, ...bjView(t) };
    }
    if (!t) return { error: 'Pas de main en cours.' };
    t.arm();
    if (action === 'hit') {
        t.player.push(card());
        const v = handValue(t.player);
        if (v > 21) return bjFinish(player, t, 'bust');
        if (v === 21) return bjFinish(player, t, dealerPlays(t));
        return { done: false, canDouble: false, ...bjView(t) };
    }
    if (action === 'double') {
        if (t.player.length !== 2 || t.doubled) return { error: 'Tu ne peux plus doubler.' };
        if (!(await eco.takeRb(player.id, t.bet))) return { error: 'Pas assez pour doubler.' };
        t.bet *= 2;
        t.doubled = true;
        feed.grow(t.feedId, { bet: t.bet });
        t.player.push(card());
        return bjFinish(player, t, handValue(t.player) > 21 ? 'bust' : dealerPlays(t));
    }
    if (action === 'stand') return bjFinish(player, t, dealerPlays(t));
    return { error: 'Action inconnue.' };
}

// ---------------------------------------------------------------------------
// MINES : grille de 20 cases (4 x 5), 1 a 15 bombes, encaisse quand tu veux
// ---------------------------------------------------------------------------
const GRID = 20;
const MINES_EDGE = 0.97;
function minesMult(k, mines) {
    let m = MINES_EDGE;
    for (let i = 0; i < k; i++) m *= (GRID - i) / (GRID - mines - i);
    return k === 0 ? 1 : Math.floor(m * 100) / 100;
}
const fields = new Map();

async function minesEnd(player, f, cashed) {
    fields.delete(player.id);
    clearTimeout(f.timer);
    const k = f.picked.size;
    const mult = cashed ? minesMult(k, f.mines) : 0;
    const payout = Math.floor(f.bet * mult);
    const res = await settleLater(player, { game: 'mines', bet: f.bet, payout, allin: f.allin, feedId: f.feedId, mult, text: cashed ? `${k} 💎` : '💣', meta: { minesPicks: cashed ? k : 0 } }, cashed ? 300 : 900);
    return { done: true, cashed, bombs: [...f.bombs], picked: [...f.picked], mult, payout, ...res };
}

async function mines(player, { action, bet, mines: count, cell }) {
    let f = fields.get(player.id);
    if (action === 'start') {
        if (f) return { error: 'Tu as déjà une partie en cours.' };
        const n = Math.min(15, Math.max(1, Math.floor(Number(count) || 3)));
        const s = await stake(player, bet);
        if (s.error) return s;
        f = { bet: s.bet, allin: s.allin, mines: n, bombs: new Set(), picked: new Set() };
        while (f.bombs.size < n) f.bombs.add(Math.floor(rnd() * GRID));
        f.feedId = feed.start({ player, game: 'mines', bet: s.bet, allin: s.allin, balBefore: s.before, text: `${n} 💣` });
        fields.set(player.id, f);
        // 3 min sans rien faire : on encaisse ce qui est trouve
        f.timer = setTimeout(() => { if (fields.get(player.id) === f) minesEnd(player, f, f.picked.size > 0).catch(() => {}); }, 180_000);
        return { done: false, grid: GRID, mines: n, picked: [], mult: 1, next: minesMult(1, n) };
    }
    if (!f) return { error: 'Pas de partie en cours.' };
    if (action === 'cashout') {
        if (!f.picked.size) return { error: 'Retourne au moins une case.' };
        return minesEnd(player, f, true);
    }
    if (action === 'pick') {
        const i = Math.floor(Number(cell));
        if (!(i >= 0 && i < GRID) || f.picked.has(i)) return { error: 'Case invalide.' };
        if (f.bombs.has(i)) {
            const out = await minesEnd(player, f, false);
            return { ...out, boom: i };
        }
        f.picked.add(i);
        if (f.picked.size === GRID - f.mines) return minesEnd(player, f, true);
        const k = f.picked.size;
        return { done: false, safe: i, picked: [...f.picked], mult: minesMult(k, f.mines), next: minesMult(k + 1, f.mines), gain: Math.floor(f.bet * minesMult(k, f.mines)) };
    }
    return { error: 'Action inconnue.' };
}

// ---------------------------------------------------------------------------
// DUEL : pierre-feuille-ciseaux avec mise sequestree, entre deux joueurs de l'app
// ---------------------------------------------------------------------------
const RPS = ['pierre', 'feuille', 'ciseaux'];
const beats = (a, b) => (a === 'pierre' && b === 'ciseaux') || (a === 'feuille' && b === 'pierre') || (a === 'ciseaux' && b === 'feuille');
const duels = new Map(); // id -> duel
const inDuel = new Map(); // joueur -> id du duel
let duelSeq = 0;
let send = null; // send(userId, msg) : envoie a toutes les fenetres de ce joueur

function initDuels(sender) { send = sender; }

function duelPublic(d) {
    return { id: d.id, from: d.from, to: d.to, amount: d.amount, state: d.state, round: d.round };
}

async function duelChallenge(player, { to, amount, online }) {
    if (!online(to)) return { error: 'Ce membre n\'a pas l\'app ouverte.' };
    if (String(to) === player.id) return { error: 'Choisis un vrai adversaire.' };
    if (inDuel.has(player.id)) return { error: 'Tu es déjà dans un duel.' };
    if (inDuel.has(String(to))) return { error: 'Il est déjà dans un duel.' };
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n < 0) return { error: 'Montant invalide.' };
    if (n > (await eco.balance(player.id))) return { error: 'Tu n\'as pas assez de RB.' };
    if (n > (await eco.balance(String(to)))) return { error: 'Il n\'a pas assez de RB pour ce duel.' };
    const target = online(to);
    const d = { id: ++duelSeq, from: pub(player), to: pub(target), amount: n, state: 'invite', round: 1, choices: {} };
    duels.set(d.id, d);
    inDuel.set(player.id, d.id);
    inDuel.set(d.to.id, d.id);
    d.timer = setTimeout(() => duelCancel(d, 'Pas de réponse, duel annulé.'), 30_000);
    send(d.to.id, { type: 'duel:invite', duel: duelPublic(d) });
    send(d.from.id, { type: 'duel:update', duel: duelPublic(d), text: `Défi envoyé à ${d.to.name}…` });
    return { ok: true };
}

function pub(p) { return { id: p.id, name: p.name, avatar: p.avatar, skins: p.skins || null }; }

function duelCancel(d, text) {
    if (!duels.has(d.id)) return;
    clearTimeout(d.timer);
    duels.delete(d.id);
    inDuel.delete(d.from.id);
    inDuel.delete(d.to.id);
    d.state = 'cancelled';
    for (const u of [d.from.id, d.to.id]) send(u, { type: 'duel:update', duel: duelPublic(d), text });
}

async function duelAnswer(player, { id, accept }) {
    const d = duels.get(Number(id));
    if (!d) return { error: 'Ce duel n\'existe plus.' };
    if (player.id !== d.to.id && !(player.id === d.from.id && !accept)) return { error: 'Ce duel ne te concerne pas.' };
    if (!accept) {
        duelCancel(d, player.id === d.from.id ? `${d.from.name} a annulé le duel.` : `${d.to.name} refuse le duel 🏳️`);
        return { ok: true };
    }
    if (d.state !== 'invite') return { error: 'Déjà accepté.' };
    // on bloque les deux mises
    if (d.amount > 0) {
        const err = await db.tx(async (conn) => {
            if (!(await eco.takeRb(d.from.id, d.amount, conn))) return `${d.from.name} n'a plus assez de RB`;
            if (!(await eco.takeRb(d.to.id, d.amount, conn))) throw Object.assign(new Error('x'), { msg: `${d.to.name} n'a plus assez de RB` });
            return null;
        }).catch((e) => e.msg || 'erreur');
        if (err) {
            duelCancel(d, `Duel annulé : ${err}.`);
            return { error: err };
        }
    }
    clearTimeout(d.timer);
    d.state = 'play';
    d.feedId = feed.start({ player: d.from, vs: d.to, game: 'duel', bet: d.amount, text: `contre ${d.to.name}` });
    duelRound(d);
    return { ok: true };
}

function duelRound(d) {
    d.choices = {};
    d.state = 'play';
    d.timer = setTimeout(() => duelResolve(d), 15_000);
    for (const u of [d.from.id, d.to.id]) send(u, { type: 'duel:update', duel: duelPublic(d), text: d.round === 1 ? 'Choisis ton coup !' : `Égalité ! Manche ${d.round}` });
}

async function duelPlay(player, { id, move }) {
    const d = duels.get(Number(id));
    if (!d || d.state !== 'play') return { error: 'Pas de duel en cours.' };
    if (![d.from.id, d.to.id].includes(player.id)) return { error: 'Ce duel ne te concerne pas.' };
    if (!RPS.includes(move)) return { error: 'Coup invalide.' };
    if (d.choices[player.id]) return { error: 'Tu as déjà joué.' };
    d.choices[player.id] = move;
    const other = player.id === d.from.id ? d.to.id : d.from.id;
    send(other, { type: 'duel:update', duel: duelPublic(d), text: `${player.name} a choisi… à toi !`, ready: true });
    if (d.choices[d.from.id] && d.choices[d.to.id]) {
        clearTimeout(d.timer);
        duelResolve(d);
    }
    return { ok: true };
}

async function duelResolve(d) {
    if (!duels.has(d.id)) return;
    const c1 = d.choices[d.from.id];
    const c2 = d.choices[d.to.id];
    let winner = null;
    if (c1 && !c2) winner = d.from;
    else if (!c1 && c2) winner = d.to;
    else if (c1 && c2 && beats(c1, c2)) winner = d.from;
    else if (c1 && c2 && beats(c2, c1)) winner = d.to;
    const reveal = { [d.from.id]: c1 || null, [d.to.id]: c2 || null };

    if (!winner && c1 && c2 && d.round < 3) {
        for (const u of [d.from.id, d.to.id]) send(u, { type: 'duel:reveal', duel: duelPublic(d), moves: reveal, winner: null });
        d.round++;
        setTimeout(() => duelRound(d), 2600);
        return;
    }
    clearTimeout(d.timer);
    duels.delete(d.id);
    inDuel.delete(d.from.id);
    inDuel.delete(d.to.id);
    d.state = 'done';
    if (!winner) {
        if (d.amount > 0) {
            await eco.addRb(d.from.id, d.amount, undefined, { raw: true });
            await eco.addRb(d.to.id, d.amount, undefined, { raw: true });
        }
        feed.finish(d.feedId, { net: 0, text: 'égalité, mises rendues' });
        for (const u of [d.from.id, d.to.id]) send(u, { type: 'duel:reveal', duel: duelPublic(d), moves: reveal, winner: null, final: true, text: c1 || c2 ? 'Égalité parfaite, mises rendues.' : 'Personne n\'a joué, mises rendues.' });
        return;
    }
    const loser = winner.id === d.from.id ? d.to : d.from;
    const pay = d.amount > 0 ? await eco.addRb(winner.id, d.amount * 2) : { net: 0 };
    await db.exec('UPDATE profile SET duelwins = duelwins + 1 WHERE id_user = ?', [winner.id]);
    progress.track({ user: { id: winner.id }, channel: null }, { duel_win: 1, duel: 1 }, {}).catch(() => {});
    progress.track({ user: { id: loser.id }, channel: null }, { duel: 1 }, {}).catch(() => {});
    setTimeout(() => feed.finish(d.feedId, { net: d.amount, winner: winner.id, text: `${winner.name} gagne` }), 1800);
    for (const u of [d.from.id, d.to.id]) {
        send(u, {
            type: 'duel:reveal', duel: duelPublic(d), moves: reveal, winner: winner.id, final: true,
            text: `${winner.name} gagne ${d.amount ? `${fmt(pay.net)} RB` : 'pour l\'honneur'} !`,
            balance: await eco.balance(u),
        });
    }
}

module.exports = {
    roulette, slots, blackjack, mines, jackpot,
    initDuels, duelChallenge, duelAnswer, duelPlay,
    MIN_BET, MAX_BET, GRID, WHEEL,
};
