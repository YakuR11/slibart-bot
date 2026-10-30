// La "vie" dans l'app : carte du quartier et fiches profil. (Le work se fait par les commandes =w =gw =m.)
const config = require('../config');
const db = require('../db');
const progress = require('../lib/progress');
const skins = require('../lib/skins');
const { fmt } = require('../lib/utils');

// ===========================================================================
// CARTE : un petit quartier, 20 maisons, pas une par membre
// ===========================================================================
const STREETS = [
    { name: 'Avenue 16 ans et 10 mois', a: [60, 150], b: [940, 150] },
    { name: 'Rue Karl Marx', a: [60, 330], b: [940, 330] },
    { name: 'Boulevard Boris', a: [60, 510], b: [940, 510] },
    { name: 'Avenue LAMINE', a: [250, 60], b: [250, 640] },
    { name: 'Rue Ostiax', a: [500, 60], b: [500, 640] },
    { name: 'Rue Rebbeca-lover', a: [750, 60], b: [750, 640] },
    { name: 'Avenue Kaqaman', a: [60, 60], b: [60, 640] },
    { name: 'Impasse du Slip', a: [940, 60], b: [940, 640] },
];
// emplacements des maisons (dans les blocs entre les rues), monde 1000 x 700 : 4 rangees x 5 = 20
const PLOTS = [];
for (const y of [100, 245, 425, 600]) {
    for (const x of [155, 325, 425, 625, 845]) PLOTS.push({ x, y });
}

/** rue la plus proche d'une maison (pour l'adresse) */
function streetOf(plot) {
    let best = null;
    let bd = Infinity;
    for (const st of STREETS) {
        const horiz = st.a[1] === st.b[1];
        const d = horiz ? Math.abs(plot.y - st.a[1]) : Math.abs(plot.x - st.a[0]);
        if (d < bd) { bd = d; best = st; }
    }
    return best?.name || null;
}

async function assignHouse(userId) {
    const [have] = await db.q('SELECT plot FROM map_houses WHERE id_user = ?', [String(userId)]);
    if (have) return Number(have.plot);
    const taken = new Set((await db.q('SELECT plot FROM map_houses')).map((r) => Number(r.plot)));
    const free = PLOTS.map((_, i) => i).filter((i) => !taken.has(i));
    if (!free.length) return null;
    const plot = free[Math.floor(Math.random() * free.length)];
    const res = await db.exec('INSERT IGNORE INTO map_houses (plot, id_user, at) VALUES (?, ?, ?)', [plot, String(userId), Date.now()]);
    return res.affectedRows ? plot : assignHouse(userId);
}

/** =initmap : donne une maison a tous les membres connus, dans un ordre au hasard (une seule fois) */
async function initMap(userIds) {
    const shuffled = [...userIds].sort(() => Math.random() - 0.5);
    let n = 0;
    for (const id of shuffled) if ((await assignHouse(id)) !== null) n++;
    return n;
}

async function mapData(userInfo) {
    const rows = await db.q(
        'SELECT h.plot, h.id_user, p.rb, p.cavecount, p.slavecount FROM map_houses h JOIN profile p ON p.id_user = h.id_user',
    );
    const houses = [];
    for (const r of rows) {
        const plot = PLOTS[Number(r.plot)];
        if (!plot) continue;
        const u = await userInfo(String(r.id_user));
        houses.push({
            id: String(r.id_user), plot: Number(r.plot), x: plot.x, y: plot.y,
            name: u.name, avatar: u.avatar, skins: await skins.equipped(r.id_user),
            rb: Number(r.rb), caves: Number(r.cavecount), slaves: Number(r.slavecount), street: streetOf(plot),
        });
    }
    return { w: 1000, h: 700, streets: STREETS, plots: PLOTS.length, plotsXY: PLOTS.map((p, i) => ({ ...p, i })), houses };
}

// ===========================================================================
// PROFIL
// ===========================================================================
async function profileData(userId, userInfo) {
    const id = String(userId);
    const p = await db.getProfile(id);
    const [{ pos }] = await db.q('SELECT COUNT(*) + 1 AS pos FROM profile WHERE rb > ? AND id_user != ?', [p.rb, config.casinoId]);
    const [{ champs }] = await db.q('SELECT COUNT(*) AS champs FROM champions WHERE belong = ?', [id]);
    const [{ achs }] = await db.q('SELECT COUNT(*) AS achs FROM achievements WHERE id_user = ?', [id]);
    const badges = (await require('../commands/profile').badgesFor(p)).map((b) => b.replace(/\*\*/g, ''));
    const lvl = progress.levelInfo(p.xp);
    const u = await userInfo(id);
    const [house] = await db.q('SELECT plot FROM map_houses WHERE id_user = ?', [id]);
    const best = await db.q('SELECT game, net FROM gamble_log WHERE id_user = ? ORDER BY net DESC LIMIT 1', [id]);
    return {
        id,
        name: u.name,
        avatar: u.avatar,
        skins: await skins.equipped(id),
        title: p.acc || null,
        bio: p.bio || null,
        image: `pimg/${id}?v=${encodeURIComponent((p.img || 'd').slice(-24))}`,
        rb: Number(p.rb),
        rank: Number(pos),
        level: lvl.level, xp: lvl.cur, xpNeed: lvl.need,
        achievements: Number(achs), achievementsTotal: Object.keys(progress.ACHIEVEMENTS).length,
        badges,
        stats: {
            rolls: Number(p.wacount), insults: Number(p.insultcount), mined: Number(p.minecount),
            games: Number(p.gamblecount), won: Number(p.wincount), lost: Number(p.pertecount), maxwin: Number(p.maxwin || 0),
            caves: Number(p.cavecount), slaves: Number(p.slavecount), champions: Number(champs),
            streak: Number(p.daily_streak || 0), duels: Number(p.duelwins || 0), debt: Number(p.debt || 0),
        },
        bestApp: best[0] ? { game: best[0].game, net: Number(best[0].net) } : null,
        street: house && PLOTS[Number(house.plot)] ? streetOf(PLOTS[Number(house.plot)]) : null,
    };
}

/** URL de l'image de profil (=set img), pour le relais d'images */
async function profileImageUrl(userId) {
    const p = await db.getProfile(String(userId));
    return p.img || config.content.defaultProfileImage || null;
}

module.exports = { assignHouse, initMap, mapData, profileData, profileImageUrl, STREETS, PLOTS, fmt };
