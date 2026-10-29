const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, version: djsVersion } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { avatar, duration, fmt } = require('../lib/utils');

// require tardif pour eviter la dependance circulaire handler <-> commandes
const handler = () => require('../lib/handler');

function overview(ctx) {
    const { commands, CATEGORIES } = handler();
    const byCat = {};
    for (const c of commands.values()) {
        if (c.hidden || (c.owner && !config.ownerIds.includes(ctx.user.id))) continue;
        (byCat[c.category] ??= []).push(c);
    }
    const embed = new EmbedBuilder()
        .setColor('#ffc2ed')
        .setTitle('📖 Commandes')
        .setDescription(`Préfixe : \`${config.prefix}\` · ou en slash \`/\`\n\`${config.prefix}help <commande>\` pour le détail.`)
        .setImage(require('../lib/media').ok(config.content.helpImage))
        .setFooter({ text: ctx.displayName, iconURL: avatar(ctx.user) })
        .setTimestamp();
    const cats = Object.keys(byCat).sort((a, b) => (CATEGORIES[a]?.order ?? 99) - (CATEGORIES[b]?.order ?? 99));
    for (const cat of cats) {
        const label = cat === 'eco' ? `${config.rbEmoji} Capitalism` : CATEGORIES[cat]?.label || cat;
        embed.addFields({ name: label, value: byCat[cat].map((c) => `\`${c.name}\``).join(' '), inline: true });
    }
    return { embed, cats, byCat };
}

function categoryEmbed(ctx, cat, list) {
    const { CATEGORIES, usage } = handler();
    const label = cat === 'eco' ? `${config.rbEmoji} Capitalism` : CATEGORIES[cat]?.label || cat;
    return new EmbedBuilder()
        .setColor('#ffc2ed')
        .setTitle(label)
        .setDescription(list.map((c) =>
            `**\`${usage(c)}\`**\n${c.description || ''}${c.aliases.length ? `\n-# alias : ${c.aliases.map((a) => config.prefix + a).join(' ')}` : ''}`).join('\n\n'))
        .setFooter({ text: ctx.displayName, iconURL: avatar(ctx.user) });
}

module.exports = [
    {
        name: 'help',
        aliases: ['h', 'aide', 'commands'],
        category: 'util',
        description: 'Liste des commandes',
        usage: '[commande]',
        options: [{ name: 'commande', type: 'string', description: 'Detail d\'une commande' }],
        async run(ctx, { commande }) {
            const { lookup, usage, CATEGORIES } = handler();
            if (commande) {
                const c = lookup.get(commande.toLowerCase().replace(config.prefix, ''));
                if (!c) return ctx.fail(`Commande \`${commande}\` inconnue.`);
                const embed = new EmbedBuilder()
                    .setColor('#ffc2ed')
                    .setTitle(`${config.prefix}${c.name}`)
                    .setDescription(c.description || '')
                    .addFields({ name: 'Utilisation', value: `\`${usage(c)}\`` });
                if (c.example) embed.addFields({ name: 'Exemple', value: `\`${config.prefix}${c.example}\`` });
                if (c.aliases.length) embed.addFields({ name: 'Alias', value: c.aliases.map((a) => `\`${config.prefix}${a}\``).join(' ') });
                return ctx.reply({ embeds: [embed] });
            }

            const { embed, cats, byCat } = overview(ctx);
            const menu = () => new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('help:cat')
                    .setPlaceholder('Détail d\'une catégorie...')
                    .addOptions(
                        { label: 'Vue d\'ensemble', value: '__all', emoji: '📖' },
                        ...cats.map((cat) => {
                            const raw = CATEGORIES[cat]?.label || cat;
                            const [emoji, ...rest] = raw.split(' ');
                            return { label: cat === 'eco' ? 'Capitalism' : rest.join(' ') || raw, value: cat, emoji: cat === 'eco' ? '💰' : emoji };
                        }),
                    ),
            );
            const msg = await ctx.send({ embeds: [embed], components: [menu()] });
            if (!msg) return;
            const col = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 180_000, idle: 90_000 });
            col.on('collect', async (i) => {
                const v = i.values[0];
                const e = v === '__all' ? overview(ctx).embed : categoryEmbed(ctx, v, byCat[v]);
                await i.update({ embeds: [e], components: [menu()] }).catch(() => {});
            });
            col.on('end', () => msg.edit({ components: [] }).catch(() => {}));
        },
    },
    {
        name: 'ping',
        category: 'util',
        description: 'Latence du bot',
        async run(ctx) {
            const t = Date.now();
            await db.q('SELECT 1');
            const dbMs = Date.now() - t;
            await ctx.reply(`🏓 Pong ! WebSocket **${Math.round(ctx.client.ws.ping)}ms** · base de données **${dbMs}ms**`);
        },
    },
    {
        name: 'botinfo',
        aliases: ['stats', 'bi'],
        category: 'util',
        description: 'Infos sur le bot',
        async run(ctx) {
            const [{ users }] = await db.q('SELECT COUNT(*) AS users FROM profile WHERE id_user != ?', [config.casinoId]);
            const [{ total }] = await db.q('SELECT COALESCE(SUM(rb), 0) AS total FROM profile');
            const [{ linked }] = await db.q(`SELECT COUNT(*) AS linked FROM champions WHERE belong IS NOT NULL AND belong != ''`);
            const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
            const embed = new EmbedBuilder()
                .setColor('#eeebff')
                .setAuthor({ name: ctx.client.user.username, iconURL: avatar(ctx.client.user) })
                .addFields(
                    { name: '⏱️ Uptime', value: duration(process.uptime() * 1000), inline: true },
                    { name: '📡 Ping', value: `${Math.round(ctx.client.ws.ping)}ms`, inline: true },
                    { name: '💾 RAM', value: `${mem} Mo`, inline: true },
                    { name: '👥 Profils', value: String(users), inline: true },
                    { name: `${config.rbEmoji} En circulation`, value: fmt(total), inline: true },
                    { name: '⛓️ Champions liés', value: String(linked), inline: true },
                )
                .setFooter({ text: `Node ${process.version} · discord.js ${djsVersion}` });
            await ctx.reply({ embeds: [embed] });
        },
    },
];
