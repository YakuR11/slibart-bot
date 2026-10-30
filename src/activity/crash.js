// Crash multijoueur : UNE fusee par vocal. Tout le monde mise pendant le compte a rebours,
// puis chacun encaisse quand il veut (ou automatiquement a son multiplicateur).
// Le serveur fait foi : point de crash tire au decollage, multiplicateur calcule sur son horloge.
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const eco = require('../lib/economy');
const casino = require('../lib/casino');
const progress = require('../lib/progress');
const announce = require('../lib/announce');
const log = require('../lib/logger');
const { fmt } = require('../lib/utils');
const feed = require('./feed');

const K = 0.09; // meme vitesse que =crash : x2 a ~7,7 s, x5 a ~18 s, x10 a ~26 s
const BET_MS = 8000; // compte a rebours avant decollage
const END_MS = 3500; // pause apres le crash
const MIN_BET = 10;
const MAX_BET = 1_000_000;
const MAX_MULT = 1000;
const BIG_WIN = 3000;

const multAt = (ms) => Math.floor(Math.exp((K * Math.max(0, ms)) / 1000) * 100) / 100;
const timeFor = (m) => (Math.log(m) / K) * 1000;

/** ~3 % de crash instantane (avantage maison, comme =crash) ; P(atteindre x) ≈ 0,97 / x */
function crashPoint() {
    const r = Math.random();
    return Math.min(MAX_MULT, Math.max(1, Math.floor(97 / (1 - r)) / 100));
}

const games = new Map(); // room -> partie
let io = null; // { broadcast(room, msg), alive(room) }

function init(hooks) { io = hooks; }

function publicBets(g) {
    return [...g.bets.values()].map((b) => ({
        player: b.player, bet: b.bet, auto: b.auto, cashed: b.cashed, payout: b.payout,
    }));
}

function state(g) {
    return {
        type: 'crash:state',
        now: Date.now(),
        phase: g.phase,
        endsAt: g.endsAt,
        startAt: g.startAt,
        point: g.phase === 'crashed' ? g.point : null,
        bets: publicBets(g),
        history: g.history.slice(-14),
        k: K,
    };
}

/** cree la partie de la salle si besoin et renvoie l'etat courant */
function join(room) {
    let g = games.get(room);
    if (!g) {
        g = { room, phase: 'idle', bets: new Map(), history: [], timers: [] };
        games.set(room, g);
        betting(g);
    }
    return state(g);
}

function clear(g) {
    for (const t of g.timers) clearTimeout(t);
    g.timers = [];
}

function later(g, ms, fn) {
    g.timers.push(setTimeout(() => {
        try { fn(); } catch (e) { log.error('[crash]', e); }
    }, Math.max(0, ms)));
}

function betting(g) {
    clear(g);
    // plus personne dans la salle : on arrete la boucle
    if (!io.alive(g.room)) {
        games.delete(g.room);
        return;
    }
    g.phase = 'betting';
    g.bets = new Map();
    g.point = null;
    g.startAt = null;
    g.endsAt = Date.now() + BET_MS;
    io.broadcast(g.room, state(g));
    later(g, BET_MS, () => fly(g));
}

function fly(g) {
    clear(g);
    g.phase = 'flying';
    g.point = crashPoint();
    g.startAt = Date.now();
    g.crashAt = g.startAt + timeFor(g.point);
    io.broadcast(g.room, state(g));
    // encaissements automatiques
    for (const b of g.bets.values()) {
        if (b.auto && b.auto < g.point) later(g, timeFor(b.auto), () => cashout(g, b.player.id, b.auto));
    }
    later(g, g.crashAt - Date.now(), () => crash(g));
}

function crash(g) {
    clear(g);
    g.phase = 'crashed';
    g.history.push(g.point);
    if (g.history.length > 30) g.history.shift();
    io.broadcast(g.room, state(g));
    // les perdants : reglement en arriere-plan
    for (const b of g.bets.values()) if (!b.cashed) settle(g, b, 0);
    later(g, END_MS, () => betting(g));
}

async function settle(g, b, payout) {
    try {
        const ctx = { user: { id: b.player.id } };
        const { net, bal } = await casino.settle(ctx, b.bet, payout);
        b.reply?.({ type: 'crash:balance', balance: bal });
        feed.finish(b.feedId, { net, mult: b.cashed || 0, text: b.cashed ? `encaissé ×${b.cashed}` : `💥 ×${g.point}` });
        const notices = (await progress.track(
            { user: { id: b.player.id, username: b.player.name }, channel: null, displayName: b.player.name },
            { play: 1, win: net > 0 ? 1 : 0, wager: b.bet },
            { bet: b.bet, net, allin: b.allin, crashMult: b.cashed || 0 },
        )) || [];
        if (notices.length) b.reply?.({ type: 'notices', list: notices.map(clean) });
        if (net >= BIG_WIN) {
            const embed = new EmbedBuilder()
                .setColor('#f1c40f')
                .setDescription(`🚀 **${b.player.name}** a encaissé à **x${b.cashed}** au **Crash** : **+${fmt(net)}** ${config.rbEmoji} (mise ${fmt(b.bet)}) !\n-# Lance l'activité depuis un vocal pour jouer avec lui`);
            announce.send({ embeds: [embed] }).catch(() => {});
        }
    } catch (e) {
        log.error('[crash] reglement', e);
    }
}

/**
 * Mise pendant le compte a rebours (une par manche).
 * player = { id, name, avatar, color, skins }, reply = envoi au joueur
 */
async function bet(room, player, { bet: raw, auto }, reply) {
    const g = games.get(room);
    if (!g || g.phase !== 'betting') return { error: 'Attends la prochaine manche.' };
    if (g.bets.has(player.id)) return { error: 'Tu as déjà misé sur cette manche.' };
    const amount = Math.floor(Number(raw));
    if (!Number.isFinite(amount) || amount < MIN_BET) return { error: `Mise minimum : ${MIN_BET}.` };
    if (amount > MAX_BET) return { error: `Mise maximum : ${fmt(MAX_BET)}.` };
    let autoAt = auto ? Math.floor(Number(String(auto).replace(',', '.')) * 100) / 100 : null;
    if (autoAt !== null && !(autoAt >= 1.01)) return { error: 'Encaissement auto : minimum x1.01.' };
    if (autoAt > MAX_MULT) autoAt = MAX_MULT;
    // place reservee avant l'attente de la base (anti double-clic)
    const slot = { player, bet: amount, auto: autoAt, cashed: null, payout: 0, reply, pending: true };
    g.bets.set(player.id, slot);
    const before = await eco.balance(player.id);
    if (!(await eco.takeRb(player.id, amount))) {
        g.bets.delete(player.id);
        return { error: `Solde insuffisant (${fmt(before)}).` };
    }
    slot.pending = false;
    slot.allin = amount >= before;
    slot.feedId = feed.start({ player, game: 'crash', bet: amount, allin: slot.allin, balBefore: before, text: autoAt ? `auto ×${autoAt}` : null });
    // la manche a pu decoller pendant l'attente : on rembourse
    if (g.phase !== 'betting') {
        g.bets.delete(player.id);
        feed.cancel(slot.feedId);
        await eco.addRb(player.id, amount, undefined, { raw: true });
        return { error: 'Trop tard, la fusée est partie !' };
    }
    io.broadcast(room, { type: 'crash:bet', bet: { player, bet: amount, auto: autoAt, cashed: null, payout: 0 } });
    return { ok: true, balance: before - amount };
}

/** Annule sa mise tant que la fusee n'a pas decolle */
async function cancel(room, playerId) {
    const g = games.get(room);
    const b = g?.bets.get(playerId);
    if (!b || g.phase !== 'betting' || b.pending) return { error: 'Impossible d\'annuler maintenant.' };
    g.bets.delete(playerId);
    feed.cancel(b.feedId);
    await eco.addRb(playerId, b.bet, undefined, { raw: true });
    io.broadcast(room, { type: 'crash:cancel', id: playerId });
    return { ok: true, balance: await eco.balance(playerId) };
}

/** Encaisse au multiplicateur actuel (horloge du serveur) ou a l'auto-cashout */
function cashout(g, playerId, at = null) {
    if (!g || g.phase !== 'flying') return { error: 'Rien à encaisser.' };
    const b = g.bets.get(playerId);
    if (!b || b.cashed) return { error: 'Rien à encaisser.' };
    const now = Date.now();
    if (now >= g.crashAt) return { error: 'Trop tard 💥' };
    const m = at ?? Math.min(multAt(now - g.startAt), g.point);
    if (m >= g.point) return { error: 'Trop tard 💥' };
    b.cashed = m;
    b.payout = Math.floor(b.bet * m);
    io.broadcast(g.room, { type: 'crash:cashout', id: playerId, mult: m, payout: b.payout, bet: b.bet });
    settle(g, b, b.payout);
    return { ok: true, mult: m, payout: b.payout };
}

function cashoutIn(room, playerId) {
    return cashout(games.get(room), playerId);
}

function clean(s) {
    return String(s).replace(/<a?:\w+:\d+>/g, 'RB').replace(/\*\*|__|`/g, '').replace(/\*(.+?)\*/g, '$1');
}

module.exports = { init, join, bet, cancel, cashout: cashoutIn, multAt, crashPoint, K, MIN_BET, MAX_BET };
