const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const db = require('../db');
const cd = require('../lib/cooldowns');
const progress = require('../lib/progress');
const ui = require('../lib/ui');
const { fmt, avatar, nameOf } = require('../lib/utils');
const { paginate, chunk } = require('../lib/paginate');

const RB = () => config.rbEmoji;

/** minuit (heure de Paris) prochain, pour "nouvelles quetes dans..." */
function nextMidnight() {
    const now = new Date();
    const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const offset = now.getTime() - paris.getTime();
    const t = new Date(paris);
    t.setHours(24, 0, 0, 0);
    return t.getTime() + offset;
}

module.exports = [
    {
        name: 'quetes',
        aliases: ['quests', 'q', 'quete'],
        category: 'prog',
        description: 'Tes 3 quetes du jour (+ coffre bonus si tout est fini)',
        async run(ctx) {
            const rows = (await progress.ensureQuests(ctx.user.id)).filter((r) => r.qtype !== '_bonus');
            const bonus = (await db.q(`SELECT 1 FROM quests WHERE id_user = ? AND day = ? AND qtype = '_bonus'`, [ctx.user.id, progress.today()])).length > 0;
            const lines = rows.map((r) => {
                const q = progress.QUESTS[r.qtype];
                const done = Number(r.done) === 1;
                return `${done ? '✅' : '⬜'} ${q.label(r.target)}\n` +
                    `\`${ui.bar(r.progress, r.target, 14)}\` ${fmt(r.progress)}/${fmt(r.target)} · **+${fmt(r.reward)}** ${RB()}`;
            });
            const doneCount = rows.filter((r) => Number(r.done) === 1).length;
            const embed = new EmbedBuilder()
                .setColor(ui.COLORS.quest)
                .setAuthor({ name: `Quêtes du jour · ${ctx.displayName}`, iconURL: avatar(ctx.user) })
                .setDescription(
                    `${lines.join('\n\n')}\n\n` +
                    `${bonus ? '🎁 **Coffre bonus récupéré !**' : `🎁 Coffre bonus : **+${fmt(progress.QUEST_BONUS)}** ${RB()} quand les 3 sont finies (${doneCount}/3)`}\n` +
                    `-# Nouvelles quêtes ${ui.ts(nextMidnight())}`,
                );
            await ctx.reply({ embeds: [embed] });
        },
    },
    {
        name: 'succes',
        aliases: ['achievements', 'ach', 'badges'],
        category: 'prog',
        description: 'Tous les succes (debloques et a debloquer)',
        usage: '[@user]',
        options: [{ name: 'membre', type: 'user', description: 'Membre (toi par defaut)' }],
        async run(ctx, { membre }) {
            const user = membre || ctx.user;
            const owned = new Map((await db.q('SELECT ach, at FROM achievements WHERE id_user = ?', [user.id])).map((r) => [r.ach, Number(r.at)]));
            const all = Object.entries(progress.ACHIEVEMENTS);
            const sorted = [...all.filter(([k]) => owned.has(k)), ...all.filter(([k]) => !owned.has(k))];
            const name = user.id === ctx.user.id ? ctx.displayName : await nameOf(ctx.client, ctx.guild, user.id);
            const pages = chunk(sorted, 8).map((part, k, arr) => new EmbedBuilder()
                .setColor(ui.COLORS.ach)
                .setAuthor({ name: `Succès de ${name} · ${owned.size}/${all.length}`, iconURL: avatar(user) })
                .setDescription(
                    `\`${ui.bar(owned.size, all.length, 20)}\`\n\n` +
                    part.map(([key, a]) => (owned.has(key)
                        ? `🏆 **${a.name}** — ${a.desc} · ${ui.ts(owned.get(key), 'd')}`
                        : `🔒 **${a.name}** — ${a.desc} · *+${fmt(a.reward)}*`)).join('\n'),
                )
                .setFooter({ text: arr.length > 1 ? `page ${k + 1}/${arr.length}` : ' ' }));
            await paginate(ctx, pages);
        },
    },
    {
        name: 'niveau',
        aliases: ['level', 'lvl', 'rank', 'xp'],
        category: 'prog',
        description: 'Ton niveau et ton XP',
        usage: '[@user]',
        options: [{ name: 'membre', type: 'user', description: 'Membre (toi par defaut)' }],
        async run(ctx, { membre }) {
            const user = membre || ctx.user;
            const p = await db.getProfile(user.id);
            const info = progress.levelInfo(p.xp);
            const [{ pos }] = await db.q('SELECT COUNT(*) + 1 AS pos FROM profile WHERE xp > ? AND id_user != ?', [p.xp, config.casinoId]);
            const name = user.id === ctx.user.id ? ctx.displayName : await nameOf(ctx.client, ctx.guild, user.id);
            const embed = new EmbedBuilder()
                .setColor(ui.COLORS.level)
                .setAuthor({ name, iconURL: avatar(user) })
                .setThumbnail(avatar(user))
                .setDescription(
                    `## Niveau ${info.level}\n` +
                    `\`${ui.bar(info.cur, info.need, 20)}\`\n` +
                    `**${fmt(info.cur)}** / ${fmt(info.need)} XP · rang **#${pos}**\n\n` +
                    `Prochain niveau : **+${fmt(150 * (info.level + 1))}** ${RB()}\n` +
                    `-# XP : messages, casino, work, daily, mine, duels, rc...`,
                );
            await ctx.reply({ embeds: [embed] });
        },
    },
    {
        name: 'cd',
        aliases: ['cooldowns', 'timers'],
        category: 'prog',
        description: 'Tout ce que tu peux faire maintenant',
        async run(ctx) {
            const id = ctx.user.id;
            const p = await db.getProfile(id);
            const rows = await db.q('SELECT name, expires_at, uses FROM cooldowns WHERE id_user = ?', [id]);
            const map = Object.fromEntries(rows.map((r) => [r.name, r]));
            const now = Date.now();
            const line = (label, cmd, until) => (until && until > now
                ? `⏳ ${label} · ${ui.ts(until)}`
                : `✅ ${label} · \`${config.prefix}${cmd}\``);
            const rc = map.rc && Number(map.rc.expires_at) > now ? 8 - Number(map.rc.uses) : 8;
            const dailyAt = p.daily_last ? p.daily_last + 20 * 3600 * 1000 : 0;
            const qrows = (await progress.ensureQuests(id)).filter((r) => r.qtype !== '_bonus');
            const qdone = qrows.filter((r) => Number(r.done) === 1).length;
            const embed = new EmbedBuilder()
                .setColor(ui.COLORS.info)
                .setAuthor({ name: `${ctx.displayName} · à faire`, iconURL: avatar(ctx.user) })
                .setDescription([
                    line('Daily', 'daily', dailyAt),
                    line('Work', 'work', Number(map.work?.expires_at || 0)),
                    line('Gamble work', 'gw', Number(map.gw?.expires_at || 0)),
                    line('Mine', 'mine', Number(map.mine?.expires_at || 0)),
                    rc > 0 ? `✅ Invocations · \`${config.prefix}rc\` (${rc}/8)` : `⏳ Invocations · ${ui.ts(Number(map.rc.expires_at))}`,
                    line('Lier un champion', 'rc', Number(map.link?.expires_at || 0)),
                    line('Acheter une cave', 'buy cave', Number(map.cave?.expires_at || 0)),
                    `${qdone >= 3 ? '✅' : '📜'} Quêtes du jour · ${qdone}/3 · \`${config.prefix}quetes\``,
                ].join('\n'))
                .setFooter({ text: p.remind ? '🔔 Rappels en MP activés' : `🔕 ${config.prefix}rappels pour être prévenu en MP` });
            // boutons : tout ce qui est dispo en un clic
            const ready = (until) => !until || until <= now;
            const items = await require('../lib/inventory').list(id);
            const crates = (items.coffre || 0) + (items.coffre_rare || 0) + (items.coffre_legend || 0);
            const btns = [
                ['daily', '🎁', 'Daily', ready(dailyAt)],
                ['work', '💼', 'Work', ready(Number(map.work?.expires_at || 0))],
                ['gamblework', '🎲', 'GW', ready(Number(map.gw?.expires_at || 0))],
                ['mine', '⛏️', 'Mine', ready(Number(map.mine?.expires_at || 0))],
                ['ouvrir', '📦', `Coffres (${crates})`, crates > 0],
            ].filter((b) => b[3]);
            const comps = btns.length ? [new ActionRowBuilder().addComponents(btns.map(([cmd, emoji, label]) =>
                new ButtonBuilder().setCustomId(`go:${cmd}`).setEmoji(emoji).setLabel(label).setStyle(cmd === 'ouvrir' ? ButtonStyle.Primary : ButtonStyle.Success)))] : [];
            const msg = await ctx.reply({ embeds: [embed], components: comps });
            if (comps.length) require('./loot').listenGo(ctx, msg);
        },
    },
    {
        name: 'rappels',
        aliases: ['remind', 'notif'],
        category: 'prog',
        description: 'Le bot te previent en MP quand work/daily sont dispo',
        async run(ctx) {
            await db.ensureProfile(ctx.user.id);
            await db.exec('UPDATE profile SET remind = 1 - remind WHERE id_user = ?', [ctx.user.id]);
            const p = await db.getProfile(ctx.user.id);
            if (p.remind) {
                const dm = await ctx.user.send('🔔 Rappels activés : je te préviens ici quand ton `work`, `gw` ou `daily` est dispo.').catch(() => null);
                if (!dm) {
                    await db.exec('UPDATE profile SET remind = 0 WHERE id_user = ?', [ctx.user.id]);
                    return ctx.fail('Je ne peux pas t\'envoyer de MP. Active « Messages privés » dans les paramètres de confidentialité du serveur.');
                }
                return ctx.reply('🔔 Rappels **activés** (en MP).');
            }
            await ctx.reply('🔕 Rappels **désactivés**.');
        },
    },
];
