// Commandes reservees aux IDs listes dans OWNER_IDS (.env)
const config = require('../config');
const db = require('../db');
const eco = require('../lib/economy');
const cd = require('../lib/cooldowns');
const dd = require('../lib/ddragon');
const media = require('../lib/media');
const { fmt, duration } = require('../lib/utils');
const boost = require('../lib/boost');
const announce = require('../lib/announce');
const { EmbedBuilder } = require('discord.js');

const RB = () => config.rbEmoji;

module.exports = [
    {
        name: 'addrb',
        owner: true,
        category: 'admin',
        description: '[admin] Ajoute (ou retire si negatif) des RB',
        usage: '<@user> <montant>',
        options: [
            { name: 'membre', type: 'user', required: true, description: 'Cible' },
            { name: 'montant', type: 'integer', required: true, description: 'Montant (negatif pour retirer)' },
        ],
        async run(ctx, { membre, montant }) {
            await eco.addRb(membre.id, montant, undefined, { raw: true });
            const bal = await eco.balance(membre.id);
            await ctx.reply(`✅ ${montant >= 0 ? '+' : ''}${fmt(montant)} ${RB()} pour **${membre.username}** → ${fmt(bal)}`);
        },
    },
    {
        name: 'setrb',
        owner: true,
        category: 'admin',
        description: '[admin] Fixe le solde de quelqu\'un',
        usage: '<@user> <montant>',
        options: [
            { name: 'membre', type: 'user', required: true, description: 'Cible' },
            { name: 'montant', type: 'integer', required: true, description: 'Nouveau solde', min: 0 },
        ],
        async run(ctx, { membre, montant }) {
            await db.ensureProfile(membre.id);
            await db.exec('UPDATE profile SET rb = ? WHERE id_user = ?', [Math.max(0, montant), membre.id]);
            await ctx.reply(`✅ Solde de **${membre.username}** fixé à ${fmt(montant)} ${RB()}`);
        },
    },
    {
        name: 'resetcd',
        owner: true,
        category: 'admin',
        description: '[admin] Remet a zero les cooldowns de quelqu\'un',
        usage: '<@user> [nom]',
        options: [
            { name: 'membre', type: 'user', required: true, description: 'Cible' },
            { name: 'nom', type: 'string', description: 'work, gw, mine, rc, link, cave, gamble, slots (tous si vide)' },
        ],
        async run(ctx, { membre, nom }) {
            await cd.clear(membre.id, nom || null);
            if (!nom || nom === 'daily') {
                // on recule le dernier daily de 20h : reprenable tout de suite sans casser le streak
                await db.exec('UPDATE profile SET daily_last = ? WHERE id_user = ? AND daily_last > 0', [Date.now() - 20 * 3600 * 1000 - 1000, membre.id]);
            }
            await ctx.reply(`✅ Cooldown${nom ? ` \`${nom}\`` : 's'} de **${membre.username}** remis à zéro.`);
        },
    },
    {
        name: 'images',
        owner: true,
        category: 'admin',
        description: '[admin] Reverifie les images de content.json et liste les liens morts',
        async run(ctx) {
            const r = await media.checkAll();
            if (!r.dead.length) return ctx.reply(`✅ Les ${r.checked} images marchent.`);
            const list = r.dead.map((u) => `• <${u}>`).join('\n');
            await ctx.whisper(`🖼️ **${r.dead.length}/${r.checked} liens morts** (ignorés automatiquement). A remplacer dans \`config/content.json\` :\n${list}`.slice(0, 1990));
        },
    },
    {
        name: 'setsalon',
        owner: true,
        category: 'admin',
        description: '[admin] Salon ou le bot fait ses annonces sur ce serveur (gros gains, evenements, pluies, loterie)',
        async run(ctx) {
            await require('../lib/clans').touchGuild(ctx.guild);
            await db.exec('UPDATE guilds SET casino_channel = ? WHERE id = ?', [ctx.channel.id, ctx.guild.id]);
            // l'ancien reglage unique suit le serveur principal
            const legacy = await db.getSetting('casino_channel');
            const old = legacy ? await ctx.client.channels.fetch(legacy).catch(() => null) : null;
            if (!old || old.guildId === ctx.guild.id) await db.setSetting('casino_channel', ctx.channel.id);
            await ctx.reply(`✅ Les annonces du casino sur **${ctx.guild.name}** arrivent dans <#${ctx.channel.id}>.`);
        },
    },
    {
        name: 'initmap',
        owner: true,
        category: 'admin',
        description: '[admin] Place une maison sur la carte de l\'app pour chaque membre connu (une fois)',
        async run(ctx) {
            const db = require('../db');
            const rows = await db.q('SELECT id_user FROM profile WHERE id_user != ? AND (last_seen > 0 OR rb > 0) ORDER BY rb DESC LIMIT 20', [require('../config').casinoId]);
            const ids = [];
            for (const r of rows) {
                const u = await ctx.client.users.fetch(String(r.id_user)).catch(() => null);
                if (u && !u.bot) ids.push(String(r.id_user));
            }
            const n = await require('../activity/life').initMap(ids);
            await ctx.reply(`🏘️ ${n} maison(s) placée(s). Le quartier a 20 places : au-delà, plus de maison.`);
        },
    },
    {
        name: 'recap',
        owner: true,
        category: 'admin',
        description: '[admin] Envoie le recap du casino du jour dans #daily maintenant',
        async run(ctx) {
            const res = await require('../lib/recap').send(ctx.client);
            await ctx.reply(res.error ? `❌ ${res.error}` : '✅ Récap envoyé dans #daily.');
        },
    },
    {
        name: 'event',
        owner: true,
        category: 'admin',
        description: '[admin] Lance un evenement : tous les gains (work, gw, daily, mine, contremaitre, XP) multiplies',
        usage: '[multiplicateur] [duree] · stop',
        example: 'event 5 48h',
        options: [
            { name: 'mult', type: 'string', description: 'Multiplicateur (2 a 10), ou "stop" pour arreter' },
            { name: 'duree', type: 'string', description: 'Duree : 48h, 90m, 2j (48h par defaut)' },
            { name: 'nom', type: 'string', description: 'Nom de l\'evenement (Retour du slip par defaut)' },
        ],
        async run(ctx, { mult, duree, nom }) {
            const cur = await boost.event();
            if (!mult) {
                const nextRain = cur ? Number(await db.getSetting('rain_next', '0')) : 0;
                return ctx.reply(cur
                    ? `🩲 **${cur.name}** en cours : gains **x${cur.mult}**, fin <t:${Math.floor(cur.end / 1000)}:R>.${nextRain > Date.now() ? ` Prochaine pluie de slips vers <t:${Math.floor(nextRain / 1000)}:t>.` : ''} \`${config.prefix}pluie\` pour en lâcher une, \`${config.prefix}event stop\` pour arrêter.`
                    : `Aucun événement en cours. Lance le retour du slip : \`${config.prefix}event 5 48h\``);
            }
            if (String(mult).toLowerCase() === 'stop') {
                if (!cur) return ctx.reply('Aucun événement en cours.');
                await boost.stopEvent();
                return ctx.reply(`🛑 **${cur.name}** arrêté. Les gains repassent à la normale.`);
            }
            const m = Math.floor(Number(String(mult).replace(/^x/i, '')));
            if (!(m >= 2 && m <= 10)) return ctx.fail('Multiplicateur entre 2 et 10 (ex. `event 5 48h`).');
            const d = String(duree || '48h').toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(m|min|h|j|d)?$/);
            if (!d) return ctx.fail('Durée invalide : `48h`, `90m`, `2j`.');
            const unit = { m: 60_000, min: 60_000, h: 3_600_000, j: 86_400_000, d: 86_400_000 }[d[2] || 'h'];
            const ms = Math.round(parseFloat(d[1].replace(',', '.')) * unit);
            if (!(ms >= 60_000 && ms <= 14 * 86_400_000)) return ctx.fail('Durée entre 1 minute et 14 jours.');
            const ev = await boost.startEvent(m, ms, nom ? String(nom).slice(0, 40) : 'Retour du slip');
            const end = Math.floor(ev.end / 1000);
            const embed = new EmbedBuilder()
                .setColor('#2ee62b')
                .setTitle(`🩲💨 ${ev.name.toUpperCase()} · GAINS x${ev.mult} 💨🩲`)
                .setDescription(
                    `Le slip est de retour et il sent **très** fort.\n\n` +
                    `Pendant **${duration(ms)}**, tout ce qui rapporte est **x${ev.mult}** :\n` +
                    `> 💼 \`${config.prefix}work\` · 🎲 \`${config.prefix}gw\` · 🎁 \`${config.prefix}daily\` · ⛏️ \`${config.prefix}mine\`\n` +
                    `> ⏱️ le salaire du contremaître · ⭐ **toute l'XP** (casino compris)\n` +
                    `> ☔ des **pluies de slips** tombent ici **sans prévenir** (5 lots, premiers arrivés) et les sacs du chat tombent 3x plus souvent\n\n` +
                    (nom ? '' : `Et le casino de l'app a été refait : **vraie roulette, Dice, Limbo, Keno, Tour du Slip, HiLo** (\`${config.prefix}plinko\` pour l'ouvrir).\n`) +
                    `Fin <t:${end}:R> (<t:${end}:f>). \`${config.prefix}cd\` pour tout ramasser d'un coup.`,
                );
            const sent = await announce.send({ content: '@here', allowedMentions: { parse: ['everyone'] }, embeds: [embed] }, ctx.channel.id);
            await ctx.reply(sent ? { content: `✅ Événement lancé et annoncé dans <#${sent.channel.id}>.` } : { content: '@here', allowedMentions: { parse: ['everyone'] }, embeds: [embed] });
        },
    },
    {
        name: 'pluie',
        owner: true,
        category: 'admin',
        description: '[admin] Lache une pluie de slips maintenant (5 lots) dans le salon du casino de chaque serveur',
        async run(ctx) {
            const rain = require('../lib/rain');
            const sent = await rain.pourEverywhere();
            if (sent.length) return ctx.whisper(`☔ Pluie lâchée dans ${sent.length} salon(s).`);
            await rain.pour(ctx.channel);
        },
    },
    {
        name: 'drawloto',
        owner: true,
        category: 'admin',
        description: '[admin] Force le tirage de la loterie maintenant',
        async run(ctx) {
            const res = await require('../lib/loto').draw(ctx.client);
            if (!res) return ctx.reply('Personne n\'a de ticket.');
            await ctx.reply(`✅ Tirage n°${res.round} effectué.`);
        },
    },
    {
        name: 'syncchamps',
        owner: true,
        category: 'admin',
        description: '[admin] Ajoute les nouveaux champions LoL a la base',
        async run(ctx) {
            await dd.syncChampions();
            const [{ n }] = await db.q('SELECT COUNT(*) AS n FROM champions');
            await ctx.reply(`✅ ${n} champions en base.`);
        },
    },
];
