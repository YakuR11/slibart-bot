// Loterie du serveur : tickets a 100, tirage tous les jours a 21h (heure de Paris).
// Les tickets s'achetent dans l'app ; le tirage est lance par le scheduler.
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
const eco = require('./economy');
const progress = require('./progress');
const ui = require('./ui');
const { fmt, avatar } = require('./utils');

const TICKET = 100;
const MAX_TICKETS = 100;
const LOTO_BONUS = 500; // le casino ajoute ca au pot a chaque tirage
const LOTO_HOUR = 21;

function nextDraw() {
    const now = new Date();
    const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const offset = now.getTime() - paris.getTime();
    const target = new Date(paris);
    target.setHours(LOTO_HOUR, 0, 0, 0);
    if (paris >= target) target.setDate(target.getDate() + 1);
    return target.getTime() + offset;
}

async function state() {
    const round = Number(await db.getSetting('loto_round', '1'));
    const rows = await db.q('SELECT id_user, tickets FROM lottery WHERE round_id = ? ORDER BY tickets DESC', [round]);
    const total = rows.reduce((a, r) => a + Number(r.tickets), 0);
    return { round, rows, total, pot: total * TICKET + (total ? LOTO_BONUS : 0) };
}

/** achete n tickets (ou 'max') -> { n, have } ou { error } */
async function buy(userId, n) {
    const { round } = await state();
    const res = await db.tx(async (conn) => {
        const [[row]] = await conn.query('SELECT tickets FROM lottery WHERE round_id = ? AND id_user = ? FOR UPDATE', [round, userId]);
        const have = Number(row?.tickets || 0);
        const room = MAX_TICKETS - have;
        if (room <= 0) return { error: `Max ${MAX_TICKETS} tickets par tirage.` };
        const bal = await eco.balance(userId, conn);
        let k = n === 'max' ? Math.min(room, Math.floor(bal / TICKET)) : Math.floor(Number(n));
        if (!k || k < 1) return { error: bal < TICKET ? `Il te faut au moins ${TICKET} RB.` : 'Nombre de tickets invalide.' };
        k = Math.min(k, room);
        if (!(await eco.takeRb(userId, k * TICKET, conn))) return { error: `Il te faut ${fmt(k * TICKET)} RB.` };
        await conn.query(
            'INSERT INTO lottery (round_id, id_user, tickets) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE tickets = tickets + VALUES(tickets)',
            [round, userId, k],
        );
        return { n: k, have: have + k };
    });
    if (!res.error) await progress.track({ user: { id: userId }, channel: null }, { wager: res.n * TICKET, loto: 1 }, {});
    return res;
}

/** Tirage (appele par le scheduler a 21h) */
async function draw(client) {
    const { round, rows, total, pot } = await state();
    if (!total) return null;
    let n = Math.random() * total;
    let winner = rows[0];
    for (const r of rows) {
        if ((n -= Number(r.tickets)) < 0) { winner = r; break; }
    }
    const winnerId = String(winner.id_user);
    const pay = await eco.addRb(winnerId, pot);
    await db.setSetting('loto_round', round + 1);
    const user = await client.users.fetch(winnerId).catch(() => null);
    const channel = await require('./channels').find(client, 'bot')
        || await require('./announce').channel();
    if (channel && user) {
        const embed = new EmbedBuilder()
            .setColor(ui.COLORS.bigwin)
            .setTitle(`🎟️ LOTERIE · tirage n°${round}`)
            .setDescription(`🥳 ${user} remporte le pot de **${fmt(pay.net)}** ${config.rbEmoji}${pay.cut ? ` (banque -${fmt(pay.cut)}, dette ${fmt(pay.debt)})` : ''} avec **${winner.tickets}** ticket(s) sur ${total} !\n\nProchain tirage ${ui.ts(nextDraw())} · \`${config.prefix}loto\` dans le chat`)
            .setThumbnail(avatar(user));
        await channel.send({ content: `${user}`, embeds: [embed] }).catch(() => {});
    }
    if (user) await progress.track({ user, channel: null }, { loto: 1 }, { lotoWin: true });
    // dans le centre des paris de l'app
    try {
        const feed = require('../activity/feed');
        const name = user?.globalName || user?.username || '???';
        const av = user?.avatar ? `avatar/${winnerId}/${user.avatar}` : `avatar/default/${Number(BigInt(winnerId) >> 22n) % 6}`;
        const id = feed.start({ player: { id: winnerId, name, avatar: av }, game: 'loto', bet: Number(winner.tickets) * TICKET, text: `tirage n°${round}` });
        feed.finish(id, { net: pay.net - Number(winner.tickets) * TICKET, text: `remporte le pot de ${fmt(pay.net)}` });
    } catch { /* app pas lancee */ }
    return { winnerId, pot, round };
}

module.exports = { TICKET, MAX_TICKETS, LOTO_HOUR, nextDraw, state, buy, draw };
