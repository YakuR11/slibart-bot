// Logique du Plinko cote serveur : c'est le serveur qui tire le chemin de la bille,
// le navigateur ne fait que l'animer (impossible de tricher depuis l'interface).
const crypto = require('node:crypto');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const eco = require('../lib/economy');
const casino = require('../lib/casino');
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
    if (!(await eco.takeRb(player.id, bet))) {
        return { error: `Solde insuffisant (${fmt(await eco.balance(player.id))}).`, broke: true };
    }
    const path = rollPath(rows);
    const bucket = path.reduce((a, b) => a + b, 0);
    const mult = TABLES[rows][risk][bucket];
    const payout = Math.floor(bet * mult);
    hooks.onBall?.({ path, bucket, mult, bet, payout, rows, risk });

    const ctx = { user: { id: player.id } };
    const { net, bal, cut } = await casino.settle(ctx, bet, payout);
    const received = net + bet;

    // le reste (XP, quetes, annonce) ne bloque pas la bille suivante
    after(player, { bet, net, mult, allin: bal - received <= 0 }, hooks);

    return { path, bucket, mult, bet, payout, received, net, cut, balance: bal, notices: [] };
}

function after(player, { bet, net, mult, allin }, hooks) {
    (async () => {
        const notices = (await progress.track(
            { user: { id: player.id, username: player.name }, channel: null, displayName: player.name },
            { play: 1, win: net > 0 ? 1 : 0, wager: bet },
            { bet, net, allin },
        )) || [];
        if (notices.length) hooks.onNotices?.(notices.map(clean));
        if (net >= BIG_WIN) {
            const embed = new EmbedBuilder()
                .setColor('#f1c40f')
                .setDescription(`🚨 **${player.name}** vient de gagner **${fmt(net)}** ${config.rbEmoji} au **Plinko** (x${mult}, mise ${fmt(bet)}) !\n-# 🚀 Lance l'activité depuis un vocal pour jouer`);
            if (player.user?.displayAvatarURL) embed.setAuthor({ name: player.name, iconURL: player.user.displayAvatarURL({ extension: 'png', size: 64 }) });
            announce.send({ embeds: [embed] }).catch(() => {});
        }
    })().catch((e) => log.warn('[plinko] progression', e.message));
}

/** retire le markdown Discord des notifications (affichees en HTML dans l'Activity) */
function clean(s) {
    return String(s)
        .replace(/<a?:\w+:\d+>/g, 'RB')
        .replace(/\*\*|__|`/g, '')
        .replace(/\*(.+?)\*/g, '$1');
}

module.exports = { TABLES, RISKS, MIN_BET, MAX_BET, drop, rollPath, check };
