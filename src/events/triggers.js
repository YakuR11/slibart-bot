// Tout ce qui reagit aux messages normaux (pas des commandes) :
// triggers, compteur de rolls Mudae, compteur d'insultes.
const config = require('../config');
const eco = require('../lib/economy');
const log = require('../lib/logger');
const { normalize, randInt } = require('../lib/utils');
const progress = require('../lib/progress');

const xpCd = new Map(); // XP de message : 1 fois par minute max (anti-spam)
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');
const inv = require('../lib/inventory');
const { fmt } = require('../lib/utils');

// ---------------------------------------------------------------------------
// DROPS : pendant que les gens parlent, un sac tombe au hasard. Premier qui clique gagne.
// ---------------------------------------------------------------------------
const DROP_CHANCE = 1 / 45; // par message
const DROP_GAP = 15 * 60 * 1000; // 15 min minimum entre deux drops dans un salon
const lastDrop = new Map();

async function maybeDrop(message) {
    const last = lastDrop.get(message.channel.id) || 0;
    if (Date.now() - last < DROP_GAP || Math.random() > DROP_CHANCE) return;
    lastDrop.set(message.channel.id, Date.now());
    const r = Math.random();
    const loot = r < 0.03 ? { type: 'coffre_legend' } : r < 0.15 ? { type: 'coffre_rare' } : r < 0.40 ? { type: 'coffre' } : { type: 'rb', n: randInt(2, 15) * 100 };
    const what = loot.type === 'rb' ? `**${fmt(loot.n)}** ${config.rbEmoji}` : inv.label(loot.type);
    const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle(loot.type === 'coffre_legend' ? '🚨 DROP LÉGENDAIRE 🚨' : '💰 Un sac est tombé !')
        .setDescription(`Contenu : ${what}\nLe premier qui clique le garde. ⏱️ 30s`);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('drop:grab').setLabel('Ramasser').setEmoji('🫳').setStyle(ButtonStyle.Success),
    );
    const msg = await message.channel.send({ embeds: [embed], components: [row] }).catch(() => null);
    if (!msg) return;
    let taken = false;
    const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000, max: 1 });
    col.on('collect', async (i) => {
        if (taken) return;
        taken = true;
        const pay = loot.type === 'rb' ? await eco.addRb(i.user.id, loot.n) : null;
        if (!pay) await inv.add(i.user.id, loot.type);
        const got = pay ? `**${fmt(pay.net)}** ${config.rbEmoji}${pay.cut ? ` (banque -${fmt(pay.cut)})` : ''}` : what;
        const t = ((Date.now() - msg.createdTimestamp) / 1000).toFixed(1);
        await i.update({
            embeds: [EmbedBuilder.from(embed).setColor('#2ecc71').setTitle('✅ Ramassé !').setDescription(`**${i.member?.displayName || i.user.username}** a ramassé ${got} en **${t}s** 🏃`)],
            components: [],
        }).catch(() => {});
    });
    col.on('end', () => {
        if (!taken) msg.edit({ embeds: [EmbedBuilder.from(embed).setColor('#95a5a6').setTitle('💨 Personne...').setDescription(`${what} a disparu. Fallait être là.`)], components: [] }).catch(() => {});
    });
}

const C = config.content;
const insults = new Set(C.insults.map(normalize));
const rolls = new Set(C.rollCommands.map((s) => s.toLowerCase()));
const triggerCd = new Map(); // anti-spam : 1 trigger / 15s / salon

function countInsults(text) {
    let n = 0;
    for (const word of normalize(text).split(/[^a-z0-9]+/)) {
        if (word && insults.has(word)) n++;
    }
    return n;
}

async function onMessage(message) {
    if (message.author.bot || !message.guild) return;
    const content = message.content.trim();
    const lower = content.toLowerCase();

    try {
        // triggers "mot exact"
        const trig = C.triggers.find((t) => t.match.toLowerCase() === lower);
        if (trig) {
            const last = triggerCd.get(message.channel.id) || 0;
            if (Date.now() - last > 15_000) {
                triggerCd.set(message.channel.id, Date.now());
                for (let i = 0; i < (trig.repeat || 1); i++) await message.channel.send(trig.reply);
            }
        }

        // compteur de rolls Mudae ($wa, $ha...)
        if (rolls.has(lower)) await eco.bump(message.author.id, { wacount: 1 });

        // compteur d'insultes (gere les accents : "enculé" = "encule")
        const n = countInsults(content);
        if (n > 0) await eco.bump(message.author.id, { insultcount: n });

        if (!content.startsWith(config.prefix)) await maybeDrop(message);

        // XP + quete "messages"
        const last = xpCd.get(message.author.id) || 0;
        const xp = Date.now() - last > 60_000 ? randInt(12, 20) : 0;
        if (xp) xpCd.set(message.author.id, Date.now());
        await progress.track(
            { user: message.author, channel: message.channel, displayName: message.member?.displayName },
            { msg: 1 }, {}, { xpOverride: xp },
        );
    } catch (e) {
        log.error('[triggers]', e.message);
    }
}

module.exports = { onMessage, countInsults };
