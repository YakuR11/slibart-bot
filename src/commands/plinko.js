// Sur PC, /plinko ouvre l'activité dans le vocal.
// Sur téléphone l'activité ne s'ouvre pas : =pk 100 joue une bille dans le chat.
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const eco = require('../lib/economy');
const casino = require('../lib/casino');
const ui = require('../lib/ui');
const log = require('../lib/logger');
const { fmt } = require('../lib/utils');
const plinko = require('../activity/plinko');

const RB = () => config.rbEmoji;
const RISK = {
    doux: 'low', low: 'low', safe: 'low',
    normal: 'medium', medium: 'medium', n: 'medium',
    sale: 'high', high: 'high', chaud: 'high',
};
const RISK_LABEL = { low: 'doux', medium: 'normal', high: 'sale' };

module.exports = [
    {
        name: 'plinko',
        aliases: ['pk'],
        category: 'jeux',
        description: 'Une bille de Plinko dans le chat (ou l\'activité sur PC)',
        usage: '[montant] [doux|normal|sale]',
        example: 'pk 100 sale',
        options: [
            { name: 'montant', type: 'string', description: 'Mise. Sans mise : ouvre l\'activité sur PC' },
            { name: 'risque', type: 'string', description: 'doux, normal ou sale' },
        ],
        async run(ctx, { montant, risque }) {
            if (montant === undefined) return openOrExplain(ctx);
            const risk = risque ? RISK[String(risque).toLowerCase()] : 'medium';
            if (!risk) return ctx.fail('Risque : `doux`, `normal` ou `sale`.');
            const bal = await eco.balance(ctx.user.id);
            const bet = eco.parseAmount(montant, bal);
            if (!bet) return ctx.fail(bal ? 'Mise invalide (`100`, `1k`, `half`, `all`).' : `Tu n'as plus un ${RB()}.`);
            const r = await plinko.drop(
                { id: ctx.user.id, name: ctx.displayName, user: ctx.user, where: 'chat' },
                { bet, risk, rows: 12 },
            );
            if (r.error) return ctx.fail(r.error);
            const st = ui.resultStyle(r.net, r.bet);
            const msg = await ctx.reply({
                embeds: [ui.gameEmbed(ctx, `Plinko · ${fmt(r.bet)} · ${RISK_LABEL[risk]}`, st.color)
                    .setDescription(
                        `## ×${r.mult}\nLa bille est tombée.\n${ui.signed(r.net)}` +
                        `${r.cut ? `\n🏦 La banque prend **${fmt(r.cut)}**` : ''}`,
                    )
                    .setFooter({ text: `Solde : ${fmt(r.balance)} · 12 rangées` })],
                components: [casino.replayRow(r.bet)],
            });
            casino.listenReplay(ctx, msg, r.bet, (m) => ({ montant: m, risque: RISK_LABEL[risk] }));
        },
    },
];

async function openOrExplain(ctx) {
    if (ctx.isSlash && typeof ctx.interaction.launchActivity === 'function') {
        try {
            ctx._answered = true;
            await ctx.interaction.launchActivity();
            return;
        } catch (e) {
            log.warn('[plinko] lancement impossible :', e.message);
            ctx._answered = false;
        }
    }
    const p = config.prefix;
    const embed = new EmbedBuilder()
        .setColor('#d9a441')
        .setTitle('🎯 Plinko')
        .setDescription(
            `**Sur téléphone**, une bille dans le chat : \`${p}pk 100\`, \`${p}pk 100 doux\`, \`${p}pk 500 sale\`.\n\n` +
            `**Sur PC**, la fenêtre avec tout le vocal : tape **/plinko**, ou rejoins un vocal → 🚀 **Activités** → **${ctx.client.user.username}**.`,
        );
    if (!config.activity.clientSecret) embed.setFooter({ text: 'Activité pas encore activée : DISCORD_CLIENT_SECRET manquant. Le chat marche quand même.' });
    await ctx.reply({ embeds: [embed] });
}
