const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const log = require('../lib/logger');

module.exports = [
    {
        name: 'plinko',
        aliases: ['pk'],
        category: 'jeux',
        description: 'Ouvre le Plinko avec la vraie interface (Activity Discord)',
        async run(ctx) {
            // en slash : Discord ouvre directement l'Activity
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
            const embed = new EmbedBuilder()
                .setColor('#d9a441')
                .setTitle('🎯 Plinko')
                .setDescription(
                    'Le Plinko se joue dans sa propre fenêtre, avec tout le vocal en même temps.\n\n' +
                    `• Tape **/plinko**, ou\n• rejoins un vocal, clique sur la **fusée 🚀** (Activités) et choisis **${ctx.client.user.username}**.\n\n` +
                    '-# Mise, risque (doux, normal, sale), 8 à 16 rangées, rafales de billes. Jusqu\'à x1000.',
                );
            if (!config.activity.clientSecret) embed.setFooter({ text: 'Pas encore activé : DISCORD_CLIENT_SECRET manquant dans le .env' });
            await ctx.reply({ embeds: [embed] });
        },
    },
];
