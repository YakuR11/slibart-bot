// La "vie" dans l'app : carte du quartier et fiches profil. (Le work se fait par les commandes =w =gw =m.)
const config = require('../config');
const db = require('../db');
const progress = require('../lib/progress');
const skins = require('../lib/skins');
const { fmt } = require('../lib/utils');

// ===========================================================================
// CARTE : un quartier de 48 maisons (8 x 6), pas une par membre
// ===========================================================================
// monde 1500 x 1060. Le quartier d'origine (20 maisons) est le coin haut gauche : ses maisons
// n'ont pas bouge, on a prolonge les rues et ajoute deux rues vers l'est et deux vers le sud.
const WORLD = { w: 1500, h: 1060 };
const X0 = 60;
const X1 = 1440;
const Y0 = 60;
const Y1 = 1000;
const STREETS = [
    { name: 'Avenue 16 ans et 10 mois', a: [X0, 150], b: [X1, 150] },
    { name: 'Rue Karl Marx', a: [X0, 330], b: [X1, 330] },
    { name: 'Boulevard Boris', a: [X0, 510], b: [X1, 510] },
    { name: 'Avenue LAMINE', a: [250, Y0], b: [250, Y1] },
    { name: 'Rue Ostiax', a: [500, Y0], b: [500, Y1] },
    { name: 'Rue Rebbeca-lover', a: [750, Y0], b: [750, Y1] },
    { name: 'Avenue Kaqaman', a: [X0, Y0], b: [X0, Y1] },
    { name: 'Impasse du Slip', a: [940, Y0], b: [940, Y1] },
    // extension
    { name: 'Rue du Slip Propre', a: [X0, 690], b: [X1, 690] },
    { name: 'Boulevard du Tapis', a: [X0, 870], b: [X1, 870] },
    { name: 'Avenue du Plinko', a: [1190, Y0], b: [1190, Y1] },
    { name: 'Allée des Pluies', a: [X1, Y0], b: [X1, Y1] },
];
// emplacements des maisons, dans les blocs entre les rues. Les 20 premiers gardent leur numero
// (ce sont eux qui sont en base), les nouveaux viennent apres.
const OLD_X = [155, 325, 425, 625, 845];
const OLD_Y = [100, 245, 425, 600];
const ALL_X = [...OLD_X, 1015, 1115, 1315];
const ALL_Y = [...OLD_Y, 780, 960];
const PLOTS = [];
for (const y of OLD_Y) for (const x of OLD_X) PLOTS.push({ x, y });
for (const y of ALL_Y) for (const x of ALL_X) if (!(OLD_Y.includes(y) && OLD_X.includes(x))) PLOTS.push({ x, y });

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
        'SELECT h.plot, h.id_user, p.rb, p.cavecount, p.slavecount, p.prestige FROM map_houses h JOIN profile p ON p.id_user = h.id_user',
    );
    const houses = [];
    for (const r of rows) {
        const plot = PLOTS[Number(r.plot)];
        if (!plot) continue;
        const u = await userInfo(String(r.id_user));
        houses.push({
            id: String(r.id_user), plot: Number(r.plot), x: plot.x, y: plot.y,
            name: u.name, avatar: u.avatar, skins: await skins.equipped(r.id_user),
            rb: Number(r.rb), caves: Number(r.cavecount), slaves: Number(r.slavecount), prestige: Number(r.prestige || 0), street: streetOf(plot),
        });
    }
    return { w: WORLD.w, h: WORLD.h, streets: STREETS, plots: PLOTS.length, plotsXY: PLOTS.map((p, i) => ({ ...p, i })), houses };
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

module.exports = { assignHouse, initMap, mapData, profileData, profileImageUrl, STREETS, PLOTS, fmt, PLOTS };
