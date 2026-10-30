// Crash multijoueur : UNE fusee par vocal. Tout le monde mise pendant le compte a rebours,
// puis chacun encaisse quand il veut (ou automatiquement a son multiplicateur).
// Le serveur fait foi : point de crash tire au decollage, multiplicateur calcule sur son horloge.
// La manche est en base : un redemarrage de Docker reprend le vol au lieu d'avaler les mises.
const crypto = require('node:crypto');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
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
    return [...g.bets.values()].filter((b) => !b.refunded).map((b) => ({
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

function clear(g) {
    for (const t of g.timers) clearTimeout(t);
    g.timers = [];
}

function later(g, ms, fn) {
    g.timers.push(setTimeout(() => {
        try { fn(); } catch (e) { log.error('[crash]', e); }
    }, Math.max(0, ms)));
}

function pack(g) {
    return [...g.bets.values()].filter((b) => !b.pending).map((b) => ({
        id: b.player.id,
        name: b.player.name,
        avatar: b.player.avatar,
        color: b.player.color || null,
        skins: b.player.skins || null,
        bet: b.bet,
        auto: b.auto,
        cashed: b.cashed,
        payout: b.payout,
        allin: !!b.allin,
        refunded: !!b.refunded,
        settled: !!b.settled,
    }));
}

function save(g) {
    const run = () => (g._forgotten ? null : persist(g));
    g._save = (g._save || Promise.resolve()).then(run, run);
    return g._save;
}

async function persist(g) {
    if (g._forgotten) return;
    await db.exec(
        `INSERT INTO crash_rounds (room, round_id, phase, point, start_at, crash_at, ends_at, bets, history, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE round_id = VALUES(round_id), phase = VALUES(phase), point = VALUES(point),
            start_at = VALUES(start_at), crash_at = VALUES(crash_at), ends_at = VALUES(ends_at),
            bets = VALUES(bets), history = VALUES(history), updated_at = VALUES(updated_at)`,
        [g.room, g.roundId, g.phase, g.point, g.startAt, g.crashAt || null, g.endsAt, JSON.stringify(pack(g)), JSON.stringify(g.history.slice(-30)), Date.now()],
    );
}

/** oubli la manche apres les ecritures deja en file, pour qu'un vieux save ne la recree pas */
function forget(g) {
    g._forgotten = true;
    const drop = () => db.exec('DELETE FROM crash_rounds WHERE room = ?', [g.room]);
    g._save = (g._save || Promise.resolve()).then(drop, drop);
    return g._save;
}

/** credit une seule fois, meme si le process meurt au milieu et qu'on reprend la manche */
async function creditOnce(userId, amount, key) {
    return db.tx(async (conn) => {
        const res = await db.exec('INSERT IGNORE INTO crash_paid (k) VALUES (?)', [key], conn);
        if (!res.affectedRows) return false;
        if (amount > 0) await eco.addRb(userId, amount, conn, { raw: true });
        return true;
    });
}

function slotFrom(raw, reply = null) {
    return {
        player: { id: String(raw.id), name: raw.name, avatar: raw.avatar, color: raw.color, skins: raw.skins || null },
        bet: Number(raw.bet),
        auto: raw.auto == null ? null : Number(raw.auto),
        cashed: raw.cashed == null ? null : Number(raw.cashed),
        payout: Number(raw.payout) || 0,
        allin: !!raw.allin,
        refunded: !!raw.refunded,
        settled: !!raw.settled,
        reply,
        pending: false,
        feedId: null,
    };
}

/** cree la partie de la salle si besoin et renvoie l'etat courant */
function join(room) {
    let g = games.get(room);
    if (!g) {
        g = { room, roundId: crypto.randomBytes(8).toString('hex'), phase: 'idle', bets: new Map(), history: [], timers: [], point: null, startAt: null, crashAt: null, endsAt: null };
        games.set(room, g);
        betting(g);
    }
    return state(g);
}

function betting(g) {
    clear(g);
    if (!io.alive(g.room)) {
        games.delete(g.room);
        forget(g).catch((e) => log.warn('[crash] oubli', e.message));
        return;
    }
    g.roundId = crypto.randomBytes(8).toString('hex');
    g.phase = 'betting';
    g.bets = new Map();
    g.point = null;
    g.startAt = null;
    g.crashAt = null;
    g.endsAt = Date.now() + BET_MS;
    save(g).catch((e) => log.error('[crash] sauve', e));
    io.broadcast(g.room, state(g));
    later(g, BET_MS, () => fly(g));
}

function fly(g) {
    clear(g);
    // une mise encore en train d'etre debitee n'entre pas dans le vol : bet() la rendra
    for (const [id, b] of [...g.bets]) if (b.pending) g.bets.delete(id);
    const live = [...g.bets.values()].filter((b) => !b.refunded);
    if (!live.length) {
        g.bets = new Map();
        return betting(g);
    }
    g.phase = 'flying';
    g.point = crashPoint();
    g.startAt = Date.now();
    g.crashAt = g.startAt + timeFor(g.point);
    const arm = () => {
        io.broadcast(g.room, state(g));
        for (const b of g.bets.values()) {
            if (!b.refunded && b.auto && b.auto < g.point) later(g, timeFor(b.auto), () => cashout(g, b.player.id, b.auto));
        }
        later(g, g.crashAt - Date.now(), () => crash(g));
    };
    save(g).then(arm, (e) => { log.error('[crash] sauve', e); arm(); });
}

async function crash(g) {
    clear(g);
    g.phase = 'crashed';
    g.history.push(g.point);
    if (g.history.length > 30) g.history.shift();
    io.broadcast(g.room, state(g));
    for (const b of g.bets.values()) {
        if (!b.refunded && !b.cashed && !b.settled) await settle(g, b, 0);
    }
    await save(g);
    later(g, END_MS, () => betting(g));
}

async function settle(g, b, payout) {
    if (b.settled || b.refunded) return;
    const key = `${g.roundId}:${b.player.id}:settle`;
    try {
        const res = await casino.settle({ user: { id: b.player.id } }, b.bet, payout, key);
        if (res.skipped) {
            b.settled = true;
            return;
        }
        b.settled = true;
        b.payout = payout;
        await save(g);
        b.reply?.({ type: 'crash:balance', balance: res.bal });
        feed.finish(b.feedId, { net: res.net, mult: b.cashed || 0, text: b.cashed ? `encaissé ×${b.cashed}` : `💥 ×${g.point}` });
        const notices = (await progress.track(
            { user: { id: b.player.id, username: b.player.name }, channel: null, displayName: b.player.name },
            { play: 1, win: res.net > 0 ? 1 : 0, wager: b.bet },
            { bet: b.bet, net: res.net, allin: b.allin, crashMult: b.cashed || 0 },
        )) || [];
        if (notices.length) b.reply?.({ type: 'notices', list: notices.map(clean) });
        if (res.net >= BIG_WIN) {
            const embed = new EmbedBuilder()
                .setColor('#f1c40f')
                .setDescription(`🚀 **${b.player.name}** a encaissé à **x${b.cashed}** au **Crash** : **+${fmt(res.net)}** ${config.rbEmoji} (mise ${fmt(b.bet)}) !\n-# Lance l'activité depuis un vocal pour jouer avec lui`);
            announce.send({ embeds: [embed] }).catch(() => {});
        }
    } catch (e) {
        log.error('[crash] reglement', e);
    }
}

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
    const roundId = g.roundId;
    const slot = { player, bet: amount, auto: autoAt, cashed: null, payout: 0, reply, pending: true, refunded: false, settled: false, allin: false, feedId: null };
    g.bets.set(player.id, slot);
    const before = await eco.balance(player.id);
    if (!(await eco.takeRb(player.id, amount))) {
        if (g.bets.get(player.id) === slot) g.bets.delete(player.id);
        return { error: `Solde insuffisant (${fmt(before)}).` };
    }
    const still = g.bets.get(player.id) === slot && g.phase === 'betting' && g.roundId === roundId && !g._forgotten;
    if (!still) {
        if (g.bets.get(player.id) === slot) g.bets.delete(player.id);
        await creditOnce(player.id, amount, `${roundId}:${player.id}:late`);
        return { error: 'Trop tard, la fusée est partie !' };
    }
    slot.pending = false;
    slot.allin = amount >= before;
    slot.feedId = feed.start({ player, game: 'crash', bet: amount, allin: slot.allin, balBefore: before, text: autoAt ? `auto ×${autoAt}` : null });
    await save(g);
    io.broadcast(room, { type: 'crash:bet', bet: { player, bet: amount, auto: autoAt, cashed: null, payout: 0 } });
    return { ok: true, balance: before - amount };
}

async function cancel(room, playerId) {
    const g = games.get(room);
    const b = g?.bets.get(playerId);
    if (!b || g.phase !== 'betting' || b.pending || b.refunded) return { error: 'Impossible d\'annuler maintenant.' };
    b.refunded = true;
    await save(g);
    feed.cancel(b.feedId);
    await creditOnce(playerId, b.bet, `${g.roundId}:${playerId}:refund`);
    g.bets.delete(playerId);
    await save(g);
    io.broadcast(room, { type: 'crash:cancel', id: playerId });
    return { ok: true, balance: await eco.balance(playerId) };
}

function cashout(g, playerId, at = null) {
    if (!g || g.phase !== 'flying') return { error: 'Rien à encaisser.' };
    const b = g.bets.get(playerId);
    if (!b || b.cashed || b.refunded || b.settled) return { error: 'Rien à encaisser.' };
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

/** Au boot : une manche en vol est reprise. Les mises deja prises sont reglees, pas perdues. */
async function resume() {
    const rows = await db.q('SELECT * FROM crash_rounds');
    for (const row of rows) {
        let rawBets = [];
        let history = [];
        try { rawBets = JSON.parse(row.bets || '[]'); } catch { rawBets = []; }
        try { history = JSON.parse(row.history || '[]'); } catch { history = []; }
        const g = {
            room: row.room,
            roundId: row.round_id,
            phase: row.phase,
            point: row.point == null ? null : Number(row.point),
            startAt: row.start_at == null ? null : Number(row.start_at),
            crashAt: row.crash_at == null ? null : Number(row.crash_at),
            endsAt: row.ends_at == null ? null : Number(row.ends_at),
            history,
            timers: [],
            bets: new Map(rawBets.map((b) => [String(b.id), slotFrom(b)])),
        };
        games.set(g.room, g);
        await repayRefunds(g);
        if (g.phase === 'betting') {
            const wait = (g.endsAt || 0) - Date.now();
            if (wait > 0) later(g, wait, () => fly(g));
            else fly(g);
        } else if (g.phase === 'flying') {
            await resumeFlight(g);
        } else {
            for (const b of g.bets.values()) {
                if (!b.refunded && !b.settled) await settle(g, b, b.cashed ? b.payout : 0);
            }
            if (io.alive(g.room)) later(g, END_MS, () => betting(g));
            else {
                games.delete(g.room);
                await forget(g);
            }
        }
        log.info(`[crash] reprise ${g.room} (${g.phase}, ${g.bets.size} mise(s))`);
    }
}

/** une annulation sauvee avant le remboursement est rejouee, une seule fois */
async function repayRefunds(g) {
    for (const b of g.bets.values()) {
        if (b.refunded) await creditOnce(b.player.id, b.bet, `${g.roundId}:${b.player.id}:refund`);
    }
}

async function resumeFlight(g) {
    const now = Date.now();
    if (!g.point || !g.startAt || !g.crashAt) {
        for (const b of g.bets.values()) {
            if (!b.refunded && !b.settled) {
                b.refunded = true;
                await creditOnce(b.player.id, b.bet, `${g.roundId}:${b.player.id}:refund`);
            }
        }
        await save(g);
        return betting(g);
    }
    for (const b of g.bets.values()) {
        if (b.refunded || b.settled || b.cashed) continue;
        if (b.auto && b.auto < g.point && now >= g.startAt + timeFor(b.auto)) {
            b.cashed = b.auto;
            b.payout = Math.floor(b.bet * b.auto);
        }
    }
    if (now >= g.crashAt) {
        g.phase = 'crashed';
        for (const b of g.bets.values()) {
            if (!b.refunded && !b.settled) await settle(g, b, b.cashed ? b.payout : 0);
        }
        g.history.push(g.point);
        if (g.history.length > 30) g.history.shift();
        await save(g);
        if (io.alive(g.room)) later(g, END_MS, () => betting(g));
        else {
            games.delete(g.room);
            await forget(g);
        }
        return;
    }
    await save(g);
    for (const b of g.bets.values()) {
        if (!b.refunded && !b.cashed && b.auto && b.auto < g.point) {
            later(g, g.startAt + timeFor(b.auto) - now, () => cashout(g, b.player.id, b.auto));
        }
    }
    later(g, g.crashAt - now, () => crash(g));
}

function clean(s) {
    return String(s).replace(/<a?:\w+:\d+>/g, 'RB').replace(/\*\*|__|`/g, '').replace(/\*(.+?)\*/g, '$1');
}

module.exports = { init, join, bet, cancel, cashout: cashoutIn, resume, multAt, crashPoint, K, MIN_BET, MAX_BET };
