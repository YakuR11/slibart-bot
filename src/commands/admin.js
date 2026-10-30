// Commandes reservees aux IDs listes dans OWNER_IDS (.env)
const config = require('../config');
const db = require('../db');
const eco = require('../lib/economy');
const cd = require('../lib/cooldowns');
const dd = require('../lib/ddragon');
const media = require('../lib/media');
const { fmt } = require('../lib/utils');

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
        description: '[admin] Salon ou le bot annonce la loterie (celui-ci par defaut)',
        async run(ctx) {
            await db.setSetting('casino_channel', ctx.channel.id);
            await ctx.reply(`✅ Les tirages de la loterie seront annoncés dans <#${ctx.channel.id}>.`);
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
            await ctx.reply(`🏘️ ${n} maison(s) placée(s) sur la carte (20 places max). Les nouveaux en reçoivent une en ouvrant l'app.`);
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
