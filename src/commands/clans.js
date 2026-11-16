// Guerre de clans : un clan = un serveur. Classement de la semaine au gain net du casino.
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const clans = require('../lib/clans');
const paris = require('../lib/paris');
const inv = require('../lib/inventory');
const ui = require('../lib/ui');
const { fmt, nameOf } = require('../lib/utils');

const RB = () => config.rbEmoji;
const signed = (n) => `${n >= 0 ? '+' : '-'}${fmt(Math.abs(n))}`;

module.exports = [
    {
        name: 'clan',
        aliases: ['clans', 'guerre', 'gc'],
        category: 'top',
        description: 'Guerre de clans : quel serveur a gagne le plus au casino cette semaine',
        usage: '[rejoindre]',
        options: [{ name: 'action', type: 'string', description: 'rejoindre : passer dans le clan de ce serveur (1 fois par semaine)', choices: ['rejoindre'] }],
        async run(ctx, { action }) {
            if (action && /^(rejoindre|join)$/i.test(action)) {
                const r = await clans.join(ctx.user.id, ctx.guild);
                if (r.error) return ctx.fail(r.error);
                return ctx.reply(`⚔️ **${ctx.displayName}** rejoint le clan **${ctx.guild.name}**${r.from ? ` (il quitte **${r.from.name}**)` : ''}. Ses gains de la semaine comptent maintenant pour ce serveur.`);
            }
            await clans.seen(ctx.guild, ctx.user.id);
            const week = paris.weekKey();
            const [table, mine] = await Promise.all([clans.standings(week), clans.clanOf(ctx.user.id)]);
            const lines = table.map((c, i) => {
                const avg = c.players ? Math.round(c.net / c.players) : 0;
                const me = mine?.id === c.id ? ' ⬅️ ton clan' : '';
                return `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} **${c.name}** — **${signed(c.net)}** ${RB()}${me}\n-# ${c.players} joueur${c.players > 1 ? 's' : ''} cette semaine · ${fmt(c.games)} parties · ${signed(avg)} par joueur · ${c.members} membre${c.members > 1 ? 's' : ''}`;
            });
            const here = table.find((c) => c.id === ctx.guild.id);
            const top = here ? await clans.roster(here.id, week, 3) : [];
            const best = (await Promise.all(top.map(async (r) => `${await nameOf(ctx.client, ctx.guild, r.id_user)} (${signed(r.net)})`))).join(' · ');
            const solo = table.length < 2;
            const embed = new EmbedBuilder()
                .setColor(ui.COLORS.bigwin)
                .setTitle('⚔️ Guerre de clans · casino de la semaine')
                .setDescription(
                    `Fin ${ui.ts(paris.weekEnd())}. Le serveur avec le plus gros gain net gagne : **${fmt(clans.WAR_RB)}** ${RB()} + ${inv.label(clans.WAR_CRATE)} pour chaque membre qui a joué.\n\n` +
                    `${lines.join('\n') || '*Aucun serveur enregistré.*'}` +
                    (best ? `\n\n**Les meilleurs de ${here.name}** : ${best}` : '') +
                    (solo ? `\n\n-# Un seul serveur pour l'instant : la guerre démarre dès que le bot est invité sur un deuxième.` : ''),
                )
                .setFooter({ text: `Ton clan : ${mine?.name || ctx.guild.name} · ${config.prefix}clan rejoindre pour passer sur ce serveur` });
            await ctx.reply({ embeds: [embed] });
        },
    },
];
