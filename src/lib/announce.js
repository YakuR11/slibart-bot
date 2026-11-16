// Annonces dans le salon du casino (=setsalon) : big wins, happy hour, saison, evenements...
// Le bot peut etre sur plusieurs serveurs : chaque serveur a son salon (=setsalon chez lui) et
// une annonce part dans tous. L'ancien reglage unique (casino_channel) continue de marcher.
const db = require('../db');

let client = null;
const init = (c) => { client = c; };

/** tous les salons d'annonce, un par serveur au plus */
async function channels() {
    if (!client) return [];
    const ids = new Set();
    for (const g of await db.q('SELECT casino_channel FROM guilds WHERE casino_channel IS NOT NULL').catch(() => [])) ids.add(String(g.casino_channel));
    const legacy = (await db.getSetting('casino_channel')) || (ids.size ? null : await db.getSetting('loto_channel'));
    if (legacy) ids.add(String(legacy));
    const out = [];
    const guilds = new Set();
    for (const id of ids) {
        const ch = await client.channels.fetch(id).catch(() => null);
        if (!ch?.send || guilds.has(ch.guildId)) continue;
        guilds.add(ch.guildId);
        out.push(ch);
    }
    return out;
}

/** le salon d'annonce principal (le premier trouve) */
async function channel() {
    return (await channels())[0] || null;
}

/** salon d'annonce d'un serveur precis, sinon null */
async function channelOf(guildId) {
    return (await channels()).find((c) => c.guildId === guildId) || null;
}

/**
 * Envoie dans le salon d'annonce de chaque serveur. Retourne le premier message envoye (ou null).
 * @param skipChannelId ne pas annoncer dans ce salon (c'est la que ca vient de se passer, deja visible)
 */
async function send(payload, skipChannelId = null) {
    let first = null;
    for (const ch of await channels()) {
        if (ch.id === skipChannelId) continue;
        const msg = await ch.send(payload).catch(() => null);
        first = first || msg;
    }
    return first;
}

/** envoie partout et rend tous les messages (pour y brancher des boutons) */
async function sendAll(payload) {
    const out = [];
    for (const ch of await channels()) {
        const msg = await ch.send(payload).catch(() => null);
        if (msg) out.push(msg);
    }
    return out;
}

module.exports = { init, channel, channels, channelOf, send, sendAll };
