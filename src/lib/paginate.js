const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

/**
 * Envoie une liste d'embeds avec des boutons ◀ ▶.
 * Si une seule page : pas de boutons.
 */
async function paginate(ctx, pages, { time = 120_000, send = 'reply' } = {}) {
    if (!pages.length) return null;
    const out = (p) => (send === 'send' ? ctx.send(p) : ctx.reply(p));
    if (pages.length === 1) return out({ embeds: [pages[0]] });

    let i = 0;
    const row = () => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pg:first').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(i === 0),
        new ButtonBuilder().setCustomId('pg:prev').setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(i === 0),
        new ButtonBuilder().setCustomId('pg:count').setLabel(`${i + 1}/${pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('pg:next').setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(i === pages.length - 1),
        new ButtonBuilder().setCustomId('pg:last').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(i === pages.length - 1),
    );
    const msg = await out({ embeds: [pages[i]], components: [row()] });
    if (!msg) return null;
    const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time, idle: 60_000 });
    col.on('collect', async (btn) => {
        const a = btn.customId.split(':')[1];
        if (a === 'first') i = 0;
        else if (a === 'prev') i = Math.max(0, i - 1);
        else if (a === 'next') i = Math.min(pages.length - 1, i + 1);
        else if (a === 'last') i = pages.length - 1;
        await btn.update({ embeds: [pages[i]], components: [row()] }).catch(() => {});
    });
    col.on('end', () => msg.edit({ components: [] }).catch(() => {}));
    return msg;
}

/** Decoupe un tableau en morceaux de n */
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, k) => arr.slice(k * n, k * n + n));

module.exports = { paginate, chunk };
