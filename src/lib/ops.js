// Preuve que le bot est vivant, sans ouvrir Docker : un message au demarrage et a l'arret.
// Salon : OPS_CHANNEL_ID, sinon un salon nomme "ops" ou "admin".
const { execSync } = require('node:child_process');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const channels = require('./channels');
const log = require('./logger');
const config = require('../config');

function revision() {
    if (process.env.GIT_SHA) return String(process.env.GIT_SHA).slice(0, 12);
    try {
        return execSync('git rev-parse --short HEAD', {
            cwd: path.join(__dirname, '..', '..'),
            stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim();
    } catch {
        return require('../../package.json').version;
    }
}

function when() {
    return new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date());
}

async function room(client) {
    if (process.env.OPS_CHANNEL_ID) return client.channels.fetch(process.env.OPS_CHANNEL_ID).catch(() => null);
    return (await channels.find(client, 'ops')) || channels.find(client, 'admin');
}

async function post(client, embed) {
    const ch = await room(client);
    if (!ch?.send) {
        log.warn('[ops] pas de salon ops/admin (OPS_CHANNEL_ID) : le message de vie reste dans les logs');
        return;
    }
    await ch.send({ embeds: [embed] }).catch((e) => log.warn('[ops]', e.message));
}

async function up(client, activityOn) {
    const rev = revision();
    log.info(`[ops] en ligne ${rev} · activity ${activityOn ? 'up' : 'off'}`);
    await post(client, new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('Bot en ligne')
        .setDescription(
            `Commit \`${rev}\`\n${when()}, heure de Paris\nActivity : **${activityOn ? 'up' : 'off'}**` +
            (activityOn ? ` (port ${config.activity.port})` : ''),
        ));
}

async function down(client, sig) {
    await post(client, new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle('Bot arrêté')
        .setDescription(`${sig} · ${when()}, heure de Paris\nActivity : **down**`));
}

module.exports = { up, down, revision };
