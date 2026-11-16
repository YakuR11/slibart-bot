// Pluie de slips : pendant un evenement, de temps en temps et sans prevenir, le bot lache 5 lots
// dans le salon du casino de chaque serveur. Les 5 premiers a cliquer se servent, du plus gros
// au plus petit. Pas de @here : il faut etre la.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const db = require('../db');
const eco = require('./economy');
const inv = require('./inventory');
const announce = require('./announce');
const boost = require('./boost');
const paris = require('./paris');
const log = require('./logger');
const { fmt, randInt } = require('./utils');

const OPEN_MS = 45_000;
const GAP_MIN = [75, 165]; // minutes entre deux pluies
const FIRST_MIN = [20, 60]; // premiere pluie apres le debut de l'evenement
const HOURS = [11, 1]; // de 11h a 1h du matin, heure de Paris

/** 5 lots, du premier arrive au cinquieme */
function prizes() {
    const top = Math.random() < 0.12 ? 'coffre_legend' : 'coffre_rare';
    return [
        { rb: randInt(20, 30) * 100, crate: top },
        { rb: randInt(12, 18) * 100, crate: 'coffre' },
        { rb: randInt(8, 12) * 100 },
        { rb: randInt(5, 8) * 100 },
        { rb: randInt(3, 5) * 100 },
    ];
}
const show = (p) => `**${fmt(p.rb)}** ${config.rbEmoji}${p.crate ? ` + ${inv.label(p.crate)}` : ''}`;

/** lache une pluie dans un salon. Retourne le message. */
async function pour(channel) {
    const lots = prizes();
    const winners = []; // { id, name, text }
    const board = () => lots.map((p, i) => `${['🥇', '🥈', '🥉', '4.', '5.'][i]} ${winners[i] ? `**${winners[i].name}** → ${winners[i].text}` : show(p)}`).join('\n');
    const embed = () => new EmbedBuilder()
        .setColor('#2ee62b')
        .setTitle('🩲☔ PLUIE DE SLIPS ☔🩲')
        .setDescription(`${lots.length} lots tombent du ciel, **un par personne**, le plus gros au plus rapide.\n\n${board()}`)
        .setFooter({ text: 'Ça ferme dans 45 secondes' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('rain:grab').setLabel('Attraper').setEmoji('🫳').setStyle(ButtonStyle.Success));
    const msg = await channel.send({ embeds: [embed()], components: [row] }).catch(() => null);
    if (!msg) return null;
    const got = new Set();
    const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: OPEN_MS });
    col.on('collect', async (i) => {
        try {
            if (got.has(i.user.id)) return await i.reply({ content: 'Un seul lot par personne 😉', flags: MessageFlags.Ephemeral });
            if (got.size >= lots.length) return await i.reply({ content: 'Trop tard, tout est parti.', flags: MessageFlags.Ephemeral });
            got.add(i.user.id);
            const p = lots[winners.length];
            const slot = { id: i.user.id, name: i.member?.displayName || i.user.username, text: '…' };
            winners.push(slot);
            const pay = await eco.addRb(i.user.id, p.rb);
            if (p.crate) await inv.add(i.user.id, p.crate);
            slot.text = `**${fmt(pay.net)}** ${config.rbEmoji}${p.crate ? ` + ${inv.label(p.crate)}` : ''}`;
            await i.update({ embeds: [embed()], components: winners.length >= lots.length ? [] : [row] });
            if (winners.length >= lots.length) col.stop('empty');
        } catch (e) {
            log.warn('[pluie]', e.message);
        }
    });
    col.on('end', () => {
        const left = lots.length - winners.length;
        const done = EmbedBuilder.from(embed())
            .setColor(winners.length ? '#2ecc71' : '#95a5a6')
            .setTitle(winners.length ? '🩲 Pluie terminée' : '💨 Personne sous la pluie...')
            .setFooter({ text: left ? `${left} lot${left > 1 ? 's' : ''} perdu${left > 1 ? 's' : ''}. La prochaine tombe sans prévenir.` : 'Tout est parti. La prochaine tombe sans prévenir.' });
        msg.edit({ embeds: [done], components: [] }).catch(() => {});
    });
    return msg;
}

/** une pluie dans le salon du casino de chaque serveur */
async function pourEverywhere() {
    const list = await announce.channels();
    const out = [];
    for (const ch of list) {
        const m = await pour(ch);
        if (m) out.push(m);
    }
    return out;
}

const minutes = ([a, b]) => randInt(a, b) * 60_000;
function awake() {
    const { h } = paris.now();
    return HOURS[0] <= HOURS[1] ? h >= HOURS[0] && h < HOURS[1] : h >= HOURS[0] || h < HOURS[1];
}

/** appele par le scheduler : pendant un evenement, programme et lache les pluies */
async function tick() {
    const ev = await boost.event();
    if (!ev) return;
    const key = String(ev.start);
    const now = Date.now();
    let next = Number(await db.getSetting('rain_next', '0'));
    if ((await db.getSetting('rain_event')) !== key) {
        next = now + minutes(FIRST_MIN);
        await db.setSetting('rain_event', key);
        await db.setSetting('rain_next', String(next));
    }
    if (now < next) return;
    await db.setSetting('rain_next', String(now + minutes(GAP_MIN)));
    if (!awake() || ev.end - now < OPEN_MS) return; // la nuit on saute, la suivante est deja programmee
    const sent = await pourEverywhere();
    log.info(`[pluie] ${sent.length} salon(s)`);
}

module.exports = { pour, pourEverywhere, tick, prizes };
