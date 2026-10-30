// Centre des paris : tous les jeux de l'app passent par ici.
// Chaque pari est annonce en deux temps (la mise, puis le resultat), vu par TOUT le monde dans l'app,
// note dans le journal (pour le recap du jour) et poste dans #bot a partir de 500.
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
const log = require('../lib/logger');
const channels = require('../lib/channels');
const paris = require('../lib/paris');
const { fmt } = require('../lib/utils');

const GAMES = {
    plinko: { label: 'Plinko', emoji: '🎯' },
    crash: { label: 'Crash', emoji: '🚀' },
    roulette: { label: 'Roulette', emoji: '🎡' },
    slots: { label: 'Slots', emoji: '🎰' },
    blackjack: { label: 'Blackjack', emoji: '🃏' },
    mines: { label: 'Mines', emoji: '💣' },
    loto: { label: 'Loto', emoji: '🎟️' },
    duel: { label: 'Duel', emoji: '⚔️' },
};
const DISCORD_MIN = 500; // en dessous : visible seulement dans l'app
const HYPE_MIN = 2000; // mise >= 2000 et gagnee : tout le monde est notifie (+ GIF perso)
const ALLIN_MIN = 1000; // all-in avec plus de 1000 : taille max, ecran qui s'illumine chez tout le monde
const KEEP = 40;

const entries = [];
let seq = 0;
let hub = null; // { broadcastAll(msg) }
let client = null;

function init(h, discordClient) {
    hub = h;
    client = discordClient;
}

/** 1 (petit) a 5 (all-in) */
function tierOf(bet, allin) {
    if (allin) return 5;
    if (bet >= HYPE_MIN) return 4;
    if (bet >= 500) return 3;
    if (bet >= 100) return 2;
    return 1;
}

/** intensite du halo du resultat : 0 a 1 (1 = all-in) */
function glowOf(net, allin) {
    if (allin) return 1;
    return Math.min(1, Math.log10(Math.abs(net) + 1) / Math.log10(25000));
}

function pub(e) {
    const { discordMsg, ...rest } = e;
    return rest;
}

/**
 * Annonce d'une mise.
 * player = { id, name, avatar, skins }, balBefore = solde avant la mise (pour l'all-in)
 */
function start({ player, game, bet, allin = false, balBefore = 0, text = null, vs = null }) {
    const realAllin = !!allin && balBefore > ALLIN_MIN;
    const e = {
        id: ++seq,
        player: { id: player.id, name: player.name, avatar: player.avatar, skins: player.skins || null },
        vs: vs ? { id: vs.id, name: vs.name, avatar: vs.avatar, skins: vs.skins || null } : null,
        game,
        bet,
        allin: realAllin,
        tier: tierOf(bet, realAllin),
        text,
        at: Date.now(),
        state: 'live',
    };
    entries.push(e);
    while (entries.length > KEEP) entries.shift();
    hub?.broadcastAll({ type: 'feed:bet', entry: pub(e) });
    return e.id;
}

/** mise annulee (ex. Crash avant decollage) : on la retire du centre */
function cancel(id) {
    const i = entries.findIndex((x) => x.id === id);
    if (i < 0) return;
    entries.splice(i, 1);
    hub?.broadcastAll({ type: 'feed:cancel', id });
}

/** met a jour une mise en cours (ex. Plinko : la rafale grossit) */
function grow(id, { bet, allin, balBefore }) {
    const e = entries.find((x) => x.id === id);
    if (!e || e.state !== 'live') return;
    e.bet = bet;
    if (allin && balBefore > ALLIN_MIN) e.allin = true;
    e.tier = tierOf(e.bet, e.allin);
    hub?.broadcastAll({ type: 'feed:bet', entry: pub(e) });
}

/**
 * Resultat. net = gain net (negatif si perdu), mult facultatif, text = detail ("×110", "Blackjack !")
 * winner (duel) = id du gagnant
 */
async function finish(id, { net, mult = null, text = null, winner = null, playerId = null }) {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    e.state = 'done';
    e.net = Math.trunc(net);
    e.mult = mult;
    if (text) e.text = text;
    e.winner = winner;
    e.glow = glowOf(e.net, e.allin);
    e.hype = e.bet >= HYPE_MIN && e.net > 0;
    const who = winner ? (winner === e.player.id ? e.player : e.vs) : e.player;
    if (e.hype || (e.allin && e.net > 0)) e.gif = await gifUrl(who.id);
    hub?.broadcastAll({ type: 'feed:result', entry: pub(e) });

    // journal du jour (recap #daily)
    const day = paris.now().day;
    const rows = e.game === 'duel' && e.vs
        ? [[e.player.id, e.bet, winner === e.player.id ? e.bet : -e.bet], [e.vs.id, e.bet, winner === e.vs.id ? e.bet : -e.bet]]
        : [[playerId || e.player.id, e.bet, e.net]];
    for (const [uid, bet, n] of rows) {
        db.exec('INSERT INTO gamble_log (id_user, game, bet, net, allin, at, day) VALUES (?, ?, ?, ?, ?, ?, ?)', [uid, e.game, bet, n, e.allin ? 1 : 0, Date.now(), day])
            .catch((err) => log.warn('[feed] journal', err.message));
    }
    if (e.bet >= DISCORD_MIN || e.allin) postDiscord(e, who).catch((err) => log.warn('[feed] #bot', err.message));
}

function snapshot() {
    return entries.slice(-25).map(pub);
}

// ---------------------------------------------------------------------------
// GIF perso (achete 1000 RB dans la boutique)
// ---------------------------------------------------------------------------
async function gifUrl(userId) {
    const owned = await db.q("SELECT qty FROM inventory WHERE id_user = ? AND item = 'perk:gif' AND qty > 0", [String(userId)]);
    if (!owned.length) return null;
    const url = await db.getSetting(`gif:${userId}`);
    return url || null;
}

// ---------------------------------------------------------------------------
// #bot
// ---------------------------------------------------------------------------
async function postDiscord(e, who) {
    if (!client) return;
    const ch = await channels.find(client, 'bot');
    if (!ch) return;
    const g = GAMES[e.game] || { label: e.game, emoji: '🎲' };
    const won = e.net > 0;
    const big = Math.abs(e.net) >= 5000 || e.allin;
    const lol = !won && (e.allin || Math.abs(e.net) >= 2000) ? ' 🤣🤣🤣' : '';
    let title;
    if (e.game === 'duel' && e.vs) {
        const loser = who.id === e.player.id ? e.vs : e.player;
        title = `${g.emoji} ${who.name} bat ${loser.name} en duel`;
    } else if (e.allin) title = won ? `🔥 ALL-IN GAGNÉ · ${who.name}` : `💀 ALL-IN PERDU · ${who.name}${lol}`;
    else title = won ? `${g.emoji} ${who.name} gagne au ${g.label}` : `${g.emoji} ${who.name} perd au ${g.label}${lol}`;
    const line = e.game === 'duel'
        ? `Pot **${fmt(e.bet * 2)}** ${config.rbEmoji}`
        : `Mise **${fmt(e.bet)}** ${config.rbEmoji}${e.mult ? ` · ×${e.mult}` : ''}${e.text ? ` · ${e.text}` : ''}\n${won ? '📈' : '📉'} **${won ? '+' : ''}${fmt(e.net)}** ${config.rbEmoji}`;
    const embed = new EmbedBuilder()
        .setColor(won ? (big ? '#2ecc71' : '#8fe3a1') : (big ? '#e74c3c' : '#ff8a7a'))
        .setTitle(title)
        .setDescription(`${line}\n-# 🚀 joué dans l'app (vocal → Activités)`);
    if (e.gif) embed.setImage(e.gif);
    const u = await client.users.fetch(who.id).catch(() => null);
    if (u) embed.setThumbnail(u.displayAvatarURL({ extension: 'png', size: 128 }));
    await ch.send({ embeds: [embed] });
}

module.exports = { init, start, grow, cancel, finish, snapshot, tierOf, GAMES, HYPE_MIN, ALLIN_MIN };
