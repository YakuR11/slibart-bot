const { Client, GatewayIntentBits, Partials, ActivityType, Events, PermissionFlagsBits } = require('discord.js');
const config = require('./config');
const db = require('./db');
const log = require('./lib/logger');
const handler = require('./lib/handler');
const triggers = require('./events/triggers');
const dd = require('./lib/ddragon');
const media = require('./lib/media');
const scheduler = require('./lib/scheduler');
const activity = require('./activity/server');
const ops = require('./lib/ops');

// Voir, ecrire, embeds, fichiers, historique, reactions, gerer les messages, emojis externes, @here.
// Pas Administrateur : le bot n'en a pas besoin, et un lien public ne doit pas le demander.
const INVITE_PERMS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.UseExternalEmojis,
    PermissionFlagsBits.MentionEveryone,
].reduce((a, b) => a | b, 0n);

if (!config.token) {
    log.error('DISCORD_TOKEN manquant dans le .env');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
});

client.once(Events.ClientReady, async (c) => {
    log.info(`slibart puant est dans la place (${c.user.tag}) · ${c.guilds.cache.size} serveur(s)`);

    // statut qui tourne toutes les 2 minutes
    let k = 0;
    const statuses = config.content.statuses?.length ? config.content.statuses : ['je sens mauvais'];
    const setStatus = () => c.user.setPresence({ activities: [{ name: 'Custom Status', state: statuses[k++ % statuses.length], type: ActivityType.Custom }], status: 'online' });
    setStatus();
    setInterval(setStatus, 120_000);

    // l'emoji rokbux vient du serveur de ton pote : si le bot n'y est pas, on passe sur 💰
    const emo = config.rbEmoji.match(/^<a?:\w+:(\d+)>$/);
    if (emo && !c.emojis.cache.has(emo[1])) {
        log.warn(`[emoji] ${config.rbEmoji} inaccessible (le bot n'est pas sur le serveur de l'emoji) -> 💰`);
        config.rbEmoji = '💰';
    }
    media.start();
    scheduler.start(c);
    const activityServer = await activity.start(c);

    log.info(`Inviter le bot : https://discord.com/oauth2/authorize?client_id=${c.user.id}&scope=bot+applications.commands&permissions=${INVITE_PERMS}`);
    await ops.up(c, !!activityServer);

    await handler.registerSlash(c);
    dd.syncChampions().catch((e) => log.warn('[champions] sync :', e.message));
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    try {
        await handler.handleMessage(client, message);
        await triggers.onMessage(message); // les insultes dans une commande comptent aussi
    } catch (e) {
        log.error('[message]', e);
    }
});

client.on(Events.InteractionCreate, (interaction) => {
    handler.handleInteraction(client, interaction).catch((e) => log.error('[interaction]', e));
});

client.on(Events.Error, (e) => log.error('[client]', e.message));
process.on('unhandledRejection', (e) => log.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => log.error('[uncaughtException]', e));

let stopping = false;
async function shutdown(sig) {
    if (stopping) return;
    stopping = true;
    log.info(`${sig} recu, arret propre...`);
    await Promise.race([
        ops.down(client, sig),
        new Promise((r) => setTimeout(r, 4000)),
    ]);
    await client.destroy().catch(() => {});
    await db.close();
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
    handler.load();
    // la base peut mettre quelques secondes a demarrer (docker compose) : on reessaie
    for (let i = 1; ; i++) {
        try {
            await db.migrate();
            break;
        } catch (e) {
            if (i >= 15) {
                log.error('Impossible de se connecter a la base :', e.message);
                process.exit(1);
            }
            log.warn(`base pas prete (${e.code || e.message}), nouvel essai dans 4s... (${i}/15)`);
            await new Promise((r) => setTimeout(r, 4000));
        }
    }
    await client.login(config.token);
})();
