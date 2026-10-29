// Annonces dans le salon du casino (=setsalon) : big wins, happy hour, saison...
const db = require('../db');

let client = null;
const init = (c) => { client = c; };

/** salon d'annonce : =setsalon, sinon dernier salon ou quelqu'un a joue au loto */
async function channel() {
    if (!client) return null;
    const id = (await db.getSetting('casino_channel')) || (await db.getSetting('loto_channel'));
    return id ? client.channels.fetch(id).catch(() => null) : null;
}

/**
 * Envoie dans le salon d'annonce.
 * @param skipChannelId ne pas annoncer si c'est le salon ou ca vient de se passer (deja visible)
 */
async function send(payload, skipChannelId = null) {
    const ch = await channel();
    if (!ch || ch.id === skipChannelId) return null;
    return ch.send(payload).catch(() => null);
}

module.exports = { init, channel, send };
