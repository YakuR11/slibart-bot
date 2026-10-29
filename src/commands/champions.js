const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const config = require('../config');
const db = require('../db');
const cd = require('../lib/cooldowns');
const dd = require('../lib/ddragon');
const { duration, avatar, nameOf } = require('../lib/utils');
const { paginate, chunk } = require('../lib/paginate');
const progress = require('../lib/progress');
const ui = require('../lib/ui');

const RC_MAX = 8; // rolls par heure
const RC_WINDOW = 3600 * 1000;
const LINK_CD = 90 * 60 * 1000; // 1h30 entre deux liens

const champImg = (c) => (c.ddid ? dd.loadingImg(c.ddid) : c.img);
const squash = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** Trouve un champion par nom approximatif : "kaisa", "Kai'Sa", "chogath", "mf"... */
async function findChampion(input) {
    const all = await db.q('SELECT * FROM champions');
    const s = squash(input);
    const NICK = { mf: 'missfortune', tf: 'twistedfate', lb: 'leblanc', ww: 'warwick', j4: 'jarvaniv', asol: 'aurelionsol', mundo: 'drmundo', yi: 'masteryi', kog: 'kogmaw', nunu: 'nunuwillump', renata: 'renataglasc' };
    const target = NICK[s] || s;
    return all.find((c) => squash(c.name) === target || squash(c.ddid || '') === target)
        || all.find((c) => squash(c.name).startsWith(target))
        || all.find((c) => squash(c.name).includes(target))
        || null;
}

module.exports = [
    {
        name: 'rc',
        aliases: ['rollchamp'],
        category: 'champ',
        description: `Invoque un champion libre (${RC_MAX}/heure) et lie-le avec ⛓️`,
        async run(ctx) {
            const lim = await cd.window(ctx.user.id, 'rc', RC_MAX, RC_WINDOW);
            if (!lim.ok) return ctx.fail(`Tu as utilisé tes **${RC_MAX}** invocations. Reset ${ui.ts(Date.now() + lim.resetIn)}.`);

            const [champ] = await db.q(`SELECT * FROM champions WHERE belong IS NULL OR belong = '' ORDER BY RAND() LIMIT 1`);
            if (!champ) return ctx.reply('Tous les champions sont déjà liés ! 😳');

            const base = () => new EmbedBuilder()
                .setAuthor({ name: champ.name })
                .setDescription(`*${champ.title || ''}*${champ.tags ? `\n-# ${champ.tags}` : ''}`)
                .setImage(champImg(champ));
            const row = (disabled = false) => new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rc:link').setEmoji('⛓️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
            );
            const msg = await ctx.send({
                embeds: [base().setColor('#ffa8c4').setFooter({ text: `Invocation par ${ctx.displayName} · ${lim.left} restante(s)`, iconURL: avatar(ctx.user) })],
                components: [row()],
            });

            progress.track(ctx, { rc: 1 });
            const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
            col.on('collect', async (i) => {
                const left = await cd.remaining(i.user.id, 'link');
                if (left) return i.reply({ content: `Tu pourras lier un autre champion ${ui.ts(Date.now() + left)}.`, flags: MessageFlags.Ephemeral });
                // atomique : si deux personnes cliquent en meme temps, un seul gagne
                const res = await db.exec(`UPDATE champions SET belong = ? WHERE id = ? AND (belong IS NULL OR belong = '')`, [i.user.id, champ.id]);
                if (!res.affectedRows) return i.reply({ content: 'Trop tard, quelqu\'un l\'a déjà lié !', flags: MessageFlags.Ephemeral });
                await cd.set(i.user.id, 'link', LINK_CD);
                col.stop('linked');
                await i.update({
                    embeds: [base().setColor('#a60b00').setFooter({ text: `Appartient à ${i.member?.displayName || i.user.username} ⛓️`, iconURL: avatar(i.user) })],
                    components: [row(true)],
                });
                const [{ n }] = await db.q('SELECT COUNT(*) AS n FROM champions WHERE belong = ?', [i.user.id]);
                await progress.track({ user: i.user, channel: ctx.channel, displayName: i.member?.displayName }, { link: 1 }, { champs: Number(n) });
            });
            col.on('end', (_, reason) => {
                if (reason !== 'linked') msg.edit({ components: [row(true)] }).catch(() => {});
            });
        },
    },
    {
        name: 'info',
        aliases: ['champ', 'champion'],
        category: 'champ',
        description: 'Fiche d\'un champion + ses skins',
        usage: '<champion>',
        example: 'info kaisa',
        options: [{ name: 'champion', type: 'text', required: true, description: 'Nom du champion' }],
        async run(ctx, { champion }) {
            const c = await findChampion(champion);
            if (!c) return ctx.fail(`Champion **${champion}** introuvable.`);
            const d = c.ddid ? await dd.detail(c.ddid) : null;
            const owner = c.belong ? await ctx.client.users.fetch(String(c.belong)).catch(() => null) : null;
            const color = owner ? '#a60b00' : '#c8a8ff';
            const footer = owner
                ? { text: `appartient à ${await nameOf(ctx.client, ctx.guild, owner.id)} ⛓️`, iconURL: avatar(owner) }
                : { text: 'libre · =rc pour tenter ta chance' };
            const lore = d?.lore || c.lore || '';
            const desc = `*${d?.title || c.title || ''}*\n${(d?.tags || []).join(' · ') || c.tags || ''}\n\n${lore.length > 500 ? `${lore.slice(0, 500)}…` : lore}`;

            const skins = d?.skins?.length ? d.skins : [{ num: 0, name: 'default' }];
            const pages = skins.map((s) => new EmbedBuilder()
                .setTitle(c.name)
                .setDescription(desc)
                .addFields({ name: '🎨 Skin', value: s.num === 0 ? 'Classique' : s.name })
                .setImage(c.ddid ? dd.loadingImg(c.ddid, s.num) : c.img)
                .setColor(color)
                .setFooter(footer));
            await paginate(ctx, pages, { send: 'send' });
        },
    },
    {
        name: 'mmr',
        aliases: ['cave', 'collection'],
        category: 'champ',
        description: 'Les champions lies a quelqu\'un',
        usage: '[@user]',
        options: [{ name: 'membre', type: 'user', description: 'Membre (toi par defaut)' }],
        async run(ctx, { membre }) {
            const user = membre || ctx.user;
            const list = await db.q('SELECT * FROM champions WHERE belong = ? ORDER BY name', [user.id]);
            const name = user.id === ctx.user.id ? ctx.displayName : await nameOf(ctx.client, ctx.guild, user.id);
            if (!list.length) return ctx.reply(`Aucun champion n'est lié à **${name}**.`);
            const first = list.reduce((m, c) => (c.id < m.id ? c : m));
            const pages = chunk(list, 15).map((part, k, all) => new EmbedBuilder()
                .setColor('#5cffa5')
                .setTitle(`⛓️ Cave de ${name}`)
                .setDescription(part.map((c) => `**${c.name}** · *${c.title || ''}*`).join('\n'))
                .setThumbnail(champImg(first))
                .setFooter({ text: `${list.length} champion(s)${all.length > 1 ? ` · page ${k + 1}/${all.length}` : ''}`, iconURL: avatar(user) }));
            await paginate(ctx, pages, { send: 'send' });
        },
    },
    {
        name: 'release',
        aliases: ['libere', 'unlink'],
        category: 'champ',
        description: 'Libere un de tes champions',
        usage: '<champion>',
        options: [{ name: 'champion', type: 'text', required: true, description: 'Nom du champion' }],
        async run(ctx, { champion }) {
            const c = await findChampion(champion);
            if (!c) return ctx.fail(`Champion **${champion}** introuvable.`);
            const res = await db.exec('UPDATE champions SET belong = NULL WHERE id = ? AND belong = ?', [c.id, ctx.user.id]);
            if (!res.affectedRows) return ctx.fail(`**${c.name}** ne t'appartient pas.`);
            await ctx.reply(`🕊️ **${c.name}** est libre. Il peut retomber sur n'importe qui avec \`${config.prefix}rc\`.`);
        },
    },
    {
        name: 'giftchamp',
        aliases: ['offrir'],
        category: 'champ',
        description: 'Offre un de tes champions a quelqu\'un',
        usage: '<@user> <champion>',
        options: [
            { name: 'membre', type: 'user', required: true, description: 'Qui le recoit' },
            { name: 'champion', type: 'text', required: true, description: 'Nom du champion' },
        ],
        async run(ctx, { membre, champion }) {
            if (membre.bot || membre.id === ctx.user.id) return ctx.fail('Choisis quelqu\'un d\'autre.');
            const c = await findChampion(champion);
            if (!c) return ctx.fail(`Champion **${champion}** introuvable.`);
            const res = await db.exec('UPDATE champions SET belong = ? WHERE id = ? AND belong = ?', [membre.id, c.id, ctx.user.id]);
            if (!res.affectedRows) return ctx.fail(`**${c.name}** ne t'appartient pas.`);
            await ctx.reply(`🎁 **${ctx.displayName}** offre **${c.name}** à ${membre} !`);
        },
    },
];
