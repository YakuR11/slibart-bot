// Petit "design system" du bot : couleurs, barres de progression, timestamps Discord.
const { EmbedBuilder } = require('discord.js');
const { avatar, fmt } = require('./utils');
const config = require('../config');

const COLORS = {
    win: '#2ecc71',
    bigwin: '#f1c40f',
    lose: '#e74c3c',
    push: '#95a5a6',
    casino: '#9b59b6',
    info: '#5865f2',
    eco: '#f7ffcc',
    level: '#00d2ff',
    quest: '#ff9f43',
    ach: '#ffd700',
};

/** Timestamp Discord qui se met a jour tout seul : "dans 12 minutes" */
const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

/** ▰▰▰▰▱▱▱▱ */
function bar(cur, max, len = 12) {
    const f = max > 0 ? Math.max(0, Math.min(len, Math.round((cur / max) * len))) : 0;
    return '▰'.repeat(f) + '▱'.repeat(len - f);
}

const RB = () => config.rbEmoji;
const money = (n) => `**${fmt(n)}** ${RB()}`;
const signed = (n) => `**${n >= 0 ? '+' : '-'}${fmt(Math.abs(n))}** ${RB()}`;

/** Embed de jeu : auteur = joueur, couleur selon le resultat */
function gameEmbed(ctx, title, color = COLORS.casino) {
    const e = new EmbedBuilder().setColor(color).setAuthor({ name: `${ctx.displayName} · ${title}`, iconURL: avatar(ctx.user) });
    return e;
}

/** Couleur et titre selon le gain net */
function resultStyle(net, bet) {
    if (net > 0 && net >= bet * 5) return { color: COLORS.bigwin, tag: '🚨 BIG WIN 🚨' };
    if (net > 0) return { color: COLORS.win, tag: '🎉 Gagné' };
    if (net === 0) return { color: COLORS.push, tag: '🤝 Égalité' };
    return { color: COLORS.lose, tag: '💀 Perdu' };
}

module.exports = { COLORS, ts, bar, money, signed, gameEmbed, resultStyle };
