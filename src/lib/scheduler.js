// Taches de fond : loterie (21h), happy hour (1h au hasard le soir), fin de saison (dimanche 21h),
// rappels en MP (work/gw/daily dispo + streak en danger).
const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const log = require('./logger');
const config = require('../config');
const paris = require('./paris');
const boost = require('./boost');
const announce = require('./announce');
const loto = require('./loto');
const { payWeekly } = require('../commands/loot');
const sports = require('./sports');
const upkeep = require('./upkeep');
const foreman = require('./foreman');

const DAILY_CD = 20 * 3600 * 1000;
const STREAK_WARN = 40 * 3600 * 1000; // le streak saute a 48h : on previent a 40h
let lastReminder = Date.now();

async function lotteryTick(client) {
    const p = paris.now();
    if (p.h < 21) return;
    if ((await db.getSetting('loto_last_draw')) === p.day) return;
    await db.setSetting('loto_last_draw', p.day);
    const res = await loto.draw(client);
    if (res) log.info(`[loto] tirage ${res.round} : ${res.winnerId} gagne ${res.pot}`);
}

// recap du casino dans #daily, tous les soirs a 23h55
async function recapTick(client) {
    const p = paris.now();
    if (p.h < 23 || (p.h === 23 && p.mi < 55)) return;
    if ((await db.getSetting('recap_last')) === p.day) return;
    await db.setSetting('recap_last', p.day);
    const res = await require('./recap').send(client, p.day);
    if (res.error) log.info(`[recap] ${res.error}`);
}

async function happyTick() {
    const p = paris.now();
    // chaque jour on tire une heure au hasard entre 18h et 22h59
    if ((await db.getSetting('happy_day')) !== p.day) {
        const h = 18 + Math.floor(Math.random() * 5);
        const mi = Math.floor(Math.random() * 60);
        const start = paris.at(p.y, p.mo, p.d, h, mi);
        await db.setSetting('happy_day', p.day);
        await db.setSetting('happy_start', start);
        await db.setSetting('happy_end', start + 3600 * 1000);
        await db.setSetting('happy_announced', '');
        boost.reset();
        log.info(`[happy hour] aujourd'hui a ${h}h${String(mi).padStart(2, '0')}`);
    }
    const start = Number(await db.getSetting('happy_start', '0'));
    const end = Number(await db.getSetting('happy_end', '0'));
    const now = Date.now();
    if (now >= start && now < end && (await db.getSetting('happy_announced')) !== p.day) {
        await db.setSetting('happy_announced', p.day);
        boost.reset();
        await announce.send({
            content: '@here',
            allowedMentions: { parse: ['everyone'] },
            embeds: [new EmbedBuilder()
                .setColor('#ff6b00')
                .setTitle('🔥 HAPPY HOUR 🔥')
                .setDescription(
                    `Pendant 1h : \`${config.prefix}work\` \`${config.prefix}gw\` \`${config.prefix}daily\` \`${config.prefix}mine\` et **toute l'XP** sont **x2** !\n` +
                    `Fin ${`<t:${Math.floor(end / 1000)}:R>`}`,
                )],
        });
    }
}

async function weeklyTick(client) {
    const p = paris.now();
    if (p.dow !== 0 || p.h < 21) return;
    const week = paris.weekKey();
    if ((await db.getSetting('weekly_paid')) === week) return;
    await db.setSetting('weekly_paid', week);
    const res = await payWeekly(client, announce);
    if (res) log.info(`[saison] ${week} payee a ${res.length} joueur(s)`);
}

async function reminderTick(client) {
    const from = lastReminder;
    const to = Date.now();
    lastReminder = to;
    const due = await db.q(
        `SELECT c.id_user, c.name FROM cooldowns c JOIN profile p ON p.id_user = c.id_user
         WHERE p.remind = 1 AND c.name IN ('work', 'gw') AND c.expires_at > ? AND c.expires_at <= ?`,
        [from, to],
    );
    const daily = await db.q(
        'SELECT id_user FROM profile WHERE remind = 1 AND daily_last > 0 AND daily_last + ? > ? AND daily_last + ? <= ?',
        [DAILY_CD, from, DAILY_CD, to],
    );
    const danger = await db.q(
        'SELECT id_user, daily_streak FROM profile WHERE remind = 1 AND daily_streak >= 3 AND daily_last + ? > ? AND daily_last + ? <= ?',
        [STREAK_WARN, from, STREAK_WARN, to],
    );
    const byUser = new Map();
    const push = (id, n) => byUser.set(String(id), [...(byUser.get(String(id)) || []), n]);
    for (const r of due) push(r.id_user, r.name);
    for (const r of daily) push(r.id_user, 'daily');
    for (const [id, names] of byUser) {
        const user = await client.users.fetch(id).catch(() => null);
        if (!user) continue;
        const list = [...new Set(names)].map((n) => `\`${config.prefix}${n}\``).join(', ');
        await user.send(`⏰ ${list} ${names.length > 1 ? 'sont' : 'est'} dispo ! (\`${config.prefix}rappels\` pour couper)`).catch(() => {});
    }
    for (const r of danger) {
        const user = await client.users.fetch(String(r.id_user)).catch(() => null);
        await user?.send(`⚠️ Ton streak de **${r.daily_streak} jours** saute dans **8h** ! Vite, \`${config.prefix}daily\` 🔥`).catch(() => {});
    }
}

function safe(name, fn) {
    return () => fn().catch((e) => log.warn(`[${name}]`, e.message));
}

function start(client) {
    announce.init(client);
    setInterval(safe('rappels', () => reminderTick(client)), 60_000).unref();
    setInterval(safe('loto', () => lotteryTick(client)), 30_000).unref();
    setInterval(safe('happy', () => happyTick()), 30_000).unref();
    setInterval(safe('saison', () => weeklyTick(client)), 60_000).unref();
    setInterval(safe('sport', () => sports.tick(client)), 60_000).unref();
    setInterval(safe('recap', () => recapTick(client)), 60_000).unref();
    setInterval(safe('entretien', () => upkeep.tick()), 60_000).unref();
    setInterval(safe('contremaitre', () => foreman.tick()), 60_000).unref();
    safe('entretien', () => upkeep.tick())();
    safe('contremaitre', () => foreman.tick())();
    safe('happy', () => happyTick())();
    safe('sport', () => sports.tick(client))();
}

module.exports = { start, lotteryTick, reminderTick, happyTick, weeklyTick };
