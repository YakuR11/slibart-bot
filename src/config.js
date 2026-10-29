const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = (key, fallback = undefined) => {
    const v = process.env[key];
    return v === undefined || v === '' ? fallback : v;
};

const list = (key) => (env(key, '') || '').split(',').map((s) => s.trim()).filter(Boolean);

/** l'ID de l'application est la 1re partie du token, encodee en base64 */
function idFromToken(t) {
    try {
        return Buffer.from(String(t).split('.')[0], 'base64').toString('utf8').replace(/\D/g, '') || null;
    } catch {
        return null;
    }
}

const content = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'content.json'), 'utf8'));

module.exports = {
    token: env('DISCORD_TOKEN', env('TOKEN')), // TOKEN = ancien nom, toujours accepte
    prefix: env('PREFIX', '='),
    guildId: env('GUILD_ID'), // si defini : slash commands enregistrees instantanement sur ce serveur
    ownerIds: list('OWNER_IDS'),
    rbEmoji: env('RB_EMOJI', '<:rokbux:1312821555927191634>'),
    casinoId: env('CASINO_ID', '388'),
    slashEnabled: env('SLASH_COMMANDS', 'true') !== 'false',

    db: {
        host: env('DB_HOST', 'localhost'),
        port: Number(env('DB_PORT', 3306)),
        user: env('DB_USER', 'root'),
        password: env('DB_PASSWORD', ''),
        database: env('DB_NAME', 'slip'),
    },

    spotify: {
        clientId: env('SPOTIFY_CLIENT_ID'),
        clientSecret: env('SPOTIFY_CLIENT_SECRET'),
        refreshToken: env('SPOTIFY_REFRESH_TOKEN'),
    },

    translate: {
        defaultTarget: env('TRANSLATE_TARGET', 'zh'),
        email: env('TRANSLATE_EMAIL'), // optionnel, monte le quota MyMemory a 50k car/jour
    },

    sportsApiKey: env('SPORTS_API_KEY'),

    // Activity Discord (Plinko avec une vraie interface)
    activity: {
        enabled: env('ACTIVITY_ENABLED', 'true') !== 'false',
        port: Number(env('ACTIVITY_PORT', 3001)),
        clientId: env('DISCORD_CLIENT_ID', idFromToken(env('DISCORD_TOKEN', env('TOKEN')))),
        clientSecret: env('DISCORD_CLIENT_SECRET'),
        dev: env('ACTIVITY_DEV', 'false') === 'true', // mode test hors Discord, jamais en prod
    },

    content,
};
