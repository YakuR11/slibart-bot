const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const config = require('../config');
const log = require('./logger');
const { Ctx } = require('./context');

const commands = new Map(); // nom -> commande
const lookup = new Map(); // nom ou alias -> commande

const CATEGORIES = {
    general: { label: '📌 Général', order: 1 },
    profil: { label: '🖼️ Profil', order: 2 },
    eco: { label: '💰 Capitalism', order: 3 },
    jeux: { label: '🎲 Jeux & casino', order: 4 },
    sport: { label: '⚽ Paris', order: 5 },
    prog: { label: '📈 Progression', order: 6 },
    top: { label: '🏆 Classements', order: 7 },
    champ: { label: '⛓️ Champions', order: 8 },
    util: { label: '🛠️ Utilitaires', order: 9 },
    admin: { label: '🔒 Admin', order: 10 },
};

function load() {
    const dir = path.join(__dirname, '..', 'commands');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
        const mod = require(path.join(dir, file));
        for (const cmd of [].concat(mod)) {
            if (!cmd?.name || !cmd.run) continue;
            cmd.options ??= [];
            cmd.aliases ??= [];
            cmd.category ??= 'general';
            if (commands.has(cmd.name)) throw new Error(`commande en double : ${cmd.name}`);
            commands.set(cmd.name, cmd);
            for (const n of [cmd.name, ...cmd.aliases]) {
                if (lookup.has(n)) throw new Error(`alias en double : ${n}`);
                lookup.set(n, cmd);
            }
        }
    }
    log.info(`[cmd] ${commands.size} commandes chargees (${lookup.size} avec alias)`);
}

const usage = (cmd) => `${config.prefix}${cmd.name}${cmd.usage ? ` ${cmd.usage}` : ''}`;

// ---------------------------------------------------------------------------
// Prefixe : "=give @bob 500" -> { cible: User, montant: "500" }
// ---------------------------------------------------------------------------
const MENTION = /^<@!?(\d{17,20})>$|^(\d{17,20})$/;

async function parsePrefixArgs(ctx, cmd, tokens) {
    const args = {};
    const rest = [...tokens];

    // les mentions peuvent etre n'importe ou : "=give 500 @bob" marche aussi
    for (const opt of cmd.options.filter((o) => o.type === 'user')) {
        const idx = rest.findIndex((t) => MENTION.test(t));
        if (idx === -1) continue;
        const [, a, b] = rest[idx].match(MENTION);
        const user = await ctx.client.users.fetch(a || b).catch(() => null);
        if (user) {
            args[opt.name] = user;
            rest.splice(idx, 1);
        }
    }

    for (const opt of cmd.options) {
        if (opt.type === 'user') continue;
        if (opt.type === 'text') {
            const v = rest.splice(0).join(' ').trim();
            if (v) args[opt.name] = v;
            continue;
        }
        if (!rest.length) continue;
        if (opt.type === 'integer') {
            const n = parseInt(rest[0], 10);
            if (Number.isNaN(n)) continue;
            args[opt.name] = n;
            rest.shift();
        } else {
            args[opt.name] = rest.shift();
        }
    }

    const missing = cmd.options.find((o) => o.required && args[o.name] === undefined);
    return { args, missing };
}

async function handleMessage(client, message) {
    if (message.author.bot || !message.content.startsWith(config.prefix)) return false;
    const body = message.content.slice(config.prefix.length).trim();
    if (!body) return false;
    const [rawName, ...tokens] = body.split(/\s+/);
    const name = rawName.toLowerCase();
    const cmd = lookup.get(name);
    if (!cmd) return false;

    const ctx = new Ctx(client, { message, command: cmd, alias: name });
    if (cmd.guildOnly !== false && !message.guild) {
        await ctx.reply('Cette commande marche seulement sur un serveur.');
        return true;
    }
    const { args, missing } = await parsePrefixArgs(ctx, cmd, tokens);
    if (missing) {
        await ctx.reply(`Utilisation : \`${usage(cmd)}\`${cmd.example ? `\nEx : \`${config.prefix}${cmd.example}\`` : ''}`);
        return true;
    }
    ctx.args = args;
    await run(ctx);
    return true;
}

// ---------------------------------------------------------------------------
// Slash
// ---------------------------------------------------------------------------
async function handleInteraction(client, interaction) {
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && String(interaction.customId || '').startsWith('sp:')) {
        await require('../commands/sports').handleComponent(interaction);
        return;
    }
    if (!interaction.isChatInputCommand()) return;
    const cmd = commands.get(interaction.commandName);
    if (!cmd) return;
    const ctx = new Ctx(client, { interaction, command: cmd, alias: cmd.name });
    for (const opt of cmd.options) {
        let v = null;
        if (opt.type === 'user') v = interaction.options.getUser(opt.name);
        else if (opt.type === 'integer') v = interaction.options.getInteger(opt.name);
        else v = interaction.options.getString(opt.name);
        if (v !== null && v !== undefined) ctx.args[opt.name] = v;
    }
    await run(ctx);
}

async function run(ctx) {
    const cmd = ctx.command;
    if (cmd.owner && !config.ownerIds.includes(ctx.user.id)) {
        await ctx.fail("Commande reservee aux admins du bot (OWNER_IDS dans le .env).");
        return;
    }
    const stopDefer = ctx.autoDefer();
    try {
        await cmd.run(ctx, ctx.args);
        await welcome(ctx);
        await comeback(ctx);
    } catch (err) {
        log.error(`[cmd ${cmd.name}]`, err);
        await ctx.reply('💥 Oups, erreur interne. Reessaie dans un instant.').catch(() => {});
    } finally {
        stopDefer();
    }
}

// Pack de bienvenue : la premiere fois qu'une personne utilise le bot
const WELCOME_RB = 500;
async function welcome(ctx) {
    const db = require('../db');
    const res = await db.exec('INSERT IGNORE INTO settings (k, v) VALUES (?, ?)', [`welcome:${ctx.user.id}`, String(Date.now())]);
    if (!res.affectedRows) return;
    await require('./economy').addRb(ctx.user.id, WELCOME_RB);
    await require('./inventory').add(ctx.user.id, 'coffre_rare');
    const { EmbedBuilder } = require('discord.js');
    const p = config.prefix;
    const embed = new EmbedBuilder()
        .setColor('#ff9f43')
        .setTitle(`👋 Bienvenue ${ctx.displayName} !`)
        .setDescription(
            `Cadeau de bienvenue : **+${WELCOME_RB}** ${config.rbEmoji} + 🎁 **Coffre rare** → \`${p}ouvrir\`\n\n` +
            `**Pour bien démarrer :**\n` +
            `🎁 \`${p}daily\` tous les jours : RB + un coffre (rare tous les 7 jours)\n` +
            `💼 \`${p}work\` toutes les 30 min\n` +
            `📜 \`${p}quetes\` 3 quêtes par jour + un coffre\n` +
            `🎰 \`${p}slots\` \`${p}bj\` \`${p}mines\` \`${p}crash\` \`${p}g\` au casino\n` +
            `⚽ \`${p}matchs\` gros matchs foot, Worlds et LEC · \`${p}parier\` pour miser\n` +
            `💎 Jackpot progressif aux slots, loterie à 21h, happy hour surprise le soir\n` +
            `⏱️ \`${p}cd\` : tout ce qui est dispo en 1 clic · \`${p}help\` pour le reste`,
        );
    await ctx.channel.send({ embeds: [embed] }).catch(() => {});
}

// Bonus de retour : 3 jours sans utiliser le bot -> cadeau pour le faire revenir dans la boucle
const COMEBACK_AFTER = 3 * 24 * 3600 * 1000;
async function comeback(ctx) {
    const db = require('../db');
    await db.ensureProfile(ctx.user.id);
    const [row] = await db.q('SELECT last_seen FROM profile WHERE id_user = ?', [ctx.user.id]);
    const last = Number(row?.last_seen || 0);
    const now = Date.now();
    await db.exec('UPDATE profile SET last_seen = ? WHERE id_user = ?', [now, ctx.user.id]);
    if (!last || now - last < COMEBACK_AFTER) return;
    const days = Math.floor((now - last) / (24 * 3600 * 1000));
    await require('./economy').addRb(ctx.user.id, 1000);
    await require('./inventory').add(ctx.user.id, 'coffre_rare');
    const { EmbedBuilder } = require('discord.js');
    await ctx.channel.send({
        embeds: [new EmbedBuilder()
            .setColor('#ff9f43')
            .setTitle(`🥹 ${ctx.displayName} est de retour !`)
            .setDescription(`${days} jours sans toi... cadeau : **+1.000** ${config.rbEmoji} + 🎁 **Coffre rare** (\`${config.prefix}ouvrir\`)\n\`${config.prefix}cd\` pour voir tout ce qui t'attend.`)],
    }).catch(() => {});
}

function buildSlash() {
    const out = [];
    for (const cmd of commands.values()) {
        if (cmd.slash === false) continue;
        const b = new SlashCommandBuilder()
            .setName(cmd.name)
            .setDescription((cmd.description || cmd.name).slice(0, 100))
            .setContexts(InteractionContextType.Guild);
        for (const opt of cmd.options) {
            const setup = (o) => {
                o.setName(opt.name).setDescription((opt.description || opt.name).slice(0, 100)).setRequired(!!opt.required);
                if (opt.choices) o.addChoices(...opt.choices.map((c) => (typeof c === 'string' ? { name: c, value: c } : c)));
                if (opt.min !== undefined && o.setMinValue) o.setMinValue(opt.min);
                if (opt.max !== undefined && o.setMaxValue) o.setMaxValue(opt.max);
                return o;
            };
            if (opt.type === 'user') b.addUserOption(setup);
            else if (opt.type === 'integer') b.addIntegerOption(setup);
            else b.addStringOption(setup);
        }
        out.push(b.toJSON());
    }
    return out;
}

async function registerSlash(client) {
    if (!config.slashEnabled) return;
    const body = buildSlash();
    try {
        if (config.guildId) {
            const guild = await client.guilds.fetch(config.guildId);
            await guild.commands.set(body);
            log.info(`[slash] ${body.length} commandes enregistrees sur le serveur ${guild.name}`);
        } else {
            await client.application.commands.set(body);
            log.info(`[slash] ${body.length} commandes enregistrees globalement (peut prendre quelques minutes)`);
        }
    } catch (e) {
        log.error('[slash] enregistrement impossible :', e.message);
    }
}

module.exports = { run, load, commands, lookup, CATEGORIES, usage, handleMessage, handleInteraction, registerSlash, buildSlash };
