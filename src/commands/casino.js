// Les jeux d'argent se jouent maintenant dans l'app (Activity Discord : vocal -> Activites).
// Les anciennes commandes repondent juste ou les trouver.
const config = require('../config');
const cd = require('../lib/cooldowns');
const eco = require('../lib/economy');
const ui = require('../lib/ui');
const { fmt } = require('../lib/utils');

const RB = () => config.rbEmoji;

const MOVED = {
    gamble: ['g', 'roulette'],
    slots: ['slot', 'sl'],
    blackjack: ['bj'],
    mines: ['mn', 'bombes'],
    crash: ['cr', 'rocket'],
    loto: ['lottery', 'loterie'],
    duel: [],
};

const moved = Object.entries(MOVED).map(([name, aliases]) => ({
    name,
    aliases,
    category: 'jeux',
    hidden: true,
    slash: false,
    description: 'Se joue dans l\'app',
    async run(ctx) {
        await ctx.reply(`🎰 **${name}** se joue maintenant dans l'app du bot : rejoins un vocal → 🚀 **Activités** → **${ctx.client.user.username}** (ou tape \`/plinko\`).`);
    },
}));

module.exports = [
    ...moved,
    {
        name: 'rsa',
        aliases: ['caf', 'chomage'],
        category: 'eco',
        description: 'Aide sociale si tu es a la rue (toutes les 4h)',
        async run(ctx) {
            const bal = await eco.balance(ctx.user.id);
            if (bal >= 100) return ctx.fail(`T'as **${fmt(bal)}** ${RB()}, t'es pas à la rue. Va \`${config.prefix}work\`.`);
            const left = await cd.take(ctx.user.id, 'rsa', 4 * 3600 * 1000);
            if (left) return ctx.fail(`La CAF revient ${ui.ts(Date.now() + left)}.`);
            const gain = 300 + Math.floor(Math.random() * 201);
            const pay = await eco.addRb(ctx.user.id, gain);
            const credit = require('../lib/credit');
            await ctx.reply(`🏛️ La CAF a versé **${fmt(pay.net)}** ${RB()} à **${ctx.displayName}**.${credit.note(pay.cut, pay.debt)} Ne gâche pas tout au casino. (Tu vas tout gâcher au casino.)`);
        },
    },
];
