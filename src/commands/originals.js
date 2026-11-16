// Dice et Limbo dans le chat : les memes maths que dans l'app (src/activity/origmath.js),
// avec les boutons Rejouer. Keno, Tour du Slip et HiLo se jouent dans l'app.
const config = require('../config');
const { fmt, sleep } = require('../lib/utils');
const casino = require('../lib/casino');
const ui = require('../lib/ui');
const m = require('../activity/origmath');

const bank = (cut, debt) => (cut ? `\n🏦 La banque prend **${fmt(cut)}** · dette **${fmt(debt)}**` : '');
/** jauge de 0 a 100 avec le seuil et le tirage : ▰▰▰▰▱▱▱▱ */
function gauge(roll, line, over) {
    const cells = 14;
    const at = (v) => Math.min(cells - 1, Math.floor((v / 100) * cells));
    return Array.from({ length: cells }, (_, i) => {
        if (i === at(roll)) return '🎲';
        const winZone = over ? i >= at(line) : i < at(line);
        return winZone ? '🟩' : '🟥';
    }).join('');
}

module.exports = [
    {
        name: 'dice',
        aliases: ['de', 'dé'],
        category: 'jeux',
        description: 'Dice : tu choisis ta chance de gagner (1 a 95 %), le gain suit',
        usage: '<montant|all|half> [chance %]',
        example: 'dice 500 25',
        options: [
            { name: 'montant', type: 'string', required: true, description: 'Nombre, all, half, 1k...' },
            { name: 'chance', type: 'string', description: 'Chance de gagner en % (49.5 par defaut : x1.98)' },
        ],
        async run(ctx, { montant, chance }) {
            const raw = chance === undefined || chance === null || chance === '' ? 49.5 : parseFloat(String(chance).replace(',', '.').replace('%', ''));
            if (!(raw >= m.DICE_MIN && raw <= m.DICE_MAX)) return ctx.fail(`Chance entre ${m.DICE_MIN} et ${m.DICE_MAX} % (ex. \`${config.prefix}dice 500 25\` : 25 % de chance, x${m.diceMult(25)}).`);
            const c = m.diceChance(raw);
            const placed = await casino.placeBet(ctx, montant, 'dice', 1_000);
            if (!placed) return;
            const { bet, allin } = placed;
            const r = m.dice(Math.random, c, true);
            const payout = r.won ? Math.floor(bet * r.mult) : 0;
            const { net, bal, cut, debt } = await casino.settle(ctx, bet, payout);

            const title = `Dice · ${fmt(bet)} · ${c} % de chance · x${r.mult}`;
            const msg = await ctx.reply({ embeds: [ui.gameEmbed(ctx, title).setDescription(`## 🎲 …\nIl faut faire **${r.line.toFixed(2)}** ou plus.`)] });
            await sleep(900);
            const st = ui.resultStyle(net, bet);
            const final = ui.gameEmbed(ctx, title, st.color)
                .setDescription(`## 🎲 ${r.roll.toFixed(2)}\n${gauge(r.roll, r.line, true)}\n${st.tag} — il fallait **${r.line.toFixed(2)}** ou plus\n${ui.signed(net)}${bank(cut, debt)}`)
                .setFooter({ text: `Solde : ${fmt(bal)}` });
            await casino.editReply(ctx, msg, { embeds: [final], components: [casino.replayRow(bet)] }).catch(() => {});
            casino.listenReplay(ctx, msg, bet, (amount) => ({ montant: amount, chance: String(c) }));
            await casino.after(ctx, { bet, net, allin, game: 'dice' });
        },
    },
    {
        name: 'limbo',
        aliases: ['lb'],
        category: 'jeux',
        description: 'Limbo : vise un multiplicateur (x1.01 a x1000), le tirage doit monter jusque-la',
        usage: '<montant|all|half> [cible]',
        example: 'limbo 500 10',
        options: [
            { name: 'montant', type: 'string', required: true, description: 'Nombre, all, half, 1k...' },
            { name: 'cible', type: 'string', description: 'Multiplicateur vise (2 par defaut)' },
        ],
        async run(ctx, { montant, cible }) {
            const raw = cible === undefined || cible === null || cible === '' ? 2 : parseFloat(String(cible).replace(',', '.').replace(/^x/i, ''));
            if (!(raw >= m.LIMBO_MIN && raw <= m.MAX_MULT)) return ctx.fail(`Cible entre x${m.LIMBO_MIN} et x${m.MAX_MULT} (ex. \`${config.prefix}limbo 500 10\`).`);
            const t = m.limboTarget(raw);
            const placed = await casino.placeBet(ctx, montant, 'limbo', 1_000);
            if (!placed) return;
            const { bet, allin } = placed;
            const r = m.limbo(Math.random, t);
            const payout = r.won ? Math.floor(bet * t) : 0;
            const { net, bal, cut, debt } = await casino.settle(ctx, bet, payout);

            const title = `Limbo · ${fmt(bet)} · cible x${t} · ${(m.RTP * 100 / t).toFixed(2)} % de chance`;
            const msg = await ctx.reply({ embeds: [ui.gameEmbed(ctx, title).setDescription('## 🚀 ×1.00 …\nLe slip décolle...')] });
            await sleep(900);
            const st = ui.resultStyle(net, bet);
            const final = ui.gameEmbed(ctx, title, st.color)
                .setDescription(`## 🚀 ×${r.result.toFixed(2)}\n${st.tag} — ${r.won ? `cible **x${t}** atteinte` : `il fallait monter à **x${t}**`}\n${ui.signed(net)}${bank(cut, debt)}`)
                .setFooter({ text: `Solde : ${fmt(bal)}` });
            await casino.editReply(ctx, msg, { embeds: [final], components: [casino.replayRow(bet)] }).catch(() => {});
            casino.listenReplay(ctx, msg, bet, (amount) => ({ montant: amount, cible: String(t) }));
            await casino.after(ctx, { bet, net, allin, game: 'limbo' });
        },
    },
];
