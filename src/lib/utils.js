const { EmbedBuilder } = require('discord.js');

/** 1234567 -> "1.234.567" */
const fmt = (n) => Math.trunc(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** 5400000 -> "1h 30min" */
function duration(ms) {
    const s = Math.max(1, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return `${h}h${m ? ` ${m}min` : ''}`;
    if (m) return `${m}min${sec && m < 5 ? ` ${sec}s` : ''}`;
    return `${sec}s`;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const RANK = ['👑', '🥈', '🥉'];
const rankEmoji = (i) => RANK[i] || (i < 5 ? '🔻' : '▫️');

/** minuscules + sans accents : "Enculé" -> "encule" */
const normalize = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const isUrl = (s) => /^https?:\/\/\S+\.\S+/i.test(String(s || ''));

const avatar = (user, size = 256) => user.displayAvatarURL({ extension: 'png', size });

/** Nom affiche : surnom serveur > display name global > username */
function displayName(user, member) {
    return member?.displayName || user?.globalName || user?.username || 'inconnu';
}

// Cache des pseudos pour les classements (evite 10 appels API par =top)
const nameCache = new Map();
async function nameOf(client, guild, userId) {
    const id = String(userId);
    const cached = nameCache.get(id);
    if (cached && cached.t > Date.now() - 10 * 60 * 1000) return cached.n;
    let n = null;
    const member = guild?.members.cache.get(id) || (guild ? await guild.members.fetch(id).catch(() => null) : null);
    if (member) n = member.displayName;
    else {
        const u = await client.users.fetch(id).catch(() => null);
        n = u ? u.globalName || u.username : `inconnu (${id.slice(-4)})`;
    }
    nameCache.set(id, { n, t: Date.now() });
    return n;
}

/** Embed de base avec footer "pseudo + avatar" comme dans l'ancien bot */
function baseEmbed(ctx, color = '#eeebff') {
    return new EmbedBuilder()
        .setColor(color)
        .setFooter({ text: ctx.displayName, iconURL: avatar(ctx.user) });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { fmt, duration, pick, randInt, rankEmoji, normalize, isUrl, avatar, displayName, nameOf, baseEmbed, sleep };
