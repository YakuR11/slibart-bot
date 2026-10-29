// Logique du Plinko cote serveur : c'est le serveur qui tire le chemin de la bille,
// le navigateur ne fait que l'animer (impossible de tricher depuis l'interface).
const crypto = require('node:crypto');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const eco = require('../lib/economy');
const db = require('../db');
const paris = require('../lib/paris');
const progress = require('../lib/progress');
const announce = require('../lib/announce');
const { fmt } = require('../lib/utils');
const log = require('../lib/logger');

// Tables classiques du Plinko : ~99 % reverse aux joueurs, 1 % pour la banque du slip
const TABLES = {
    8: {
        low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
        medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
        high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    },
    12: {
        low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
        medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
        high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    },
    16: {
        low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
        medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
        high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
    },
};
const RISKS = ['low', 'medium', 'high'];
const MIN_BET = 10;
const MAX_BET = 1_000_000;
const BIG_WIN = 3000;
const QUEUE_MAX = 40; // billes en attente max par joueur (au-dela : vraiment trop de spam)

const queues = new Map(); // joueur -> { tail: Promise, size }

/** une bille : une serie de gauche (0) / droite (1), une case par ligne */
function rollPath(rows) {
    const bytes = crypto.randomBytes(rows);
    return Array.from(bytes, (b) => b & 1);
}

function check({ bet, risk, rows }) {
    rows = Number(rows);
    if (!TABLES[rows]) return { error: 'Nombre de lignes invalide.' };
    if (!RISKS.includes(risk)) return { error: 'Risque invalide.' };
    bet = Math.floor(Number(bet));
    if (!Number.isFinite(bet) || bet < MIN_BET) return { error: `Mise minimum : ${MIN_BET}.` };
    if (bet > MAX_BET) return { error: `Mise maximum : ${fmt(MAX_BET)}.` };
    return { bet, risk, rows };
}

/**
 * Lance une bille pour un joueur.
 * Les billes d'un meme joueur passent dans une file (une a la fois) : on ne refuse plus
 * les clics rapides, on les enchaine. Ca evite les billes "perdues" quand on spamme.
 *
 * @param player { id, name, user } (user = objet Discord pour l'avatar, peut etre null)
 * @param hooks.onBall(data) appele des que la mise est prise et le chemin tire (avant le
 *        reglement en base) : l'interface peut lancer l'animation tout de suite.
 * @param hooks.onNotices(list) progression (XP, quetes...) calculee apres coup
 */
function drop(player, params, hooks = {}) {
    const p = check(params);
    if (p.error) return Promise.resolve(p);
    let q = queues.get(player.id);
    if (!q) queues.set(player.id, (q = { tail: Promise.resolve(), size: 0 }));
    if (q.size >= QUEUE_MAX) return Promise.resolve({ error: 'Trop de billes en attente, laisse-les tomber !', soft: true });
    q.size++;
    const run = q.tail.then(() => play(player, p, hooks)).catch((e) => {
        log.error('[plinko]', e);
        return { error: 'Erreur serveur, réessaie.' };
    }).finally(() => {
        q.size--;
        if (!q.size && queues.get(player.id) === q) queues.delete(player.id);
    });
    q.tail = run;
    return run;
}

async function play(player, { bet, risk, rows }, hooks) {
    const id = String(player.id);
    const path = rollPath(rows);
    const bucket = path.reduce((a, b) => a + b, 0);
    const mult = TABLES[rows][risk][bucket];
    const payout = Math.floor(bet * mult);

    // Chemin rapide (joueur sans dette) : mise prise et gain verse en UNE requete atomique.
    // C'est la seule partie qui bloque la bille suivante, donc elle doit etre courte.
    let received = payout;
    let cut = 0;
    const fast = await db.exec(
        'UPDATE profile SET rb = rb - ? + ? WHERE id_user = ? AND rb >= ? AND debt <= 0',
        [bet, payout, id, bet],
    );
    if (!fast.affectedRows) {
        // endette (une part du gain rembourse la dette) ou solde insuffisant
        if (!(await eco.takeRb(id, bet))) {
            return { error: `Solde insuffisant (${fmt(await eco.balance(id))}).`, broke: true };
        }
        const pay = payout > 0 ? await eco.addRb(id, payout) : { net: 0, cut: 0 };
        received = pay.net;
        cut = pay.cut;
    }
    const [[row]] = await db.pool.query('SELECT rb FROM profile WHERE id_user = ?', [id]);
    const bal = Number(row?.rb || 0);
    hooks.onBall?.({ path, bucket, mult, bet, payout, rows, risk });

    const net = received - bet;
    later(id, () => stats(id, bet, payout, received));
    round(player, { bet, net, allin: received >= bal }, hooks);
    if (net >= BIG_WIN) announceWin(player, net, mult, bet);

    return { path, bucket, mult, bet, payout, received, net, cut, balance: bal, notices: [] };
}

/** Taches de fond d'un joueur, une a la fois, sans jamais bloquer ses billes */
const background = new Map();
function later(id, fn) {
    const prev = background.get(id) || Promise.resolve();
    const next = prev.then(fn).catch((e) => log.warn('[plinko] stats', e.message));
    background.set(id, next);
    next.finally(() => { if (background.get(id) === next) background.delete(id); });
}

/** Stats de gains/pertes et part de la banque du slip (pas de "partie" comptee ici, voir round()) */
async function stats(id, bet, payout, received) {
    const pocket = received - bet;
    if (pocket > 0) {
        await eco.bump(id, { wincount: pocket });
        await db.exec('UPDATE profile SET maxwin = GREATEST(maxwin, ?) WHERE id_user = ?', [pocket, id]);
    } else if (pocket < 0) {
        await eco.bump(id, { pertecount: -pocket });
    }
    if (bet > payout) await eco.toCasino(bet - payout);
}

/**
 * Anti-farm : une rafale de billes = UNE partie pour la progression.
 * Toutes les billes lancees dans une fenetre de 5 s sont regroupees : 1 partie, gagnee si le
 * total est positif. Sinon on spammait des billes a 10 pour farmer niveaux, quetes et succes
 * ("Accro", "Pilier du casino", series de 10...) qui rapportent bien plus que la mise.
 */
const ROUND_MS = 5000;
const rounds = new Map();

function round(player, { bet, net, allin }, hooks) {
    let r = rounds.get(player.id);
    if (!r) {
        r = { player, wager: 0, net: 0, maxBet: 0, allin: false, balls: 0 };
        rounds.set(player.id, r);
        r.timer = setTimeout(() => closeRound(player.id), ROUND_MS);
    }
    r.hooks = hooks;
    r.balls++;
    r.wager += bet;
    r.net += net;
    r.maxBet = Math.max(r.maxBet, bet);
    r.allin = r.allin || allin;
}

function closeRound(id) {
    const r = rounds.get(id);
    rounds.delete(id);
    if (!r) return;
    later(id, async () => {
        const won = r.net > 0;
        await eco.bump(id, { gamblecount: 1 });
        await progress.streak(id, won); // une rafale a 0 casse la serie
        await db.exec(
            'INSERT INTO weekly (week, id_user, net, games) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE net = net + VALUES(net), games = games + 1',
            [paris.weekKey(), id, r.net],
        );
        const notices = (await progress.track(
            { user: { id, username: r.player.name }, channel: null, displayName: r.player.name },
            { play: 1, win: won ? 1 : 0, wager: r.wager },
            { bet: r.maxBet, net: r.net, allin: r.allin },
        )) || [];
        if (notices.length) r.hooks?.onNotices?.(notices.map(clean));
    });
}

function announceWin(player, net, mult, bet) {
    const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setDescription(`🚨 **${player.name}** vient de gagner **${fmt(net)}** ${config.rbEmoji} au **Plinko** (x${mult}, mise ${fmt(bet)}) !\n-# 🚀 Lance l'activité depuis un vocal pour jouer`);
    if (player.user?.displayAvatarURL) embed.setAuthor({ name: player.name, iconURL: player.user.displayAvatarURL({ extension: 'png', size: 64 }) });
    announce.send({ embeds: [embed] }).catch(() => {});
}

/** retire le markdown Discord des notifications (affichees en HTML dans l'Activity) */
function clean(s) {
    return String(s)
        .replace(/<a?:\w+:\d+>/g, 'RB')
        .replace(/\*\*|__|`/g, '')
        .replace(/\*(.+?)\*/g, '$1');
}

module.exports = { TABLES, RISKS, MIN_BET, MAX_BET, drop, rollPath, check };
