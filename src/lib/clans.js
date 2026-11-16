// Guerre de clans : un clan = un serveur Discord. Chaque joueur appartient au premier serveur ou il
// a utilise le bot. =clan rejoindre change de clan : libre la premiere fois, puis une fois par semaine. Le compte en banque reste
// le meme partout : c'est le gain net au casino de la semaine (table weekly) qui est additionne par clan.
const db = require('../db');
const config = require('../config');
const log = require('./logger');

const SWITCH_CD = 7 * 24 * 3600 * 1000;
const WAR_RB = 1000; // par membre actif du clan gagnant
const WAR_CRATE = 'coffre_rare';
const WAR_MAX_PAID = 60;

const known = new Map(); // serveur -> nom deja enregistre
const placed = new Set(); // joueurs qui ont deja un clan (evite une requete par commande)

/** enregistre (ou renomme) un serveur ou le bot est present */
async function touchGuild(guild) {
    if (!guild?.id || known.get(guild.id) === guild.name) return;
    known.set(guild.id, guild.name);
    await db.exec(
        'INSERT INTO guilds (id, name, joined_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
        [guild.id, String(guild.name || 'serveur').slice(0, 100), Date.now()],
    );
}

/** premier passage d'un joueur sur un serveur : il rejoint ce clan */
async function seen(guild, userId) {
    if (!guild?.id) return;
    await touchGuild(guild);
    await ensureClan(userId, guild.id);
}

async function ensureClan(userId, guildId) {
    const id = String(userId);
    if (placed.has(id) || id === String(config.casinoId)) return;
    await db.ensureProfile(id);
    // placement automatique : clan_at reste a 0, le premier changement volontaire est donc libre
    await db.exec('UPDATE profile SET clan = ?, clan_at = 0 WHERE id_user = ? AND clan IS NULL', [String(guildId), id]);
    placed.add(id);
}

async function clanOf(userId) {
    const [row] = await db.q('SELECT p.clan, p.clan_at, g.name FROM profile p LEFT JOIN guilds g ON g.id = p.clan WHERE p.id_user = ?', [String(userId)]);
    return row?.clan ? { id: String(row.clan), name: row.name || 'serveur inconnu', since: Number(row.clan_at) } : null;
}

/** change de clan (une fois par semaine). Retourne { ok } ou { error } */
async function join(userId, guild) {
    await touchGuild(guild);
    const cur = await clanOf(userId);
    if (cur?.id === guild.id) return { error: `Tu es déjà dans le clan **${guild.name}**.` };
    if (cur && cur.since > 0 && Date.now() - cur.since < SWITCH_CD) return { error: `Tu as rejoint **${cur.name}** il y a moins de 7 jours. Prochain changement possible <t:${Math.floor((cur.since + SWITCH_CD) / 1000)}:R>.` };
    await db.ensureProfile(userId);
    await db.exec('UPDATE profile SET clan = ?, clan_at = ? WHERE id_user = ?', [guild.id, Date.now(), String(userId)]);
    placed.add(String(userId));
    return { ok: true, from: cur };
}

/** classement de la semaine : [{ id, name, net, games, players, members }] du meilleur au pire */
async function standings(week) {
    const rows = await db.q(
        `SELECT g.id, g.name,
                COALESCE(SUM(w.net), 0) AS net, COALESCE(SUM(w.games), 0) AS games, COUNT(w.id_user) AS players,
                (SELECT COUNT(*) FROM profile p2 WHERE p2.clan = g.id) AS members
         FROM guilds g
         LEFT JOIN profile p ON p.clan = g.id AND p.id_user != ?
         LEFT JOIN weekly w ON w.id_user = p.id_user AND w.week = ?
         GROUP BY g.id, g.name
         ORDER BY net DESC, games DESC`,
        [String(config.casinoId), week],
    );
    return rows.map((r) => ({ id: String(r.id), name: r.name, net: Number(r.net), games: Number(r.games), players: Number(r.players), members: Number(r.members) }));
}

/** les joueurs d'un clan cette semaine, du plus gros gain au plus gros trou */
async function roster(guildId, week, limit = 5) {
    return db.q(
        `SELECT w.id_user, w.net, w.games FROM weekly w JOIN profile p ON p.id_user = w.id_user
         WHERE w.week = ? AND p.clan = ? AND w.id_user != ? ORDER BY w.net DESC LIMIT ?`,
        [week, String(guildId), String(config.casinoId), limit],
    );
}

/**
 * Fin de semaine : le clan qui a le plus gros gain net gagne. Il faut au moins deux clans qui ont joue.
 * Chaque membre du clan gagnant qui a joue cette semaine recoit WAR_RB + un coffre rare.
 */
async function payWar(week) {
    const eco = require('./economy');
    const inv = require('./inventory');
    const table = (await standings(week)).filter((c) => c.games > 0);
    if (table.length < 2) return null;
    const winner = table[0];
    const members = await db.q(
        `SELECT w.id_user FROM weekly w JOIN profile p ON p.id_user = w.id_user
         WHERE w.week = ? AND p.clan = ? AND w.games > 0 AND w.id_user != ? ORDER BY w.net DESC LIMIT ?`,
        [week, winner.id, String(config.casinoId), WAR_MAX_PAID],
    );
    for (const m of members) {
        await eco.addRb(String(m.id_user), WAR_RB);
        await inv.add(String(m.id_user), WAR_CRATE);
    }
    log.info(`[clans] ${week} : ${winner.name} gagne la guerre (${members.length} membres payes)`);
    return { winner, table, paid: members.length };
}

module.exports = { touchGuild, seen, ensureClan, clanOf, join, standings, roster, payWar, SWITCH_CD, WAR_RB, WAR_CRATE };
