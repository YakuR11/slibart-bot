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
const MIN_GAP = 220; // ms entre deux billes d'un meme joueur (anti-spam, ~4/s)
const BIG_WIN = 3000;

const lastDrop = new Map();

/** une bille : une serie de gauche (0) / droite (1), une case par ligne */
function rollPath(rows) {
    const bytes = crypto.randomBytes(rows);
    return Array.from(bytes, (b) => b & 1);
}

/**
 * Lance une bille pour un joueur.
 * @param player { id, name, user } (user = objet Discord pour l'avatar, peut etre null)
 */
async function drop(player, { bet, risk, rows }) {
    rows = Number(rows);
    if (!TABLES[rows]) return { error: 'Nombre de lignes invalide.' };
    if (!RISKS.includes(risk)) return { error: 'Risque invalide.' };
    bet = Math.floor(Number(bet));
    if (!Number.isFinite(bet) || bet < MIN_BET) return { error: `Mise minimum : ${MIN_BET}.` };
    if (bet > MAX_BET) return { error: `Mise maximum : ${fmt(MAX_BET)}.` };
    const now = Date.now();
    if (now - (lastDrop.get(player.id) || 0) < MIN_GAP) return { error: 'Doucement !', soft: true };
    lastDrop.set(player.id, now);

    const balBefore = await eco.balance(player.id);
    if (!(await eco.takeRb(player.id, bet))) return { error: `Solde insuffisant (${fmt(balBefore)}).` };

    const path = rollPath(rows);
    const bucket = path.reduce((a, b) => a + b, 0);
    const mult = TABLES[rows][risk][bucket];
    const payout = Math.floor(bet * mult);
    const ctx = { user: { id: player.id } };
    const { net, bal, cut } = await casino.settle(ctx, bet, payout);

    // progression (XP, quetes, succes) : silencieuse, renvoyee a l'interface en notifications
    const notices = (await progress.track(
        { user: { id: player.id, username: player.name }, channel: null, displayName: player.name },
        { play: 1, win: net > 0 ? 1 : 0, wager: bet },
        { bet, net, allin: bet >= balBefore },
    )) || [];

    if (net >= BIG_WIN) {
        const embed = new EmbedBuilder()
            .setColor('#f1c40f')
            .setDescription(`🚨 **${player.name}** vient de gagner **${fmt(net)}** ${config.rbEmoji} au **Plinko** (x${mult}, mise ${fmt(bet)}) !\n-# 🚀 Lance l'activité depuis un vocal pour jouer`);
        if (player.user?.displayAvatarURL) embed.setAuthor({ name: player.name, iconURL: player.user.displayAvatarURL({ extension: 'png', size: 64 }) });
        announce.send({ embeds: [embed] }).catch(() => {});
    }

    return { path, bucket, mult, bet, payout, net, cut, balance: bal, notices: notices.map(clean) };
}

/** retire le markdown Discord des notifications (affichees en HTML dans l'Activity) */
function clean(s) {
    return String(s)
        .replace(/<a?:\w+:\d+>/g, 'RB')
        .replace(/\*\*|__|`/g, '')
        .replace(/\*(.+?)\*/g, '$1');
}

module.exports = { TABLES, RISKS, MIN_BET, MAX_BET, drop, rollPath };
