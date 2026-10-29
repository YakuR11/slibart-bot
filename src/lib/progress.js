// Moteur de progression : XP / niveaux, quetes du jour, succes.
// Toutes les commandes appellent track(ctx, { play: 1, win: 1, wager: 500, ... }, meta)
// et les annonces (level up, quete finie, succes) sont envoyees dans le salon.
const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const eco = require('./economy');
const log = require('./logger');
const { fmt, avatar } = require('./utils');
const { COLORS, bar } = require('./ui');
const config = require('../config');
const inv = require('./inventory');
const boost = require('./boost');

const RB = () => config.rbEmoji;

// ---------------------------------------------------------------------------
// Niveaux (meme courbe que MEE6) : niveau n -> n+1 demande 5n² + 50n + 100 XP
// ---------------------------------------------------------------------------
const xpForNext = (lvl) => 5 * lvl * lvl + 50 * lvl + 100;

function levelInfo(totalXp) {
    let lvl = 0;
    let rest = Number(totalXp) || 0;
    while (rest >= xpForNext(lvl)) {
        rest -= xpForNext(lvl);
        lvl++;
    }
    return { level: lvl, cur: rest, need: xpForNext(lvl) };
}

const levelReward = (lvl) => 150 * lvl;

// XP gagnee par action
const XP = { play: 4, win: 4, mine: 2, work: 12, gw: 8, daily: 30, rc: 3, link: 10, duel_win: 25, duel: 8, loto: 2 };

// ---------------------------------------------------------------------------
// Quetes du jour (3 par personne, tirees au hasard chaque jour a minuit)
// ---------------------------------------------------------------------------
const QUESTS = {
    play: { label: (n) => `Joue **${n}** parties au casino`, min: 6, max: 15, reward: (n) => 35 * n },
    win: { label: (n) => `Gagne **${n}** parties au casino`, min: 3, max: 7, reward: (n) => 90 * n },
    wager: { label: (n) => `Mise **${fmt(n)}** ${RB()} au total`, min: 5, max: 30, step: 100, reward: (n) => Math.round(n * 0.2) },
    mine: { label: (n) => `Mine **${n}** fois`, min: 5, max: 12, reward: (n) => 30 * n },
    work: { label: (n) => `Fais **${n}** \`work\``, min: 2, max: 4, reward: (n) => 120 * n },
    msg: { label: (n) => `Envoie **${n}** messages`, min: 20, max: 50, reward: (n) => 6 * n },
    rc: { label: (n) => `Invoque **${n}** champions (\`rc\`)`, min: 3, max: 6, reward: (n) => 50 * n },
    duel_win: { label: () => 'Gagne **1** duel', min: 1, max: 1, reward: () => 350 },
    daily: { label: () => 'Récupère ton `daily`', min: 1, max: 1, reward: () => 120 },
};
const QUEST_BONUS = 750; // les 3 quetes finies -> coffre bonus
const QUESTS_PER_DAY = 3;

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // YYYY-MM-DD

/** RNG deterministe : memes quetes toute la journee pour une personne */
function seeded(str) {
    let h = 2166136261;
    for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => {
        h = Math.imul(h ^ (h >>> 15), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
}

async function ensureQuests(userId) {
    const day = today();
    const rows = await db.q('SELECT * FROM quests WHERE id_user = ? AND day = ?', [userId, day]);
    if (rows.length) return rows;
    const rnd = seeded(`${userId}:${day}`);
    const pool = Object.keys(QUESTS);
    const chosen = [];
    while (chosen.length < QUESTS_PER_DAY) {
        const k = pool[Math.floor(rnd() * pool.length)];
        if (!chosen.includes(k)) chosen.push(k);
    }
    for (const k of chosen) {
        const q = QUESTS[k];
        let n = q.min + Math.floor(rnd() * (q.max - q.min + 1));
        if (q.step) n *= q.step;
        await db.exec(
            'INSERT IGNORE INTO quests (id_user, day, qtype, target, progress, reward, done) VALUES (?, ?, ?, ?, 0, ?, 0)',
            [userId, day, k, n, q.reward(n)],
        );
    }
    return db.q('SELECT * FROM quests WHERE id_user = ? AND day = ?', [userId, day]);
}

async function progressQuests(userId, inc, notices) {
    const day = today();
    const types = Object.keys(inc).filter((k) => QUESTS[k] && inc[k] > 0);
    if (!types.length) return;
    await ensureQuests(userId);
    for (const t of types) {
        await db.exec(
            'UPDATE quests SET progress = LEAST(target, progress + ?) WHERE id_user = ? AND day = ? AND qtype = ? AND done = 0',
            [Math.trunc(inc[t]), userId, day, t],
        );
    }
    const finished = await db.q(
        'SELECT * FROM quests WHERE id_user = ? AND day = ? AND done = 0 AND progress >= target AND qtype != ?',
        [userId, day, '_bonus'],
    );
    for (const q of finished) {
        const res = await db.exec('UPDATE quests SET done = 1 WHERE id_user = ? AND day = ? AND qtype = ? AND done = 0', [userId, day, q.qtype]);
        if (!res.affectedRows) continue;
        const pay = await eco.addRb(userId, q.reward);
        notices.push(`📜 Quête terminée : ${QUESTS[q.qtype].label(q.target)} → **+${fmt(pay.net)}** ${RB()}${pay.cut ? ` · 🏦 -${fmt(pay.cut)}` : ''}`);
    }
    if (finished.length) {
        const [{ n }] = await db.q(`SELECT COUNT(*) AS n FROM quests WHERE id_user = ? AND day = ? AND done = 1 AND qtype != '_bonus'`, [userId, day]);
        if (Number(n) >= QUESTS_PER_DAY) {
            const res = await db.exec(
                `INSERT IGNORE INTO quests (id_user, day, qtype, target, progress, reward, done) VALUES (?, ?, '_bonus', 1, 1, ?, 1)`,
                [userId, day, QUEST_BONUS],
            );
            if (res.affectedRows) {
                const bonus = await eco.addRb(userId, QUEST_BONUS);
                await inv.add(userId, 'coffre_rare');
                notices.push(`🎁 **Les 3 quêtes du jour sont finies !** **+${fmt(bonus.net)}** ${RB()}${bonus.cut ? ` · 🏦 -${fmt(bonus.cut)}` : ''} + ${inv.label('coffre_rare')} (\`${config.prefix}ouvrir\`)`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Succes
// ---------------------------------------------------------------------------
// check(profile, meta, inc) -> true si debloque
const ACHIEVEMENTS = {
    first_win: { name: 'Première victoire', desc: 'Gagne ta première partie au casino', reward: 100, check: (p, m, i) => i.win > 0 },
    streak5: { name: 'En feu', desc: 'Gagne 5 parties de suite', reward: 500, check: (p) => p.winstreak >= 5 },
    streak10: { name: 'Intouchable', desc: 'Gagne 10 parties de suite', reward: 3000, check: (p) => p.winstreak >= 10 },
    high_roller: { name: 'High roller', desc: 'Mise 10 000 en un seul coup', reward: 1000, check: (p, m) => m.bet >= 10_000 },
    big_win: { name: 'Coup de maître', desc: 'Gagne 10 000 net en une partie', reward: 2000, check: (p, m) => m.net >= 10_000 },
    allin_win: { name: 'Tout ou rien', desc: 'Gagne un all-in', reward: 500, check: (p, m) => m.allin && m.net > 0 },
    broke: { name: 'Ruiné', desc: 'Perds tout sur un all-in', reward: 300, check: (p, m) => m.allin && m.net < 0 },
    jackpot: { name: 'JACKPOT 777', desc: 'Aligne 7️⃣7️⃣7️⃣ à la machine à sous', reward: 5000, check: (p, m) => m.jackpot },
    blackjack: { name: 'Blackjack !', desc: 'Fais un blackjack naturel', reward: 300, check: (p, m) => m.blackjack },
    rocket: { name: 'Fusée', desc: 'Encaisse à x10 ou plus au crash', reward: 1500, check: (p, m) => m.crashMult >= 10 },
    deminer: { name: 'Démineur', desc: 'Encaisse 10 cases ou plus aux mines', reward: 1500, check: (p, m) => m.minesPicks >= 10 },
    addict100: { name: 'Accro', desc: 'Joue 100 parties', reward: 1000, check: (p) => p.gamblecount >= 100 },
    addict1000: { name: 'Pilier du casino', desc: 'Joue 1 000 parties', reward: 10_000, check: (p) => p.gamblecount >= 1000 },
    rich100k: { name: 'Bourgeois', desc: 'Possède 100 000', reward: 2000, check: (p) => p.rb >= 100_000 },
    millionaire: { name: 'Millionnaire', desc: 'Possède 1 000 000', reward: 25_000, check: (p) => p.rb >= 1_000_000 },
    lvl10: { name: 'Niveau 10', desc: 'Atteins le niveau 10', reward: 1500, check: (p) => p.level >= 10 },
    lvl25: { name: 'Niveau 25', desc: 'Atteins le niveau 25', reward: 7500, check: (p) => p.level >= 25 },
    streak7: { name: 'Assidu', desc: 'Streak daily de 7 jours', reward: 700, check: (p) => p.daily_streak >= 7 },
    streak30: { name: 'Fidèle', desc: 'Streak daily de 30 jours', reward: 5000, check: (p) => p.daily_streak >= 30 },
    roknit: { name: 'Roknit !', desc: 'Trouve du roknit légendaire', reward: 1000, check: (p, m) => m.roknit },
    duelist: { name: 'Duelliste', desc: 'Gagne 10 duels', reward: 1000, check: (p) => p.duelwins >= 10 },
    collector: { name: 'Collectionneur', desc: 'Possède 10 champions', reward: 1000, check: (p, m) => m.champs >= 10 },
    lucky: { name: 'Chanceux', desc: 'Gagne la loterie', reward: 1000, check: (p, m) => m.lotoWin },
    quester: { name: 'Bosseur', desc: 'Finis toutes tes quêtes du jour', reward: 500, check: (p, m) => m.allQuests },
};

async function checkAchievements(userId, inc, meta, notices) {
    const owned = new Set((await db.q('SELECT ach FROM achievements WHERE id_user = ?', [userId])).map((r) => r.ach));
    if (owned.size >= Object.keys(ACHIEVEMENTS).length) return;
    const p = await db.getProfile(userId);
    for (const [key, a] of Object.entries(ACHIEVEMENTS)) {
        if (owned.has(key)) continue;
        let ok = false;
        try {
            ok = a.check(p, meta, inc);
        } catch {
            ok = false;
        }
        if (!ok) continue;
        const res = await db.exec('INSERT IGNORE INTO achievements (id_user, ach, at) VALUES (?, ?, ?)', [userId, key, Date.now()]);
        if (!res.affectedRows) continue;
        const pay = a.reward ? await eco.addRb(userId, a.reward) : null;
        notices.push(`🏆 Succès débloqué : **${a.name}** — *${a.desc}*${pay ? ` → **+${fmt(pay.net)}** ${RB()}${pay.cut ? ` · 🏦 -${fmt(pay.cut)}` : ''}` : ''}`);
    }
}

// ---------------------------------------------------------------------------
// XP
// ---------------------------------------------------------------------------
async function addXp(userId, amount, notices) {
    if (amount <= 0) return;
    await db.ensureProfile(userId);
    await db.exec('UPDATE profile SET xp = xp + ? WHERE id_user = ?', [Math.trunc(amount), userId]);
    const [row] = await db.q('SELECT xp, level FROM profile WHERE id_user = ?', [userId]);
    const info = levelInfo(row.xp);
    if (info.level > Number(row.level)) {
        const res = await db.exec('UPDATE profile SET level = ? WHERE id_user = ? AND level < ?', [info.level, userId, info.level]);
        if (!res.affectedRows) return;
        let reward = 0;
        for (let l = Number(row.level) + 1; l <= info.level; l++) reward += levelReward(l);
        const pay = await eco.addRb(userId, reward);
        // un coffre a chaque niveau, rare tous les 5, legendaire tous les 25
        const crate = info.level % 25 === 0 ? 'coffre_legend' : info.level % 5 === 0 ? 'coffre_rare' : 'coffre';
        await inv.add(userId, crate);
        notices.push(`⬆️ **NIVEAU ${info.level}** ! Récompense : **+${fmt(pay.net)}** ${RB()}${pay.cut ? ` · 🏦 -${fmt(pay.cut)}` : ''} + ${inv.label(crate)} (\`${config.prefix}ouvrir\`)`);
    }
}

// ---------------------------------------------------------------------------
// Point d'entree
// ---------------------------------------------------------------------------
/**
 * @param target ctx (ou { user, channel, displayName })
 * @param inc    increments : { play, win, wager, mine, work, msg, rc, link, duel_win, daily... }
 * @param meta   infos pour les succes : { bet, net, allin, jackpot, blackjack, crashMult, minesPicks, roknit, champs, lotoWin }
 */
async function track(target, inc = {}, meta = {}, { xpOverride = null, silent = false } = {}) {
    const userId = String(target.user.id);
    if (userId === config.casinoId) return;
    const notices = [];
    try {
        let xp = xpOverride ?? 0;
        if (xpOverride === null) for (const [k, v] of Object.entries(inc)) if (XP[k] && v > 0) xp += XP[k] * (k === 'wager' ? 0 : Math.min(v, 5));
        await addXp(userId, xp * (await boost.mult()), notices);
        const before = notices.length;
        await progressQuests(userId, inc, notices);
        if (notices.slice(before).some((n) => n.startsWith('🎁'))) meta.allQuests = true;
        await checkAchievements(userId, inc, meta, notices);
    } catch (e) {
        log.error('[progress]', e.message);
    }
    if (!notices.length || silent || !target.channel) return notices;
    const name = target.displayName || target.user.globalName || target.user.username;
    const embed = new EmbedBuilder()
        .setColor(notices.some((n) => n.startsWith('🏆')) ? COLORS.ach : notices.some((n) => n.startsWith('⬆️')) ? COLORS.level : COLORS.quest)
        .setAuthor({ name, iconURL: avatar(target.user) })
        .setDescription(notices.join('\n'));
    await target.channel.send({ embeds: [embed] }).catch(() => {});
    return notices;
}

/** Met a jour la serie de victoires (pour les succes "En feu"...) */
async function streak(userId, won) {
    if (won) {
        // l'ordre compte : MySQL evalue les SET de gauche a droite avec les nouvelles valeurs
        await db.exec('UPDATE profile SET bestwinstreak = GREATEST(bestwinstreak, winstreak + 1), winstreak = winstreak + 1 WHERE id_user = ?', [userId]);
    } else {
        await db.exec('UPDATE profile SET winstreak = 0 WHERE id_user = ?', [userId]);
    }
}

module.exports = { track, streak, levelInfo, ensureQuests, QUESTS, QUEST_BONUS, ACHIEVEMENTS, today, bar };
