const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const config = require('../config');
const db = require('../db');
const eco = require('../lib/economy');
const cd = require('../lib/cooldowns');
const inv = require('../lib/inventory');
const progress = require('../lib/progress');
const paris = require('../lib/paris');
const ui = require('../lib/ui');
const { Ctx } = require('../lib/context');
const { fmt, randInt, sleep, avatar, nameOf, rankEmoji } = require('../lib/utils');

const RB = () => config.rbEmoji;
const handler = () => require('../lib/handler');

// ===========================================================================
// COFFRES : recompense variable (le coeur de l'addiction)
// ===========================================================================
// [poids, type, min, max]
const LOOT = {
    coffre: [
        [72, 'rb', 150, 600],
        [14, 'xp', 60, 160],
        [8, 'cadenas', 1, 1],
        [5, 'coffre_rare', 1, 1],
        [1, 'rb', 3000, 5000], // le petit miracle
    ],
    coffre_rare: [
        [70, 'rb', 800, 2500],
        [14, 'xp', 250, 500],
        [8, 'cadenas', 2, 3],
        [6, 'coffre_legend', 1, 1],
        [2, 'rb', 8000, 15000],
    ],
    coffre_legend: [
        [80, 'rb', 5000, 15000],
        [12, 'xp', 1200, 2500],
        [6, 'coffre_rare', 3, 3],
        [2, 'rb', 50000, 50000],
    ],
};
const ORDER = ['coffre', 'coffre_rare', 'coffre_legend'];
const ALIAS = { commun: 'coffre', c: 'coffre', rare: 'coffre_rare', r: 'coffre_rare', legend: 'coffre_legend', legendaire: 'coffre_legend', l: 'coffre_legend' };
const RARITY_COLOR = { coffre: '#b0bec5', coffre_rare: '#42a5f5', coffre_legend: '#ffb300' };

function roll(table) {
    const total = table.reduce((a, r) => a + r[0], 0);
    let n = Math.random() * total;
    for (const r of table) if ((n -= r[0]) < 0) return r;
    return table[0];
}

async function grant(userId, [, type, min, max]) {
    const amount = randInt(min, max);
    if (type === 'rb') {
        const pay = await eco.addRb(userId, amount);
        return { text: `**+${fmt(pay.net)}** ${RB()}${pay.cut ? ` · 🏦 -${fmt(pay.cut)}` : ''}`, big: pay.net >= 3000 };
    }
    if (type === 'xp') {
        return { text: `**+${fmt(amount)} XP** ⭐`, big: false, xp: amount };
    }
    await inv.add(userId, type, amount);
    return { text: inv.label(type, amount), big: type === 'coffre_legend' };
}

// ===========================================================================
// ROB
// ===========================================================================
const ROB_CD = 2 * 3600 * 1000;
const ROB_IMMUNITY = 60 * 60 * 1000; // une victime ne peut pas etre revolee pendant 1h
const ROB_CHANCE = 0.45;
const ROB_MIN_TARGET = 500;

module.exports = [
    {
        name: 'coffres',
        aliases: ['inv', 'inventaire', 'sac'],
        category: 'prog',
        description: 'Ton inventaire (coffres, cadenas)',
        async run(ctx) {
            const items = await inv.list(ctx.user.id);
            const lines = Object.keys(inv.ITEMS).filter((k) => items[k]).map((k) => `${inv.label(k, items[k])}`);
            const crates = ORDER.reduce((a, k) => a + (items[k] || 0), 0);
            const embed = new EmbedBuilder()
                .setColor(ui.COLORS.quest)
                .setAuthor({ name: `Inventaire de ${ctx.displayName}`, iconURL: avatar(ctx.user) })
                .setDescription(
                    (lines.join('\n') || '*Vide...*') +
                    '\n\n-# 📦 Coffres : `daily` (tous les jours), niveaux, quêtes, minage, drops dans le chat',
                );
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('go:ouvrir').setLabel(crates ? `Ouvrir (${crates})` : 'Aucun coffre').setEmoji('📦').setStyle(ButtonStyle.Success).setDisabled(!crates),
            );
            const msg = await ctx.reply({ embeds: [embed], components: [row] });
            listenGo(ctx, msg);
        },
    },
    {
        name: 'ouvrir',
        aliases: ['open', 'o'],
        category: 'prog',
        description: 'Ouvre un coffre',
        usage: '[commun|rare|legend]',
        options: [{ name: 'type', type: 'string', description: 'Quel coffre (le plus commun par defaut)', choices: [{ name: 'commun', value: 'coffre' }, { name: 'rare', value: 'coffre_rare' }, { name: 'légendaire', value: 'coffre_legend' }] }],
        async run(ctx, { type }) {
            const items = await inv.list(ctx.user.id);
            let kind = type ? (ALIAS[String(type).toLowerCase()] || type) : ORDER.find((k) => items[k]);
            if (!kind || !LOOT[kind]) return ctx.fail(`Tu n'as aucun coffre. Fais ton \`${config.prefix}daily\` 😉`);
            if (!(await inv.take(ctx.user.id, kind))) return ctx.fail(`Tu n'as pas de ${inv.label(kind)}.`);

            const r = roll(LOOT[kind]);
            const res = await grant(ctx.user.id, r);
            const color = RARITY_COLOR[kind];
            const shake = ['📦', '📦💥', '✨📦✨', '💫✨💫'];
            const msg = await ctx.reply({ embeds: [new EmbedBuilder().setColor(color).setAuthor({ name: ctx.displayName, iconURL: avatar(ctx.user) }).setDescription(`## ${inv.ITEMS[kind].emoji} ${inv.ITEMS[kind].name}\n${shake[0]} ça tremble...`)] });
            for (const f of shake.slice(1)) {
                await sleep(550);
                await (ctx.isSlash ? ctx.interaction.editReply.bind(ctx.interaction) : msg.edit.bind(msg))({
                    embeds: [new EmbedBuilder().setColor(color).setAuthor({ name: ctx.displayName, iconURL: avatar(ctx.user) }).setDescription(`## ${inv.ITEMS[kind].emoji} ${inv.ITEMS[kind].name}\n${f}`)],
                }).catch(() => {});
            }
            const left = await inv.list(ctx.user.id);
            const remaining = ORDER.reduce((a, k) => a + (left[k] || 0), 0);
            const final = new EmbedBuilder()
                .setColor(res.big ? '#f1c40f' : color)
                .setAuthor({ name: ctx.displayName, iconURL: avatar(ctx.user) })
                .setDescription(`## ${inv.ITEMS[kind].emoji} ${inv.ITEMS[kind].name}\n${res.big ? '🚨 **ÉNORME !** ' : '✨ '}${res.text}`)
                .setFooter({ text: remaining ? `Encore ${remaining} coffre(s)` : 'Plus de coffre · reviens demain pour le daily' });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('go:ouvrir').setLabel(remaining ? `Ouvrir le suivant (${remaining})` : 'Aucun coffre').setEmoji('📦').setStyle(ButtonStyle.Success).setDisabled(!remaining),
            );
            await (ctx.isSlash ? ctx.interaction.editReply.bind(ctx.interaction) : msg.edit.bind(msg))({ embeds: [final], components: [row] }).catch(() => {});
            if (remaining) listenGo(ctx, msg);
            // l'XP gagnee dans un coffre peut faire monter de niveau
            if (res.xp) await progress.track(ctx, {}, {}, { xpOverride: res.xp });
        },
    },
    {
        name: 'rob',
        aliases: ['voler', 'vol'],
        category: 'eco',
        description: `Tente de voler quelqu'un (${Math.round(ROB_CHANCE * 100)}% de reussite, toutes les 2h)`,
        usage: '<@user>',
        options: [{ name: 'membre', type: 'user', required: true, description: 'Ta victime' }],
        async run(ctx, { membre: target }) {
            const me = ctx.user;
            if (target.id === me.id || target.bot) return ctx.fail('Choisis une vraie victime.');
            const myBal = await eco.balance(me.id);
            if (myBal < 200) return ctx.fail(`Il te faut au moins **200** ${RB()} pour payer l'amende si tu te fais choper.`);
            const theirBal = await eco.balance(target.id);
            if (theirBal < ROB_MIN_TARGET) return ctx.fail(`**${target.username}** est trop pauvre (< ${ROB_MIN_TARGET}), aie pitié.`);
            const immune = await cd.remaining(target.id, 'robbed');
            if (immune) return ctx.fail(`**${target.username}** vient de se faire voler, il est sous protection ${ui.ts(Date.now() + immune)}.`);
            const left = await cd.take(me.id, 'rob', ROB_CD);
            if (left) return ctx.fail(`Profil bas... prochain vol ${ui.ts(Date.now() + left)}.`);

            const tag = `<@${target.id}>`;
            // cadenas : bloque le vol et se consomme
            if (await inv.take(target.id, 'cadenas')) {
                return ctx.reply({
                    content: `🔒 ${tag}, **${ctx.displayName}** a essayé de te voler mais ton **cadenas** a tenu ! (il a sauté)`,
                    allowedMentions: { users: [target.id] },
                });
            }
            const suspense = await ctx.reply(`🥷 **${ctx.displayName}** se faufile vers les poches de **${target.username}**...`);
            await sleep(1500);
            let text;
            if (Math.random() < ROB_CHANCE) {
                const pct = randInt(10, 25) / 100;
                const amount = Math.min(5000, Math.floor(theirBal * pct));
                const pay = await eco.transfer(target.id, me.id, amount);
                if (!pay) return ctx.channel.send('Il a tout dépensé entre temps, raté.');
                await cd.set(target.id, 'robbed', ROB_IMMUNITY);
                const bite = pay.cut ? `\n🏦 La banque en prend **${fmt(pay.cut)}** sur le butin.` : '';
                text = `💰 **RÉUSSI !** **${ctx.displayName}** a volé **${fmt(amount)}** ${RB()} à ${tag} ! 😈${bite}\n-# ${tag} : \`${config.prefix}rob @${ctx.displayName}\` dans 1h pour te venger... ou achète un \`cadenas\``;
            } else {
                const fine = Math.min(2000, Math.max(100, Math.floor(myBal * 0.15)));
                await eco.transfer(me.id, target.id, fine);
                text = `🚔 **CHOPÉ !** **${ctx.displayName}** s'est fait attraper et paye **${fmt(fine)}** ${RB()} d'amende à ${tag}. Bien fait.`;
            }
            await ctx.channel.send({ content: text, allowedMentions: { users: [target.id] } });
            void suspense;
        },
    },
    {
        name: 'semaine',
        aliases: ['saison', 'week', 'weekly'],
        category: 'top',
        description: 'Classement casino de la semaine (prix le dimanche a 21h)',
        async run(ctx) {
            const week = paris.weekKey();
            const rows = await db.q('SELECT id_user, net, games FROM weekly WHERE week = ? AND id_user != ? ORDER BY net DESC LIMIT 10', [week, config.casinoId]);
            const lines = await Promise.all(rows.map(async (r, i) => {
                const n = await nameOf(ctx.client, ctx.guild, r.id_user);
                const me = String(r.id_user) === ctx.user.id ? ' ⬅️' : '';
                return `${rankEmoji(i)} · ${i + 1}. ${n} — **${Number(r.net) >= 0 ? '+' : ''}${fmt(r.net)}** ${RB()} · ${r.games} parties${me}`;
            }));
            const embed = new EmbedBuilder()
                .setColor(ui.COLORS.bigwin)
                .setTitle('🏆 Saison de la semaine · casino')
                .setDescription(
                    `Fin de saison ${ui.ts(paris.weekEnd())}\n🥇 **${fmt(WEEKLY_PRIZES[0])}** · 🥈 **${fmt(WEEKLY_PRIZES[1])}** · 🥉 **${fmt(WEEKLY_PRIZES[2])}** ${RB()} + coffres\n\n` +
                    (lines.join('\n') || '*Personne n\'a joué cette semaine... la place est libre*'),
                )
                .setFooter({ text: 'Classement au gain net du casino (gains - pertes)' });
            await ctx.reply({ embeds: [embed] });
        },
    },
];

const WEEKLY_PRIZES = [10000, 5000, 2500];
const WEEKLY_CRATES = ['coffre_legend', 'coffre_rare', 'coffre_rare'];

/** Fin de saison (appele par le scheduler le dimanche a 21h) */
async function payWeekly(client, announce) {
    const week = paris.weekKey();
    const rows = await db.q('SELECT id_user, net FROM weekly WHERE week = ? AND id_user != ? AND net > 0 ORDER BY net DESC LIMIT 3', [week, config.casinoId]);
    if (!rows.length) return null;
    const lines = [];
    for (const [i, r] of rows.entries()) {
        const id = String(r.id_user);
        const pay = await eco.addRb(id, WEEKLY_PRIZES[i]);
        await inv.add(id, WEEKLY_CRATES[i]);
        lines.push(`${['🥇', '🥈', '🥉'][i]} <@${id}> (+${fmt(r.net)}) → **${fmt(pay.net)}** ${RB()}${pay.cut ? ` (banque -${fmt(pay.cut)})` : ''} + ${inv.label(WEEKLY_CRATES[i])}`);
    }
    await announce.send({
        content: rows.map((r) => `<@${r.id_user}>`).join(' '),
        embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle('🏆 FIN DE SAISON').setDescription(`${lines.join('\n')}\n\nNouvelle saison lancée, tout le monde repart à 0. \`${config.prefix}semaine\``)],
    });
    return rows;
}

/** Boutons "go:<commande>" : lance une commande en un clic */
function listenGo(ctx, msg) {
    if (!msg?.createMessageComponentCollector) return;
    const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 90_000, filter: (i) => i.customId.startsWith('go:') });
    col.on('collect', async (i) => {
        if (i.user.id !== ctx.user.id) return i.reply({ content: 'Pas à toi 😉', flags: MessageFlags.Ephemeral }).catch(() => {});
        const name = i.customId.slice(3);
        const cmd = handler().commands.get(name);
        if (!cmd) return;
        if (name === 'ouvrir') col.stop('used');
        const next = new Ctx(ctx.client, { interaction: i, command: cmd, alias: name });
        next.args = {};
        await handler().run(next);
    });
    col.on('end', () => msg.edit({ components: [] }).catch(() => {}));
}

module.exports.payWeekly = payWeekly;
module.exports.listenGo = listenGo;
