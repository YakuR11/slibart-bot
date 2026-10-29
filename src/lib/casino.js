// Briques communes a tous les jeux du casino : mise, reglement, bouton "Rejouer".
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const db = require('../db');
const eco = require('./economy');
const cd = require('./cooldowns');
const progress = require('./progress');
const { Ctx } = require('./context');
const { fmt, duration } = require('./utils');
const config = require('../config');
const paris = require('./paris');
const announce = require('./announce');
const { EmbedBuilder } = require('discord.js');
const { avatar } = require('./utils');

const RB = () => config.rbEmoji;
const handler = () => require('./handler');

/** edite la reponse d'une commande (slash/bouton : via l'interaction ; prefixe : via le message) */
const editReply = (ctx, msg, payload) => (ctx.isSlash ? ctx.interaction.editReply(payload) : msg.edit(payload));

/**
 * Verifie le cooldown, parse la mise et la debite. Retourne { bet, allin } ou null (deja repondu).
 */
async function placeBet(ctx, raw, cooldownName, cooldownMs) {
    if (cooldownName) {
        const left = await cd.take(ctx.user.id, cooldownName, cooldownMs);
        if (left) {
            await ctx.fail(`Doucement, encore **${duration(left)}**.`);
            return null;
        }
    }
    const bal = await eco.balance(ctx.user.id);
    const bet = eco.parseAmount(raw, bal);
    if (!bet) {
        await ctx.fail(bal ? 'Mise invalide (nombre, `all`, `half`, `1k`...).' : `Tu n'as plus un ${RB()}... \`${config.prefix}rsa\`, \`${config.prefix}work\` ou \`${config.prefix}daily\` !`);
        return null;
    }
    if (!(await eco.takeRb(ctx.user.id, bet))) {
        await ctx.fail(`Tu n'as que **${fmt(bal)}** ${RB()}.`);
        return null;
    }
    return { bet, allin: bet >= bal };
}

/** Rembourse une mise (partie annulee) */
const refund = (ctx, bet) => eco.addRb(ctx.user.id, bet);

/**
 * Regle une partie. payout = ce que le joueur recupere (mise comprise, 0 si perdu).
 * Retourne { net, bal }
 */
async function settle(ctx, bet, payout) {
    const userId = ctx.user.id;
    let received = 0;
    let cut = 0;
    let debt = 0;
    await db.tx(async (conn) => {
        if (payout > 0) {
            const pay = await eco.addRb(userId, payout, conn);
            received = pay.net;
            cut = pay.cut;
            debt = pay.debt;
        }
        const pocket = received - bet;
        if (pocket > 0) {
            await eco.bump(userId, { gamblecount: 1, wincount: pocket }, conn);
            await conn.query('UPDATE profile SET maxwin = GREATEST(maxwin, ?) WHERE id_user = ?', [pocket, userId]);
        } else if (payout <= 0) {
            await eco.bump(userId, { gamblecount: 1, pertecount: bet }, conn);
            await eco.toCasino(bet, conn);
        } else {
            await eco.bump(userId, { gamblecount: 1, pertecount: Math.max(0, -pocket) }, conn);
        }
    });
    const net = received - bet;
    if (net !== 0) await progress.streak(userId, net > 0);
    // saison de la semaine
    await db.exec(
        'INSERT INTO weekly (week, id_user, net, games) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE net = net + VALUES(net), games = games + 1',
        [paris.weekKey(), userId, net],
    );
    return { net, bal: await eco.balance(userId), cut, debt };
}

/** XP, quetes et succes apres une partie (a appeler APRES avoir affiche le resultat) */
const BIG_WIN = 3000;
async function after(ctx, { bet, net, allin, game, ...meta }) {
    // gros gain -> annonce dans le salon du casino : tout le monde voit, tout le monde veut jouer
    if (net >= BIG_WIN || meta.jackpot) {
        const embed = new EmbedBuilder()
            .setColor('#f1c40f')
            .setAuthor({ name: ctx.displayName, iconURL: avatar(ctx.user) })
            .setDescription(`🚨 **${ctx.displayName}** vient de gagner **${fmt(net)}** ${RB()}${game ? ` au **${game}**` : ''} (mise ${fmt(bet)}) !\n-# <#${ctx.channel.id}> · tente ta chance`);
        await announce.send({ embeds: [embed] }, ctx.channel.id);
    }
    return progress.track(ctx, { play: 1, win: net > 0 ? 1 : 0, wager: bet }, { bet, net, allin, ...meta });
}

// ---------------------------------------------------------------------------
// Bouton "Rejouer" : 1 clic pour relancer avec la meme mise (ou x2, ½, all-in)
// ---------------------------------------------------------------------------
function replayRow(bet, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rp:same').setLabel(`Rejouer · ${fmt(bet)}`).setEmoji('🔁').setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId('rp:half').setLabel('½').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('rp:double').setLabel('x2').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('rp:all').setLabel('All-in').setEmoji('💰').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    );
}

/**
 * Ecoute les boutons Rejouer du message.
 * @param makeArgs (montant) => args de la commande a relancer
 */
function listenReplay(ctx, msg, bet, makeArgs) {
    if (!msg?.createMessageComponentCollector) return;
    const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 60_000, filter: (i) => i.customId.startsWith('rp:') });
    col.on('collect', async (i) => {
        if (i.user.id !== ctx.user.id) {
            return i.reply({ content: `Lance ta propre partie avec \`${config.prefix}${ctx.command.name}\` 😉`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        col.stop('replayed');
        const kind = i.customId.split(':')[1];
        const amount = { same: String(bet), half: String(Math.max(1, Math.floor(bet / 2))), double: String(bet * 2), all: 'all' }[kind];
        await msg.edit({ components: [] }).catch(() => {});
        const next = new Ctx(ctx.client, { interaction: i, command: ctx.command, alias: ctx.alias });
        next.args = makeArgs(amount);
        await handler().run(next);
    });
    col.on('end', (_, reason) => {
        if (reason !== 'replayed') msg.edit({ components: [] }).catch(() => {});
    });
}

module.exports = { placeBet, refund, settle, after, replayRow, listenReplay, editReply };
