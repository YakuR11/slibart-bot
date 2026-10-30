// Trouve un salon par son nom (#bot, #daily...) sur le serveur, avec un id force possible dans le .env.
const config = require('../config');

const ENV = { bot: 'BOT_CHANNEL_ID', daily: 'DAILY_CHANNEL_ID' };
const cache = new Map();

async function find(client, name) {
    const forced = process.env[ENV[name]];
    if (forced) return client.channels.fetch(forced).catch(() => null);
    if (cache.has(name)) {
        const ch = client.channels.cache.get(cache.get(name));
        if (ch) return ch;
    }
    const guilds = config.guildId ? [client.guilds.cache.get(config.guildId)].filter(Boolean) : [...client.guilds.cache.values()];
    for (const g of guilds) {
        const list = await g.channels.fetch().catch(() => g.channels.cache);
        // nom exact d'abord, puis un salon dont le nom contient le mot (ex. "🤖・bot")
        const text = [...list.values()].filter((c) => c?.isTextBased?.() && !c.isThread?.());
        const ch = text.find((c) => c.name === name) || text.find((c) => c.name.toLowerCase().includes(name));
        if (ch) {
            cache.set(name, ch.id);
            return ch;
        }
    }
    return null;
}

module.exports = { find };
