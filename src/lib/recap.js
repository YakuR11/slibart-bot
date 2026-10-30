// Recap du jour dans #daily : top / flop du casino, plus gros gain et plus grosse perte par jeu,
// le plus accro. Base : le journal des paris de l'app (gamble_log).
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
const channels = require('./channels');
const paris = require('./paris');
const { fmt } = require('./utils');

const GAMES = {
    plinko: '🎯 Plinko', crash: '🚀 Crash', roulette: '🎡 Roulette', slots: '🎰 Slots',
    blackjack: '🃏 Blackjack', mines: '💣 Mines', loto: '🎟️ Loto', duel: '⚔️ Duel',
};

async function build(client, day = paris.now().day) {
    const rows = await db.q('SELECT id_user, game, bet, net FROM gamble_log WHERE day = ?', [day]);
    if (!rows.length) return null;
    const names = new Map();
    const name = async (id) => {
        if (!names.has(id)) {
            const u = await client.users.fetch(id).catch(() => null);
            names.set(id, u?.globalName || u?.username || '???');
        }
        return names.get(id);
    };
    const RB = config.rbEmoji;

    // par joueur
    const per = new Map();
    for (const r of rows) {
        const p = per.get(r.id_user) || { net: 0, games: 0, wager: 0 };
        p.net += Number(r.net);
        p.games++;
        p.wager += Number(r.bet);
        per.set(r.id_user, p);
    }
    const list = [...per.entries()].map(([id, p]) => ({ id, ...p }));
    const top = [...list].sort((a, b) => b.net - a.net).filter((x) => x.net > 0).slice(0, 3);
    const flop = [...list].sort((a, b) => a.net - b.net).filter((x) => x.net < 0).slice(0, 3);
    const addict = [...list].sort((a, b) => b.games - a.games)[0];
    const medals = ['🥇', '🥈', '🥉'];

    const embed = new EmbedBuilder()
        .setColor('#ffb627')
        .setTitle(`📰 Le récap du casino · ${day.split('-').reverse().join('/')}`)
        .setDescription(`**${fmt(rows.length)}** paris · **${fmt(list.reduce((a, x) => a + x.wager, 0))}** ${RB} misés · ${list.length} joueur(s)`);

    if (top.length) embed.addFields({ name: '🏆 Les rois du jour', value: (await Promise.all(top.map(async (x, i) => `${medals[i]} **${await name(x.id)}** +${fmt(x.net)} ${RB}`))).join('\n'), inline: true });
    if (flop.length) embed.addFields({ name: '🤡 Les plus gros perdants', value: (await Promise.all(flop.map(async (x, i) => `${['💀', '😭', '🥲'][i]} **${await name(x.id)}** ${fmt(x.net)} ${RB}`))).join('\n'), inline: true });

    // par jeu
    const lines = [];
    for (const [game, label] of Object.entries(GAMES)) {
        const g = rows.filter((r) => r.game === game);
        if (!g.length) continue;
        const best = g.reduce((a, r) => (Number(r.net) > Number(a.net) ? r : a));
        const worst = g.reduce((a, r) => (Number(r.net) < Number(a.net) ? r : a));
        const parts = [];
        if (Number(best.net) > 0) parts.push(`📈 ${await name(best.id_user)} +${fmt(best.net)}`);
        if (Number(worst.net) < 0) parts.push(`📉 ${await name(worst.id_user)} ${fmt(worst.net)}`);
        lines.push(`**${label}** · ${g.length} partie(s)${parts.length ? `\n> ${parts.join(' · ')}` : ''}`);
    }
    if (lines.length) embed.addFields({ name: '🎲 Jeu par jeu', value: lines.join('\n').slice(0, 1024) });
    if (addict) embed.addFields({ name: '🧟 Le plus accro', value: `**${await name(addict.id)}** avec **${fmt(addict.games)}** paris (${fmt(addict.wager)} ${RB} misés)` });
    embed.setFooter({ text: 'Tous les soirs à 23h55 · =g =slots =bj =pk marchent dans le chat, y compris sur téléphone' });
    return embed;
}

async function send(client, day) {
    const ch = await channels.find(client, 'daily');
    if (!ch) return { error: 'Salon #daily introuvable (ou mets DAILY_CHANNEL_ID dans le .env).' };
    const embed = await build(client, day);
    if (!embed) return { error: 'Aucun pari aujourd\'hui.' };
    await ch.send({ embeds: [embed] });
    return { ok: true };
}

module.exports = { build, send };
