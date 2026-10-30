// La "vie" dans l'app : page Work (clics limites par le nombre d'esclaves), carte du quartier,
// fiches profil.
const config = require('../config');
const db = require('../db');
const eco = require('../lib/economy');
const boost = require('../lib/boost');
const inv = require('../lib/inventory');
const progress = require('../lib/progress');
const skins = require('../lib/skins');
const { fmt } = require('../lib/utils');

// ===========================================================================
// WORK : n clics par minute et par bouton (n = nombre d'esclaves, 1 minimum).
// Un clic = une petite part d'un vrai =work : en cliquant sans arret pendant 30 min
// on gagne a peu pres un =work (ou un =gw, ou une minute de =mine).
// ===========================================================================
const WORK_BASE = 50;
const WORK_PER_SLAVE = 25;
const WINDOW = 60_000;
const clicks = new Map(); // `${id}:${kind}` -> [timestamps]

/** arrondi aleatoire : 2,3 -> 2 (70 %) ou 3 (30 %), l'esperance reste juste */
const sround = (x) => Math.floor(x) + (Math.random() < x - Math.floor(x) ? 1 : 0);
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function recent(id, kind) {
    const k = `${id}:${kind}`;
    const now = Date.now();
    const list = (clicks.get(k) || []).filter((t) => now - t < WINDOW);
    clicks.set(k, list);
    return list;
}

async function workState(id) {
    const p = await db.getProfile(id);
    const n = Math.max(1, p.slavecount);
    const out = { n, slaves: p.slavecount, kinds: {} };
    for (const kind of ['work', 'gw', 'mine']) {
        const list = recent(id, kind);
        out.kinds[kind] = { left: Math.max(0, n - list.length), next: list.length >= n ? list[0] + WINDOW : 0 };
    }
    return out;
}

async function workClick(player, kind) {
    if (!['work', 'gw', 'mine'].includes(kind)) return { error: 'Action inconnue.' };
    const id = player.id;
    const p = await db.getProfile(id);
    const n = Math.max(1, p.slavecount);
    const list = recent(id, kind);
    if (list.length >= n) return { error: 'Repose-toi un peu…', next: list[0] + WINDOW, ...(await workState(id)) };
    list.push(Date.now());
    const m = await boost.mult();
    let gain = 0;
    let what = null;
    let chest = false;
    if (kind === 'work') {
        gain = sround(((WORK_BASE + WORK_PER_SLAVE * p.slavecount) * m) / (30 * n));
    } else if (kind === 'gw') {
        gain = sround((randInt(25, 100) * m) / (30 * n));
    } else {
        // memes chances que =mine, gains divises par n (n clics par minute au lieu d'un)
        const r = Math.random() * 1000;
        let g;
        if (r < 1) { g = 1000; what = 'roknit'; }
        else if (r < 11) { g = 100; what = 'diamant'; }
        else if (r < 61) { g = randInt(10, 25); what = 'or'; }
        else { g = randInt(1, 5); what = 'pierre'; }
        gain = sround((g * m) / n);
        if (Math.random() < 1 / (40 * n)) {
            chest = true;
            await inv.add(id, 'coffre');
        }
        if (gain) await eco.bump(id, { minecount: gain });
        if (what === 'roknit') progress.track({ user: { id }, channel: null }, {}, { roknit: true }).catch(() => {});
    }
    const pay = gain ? await eco.addRb(id, gain) : { net: 0, cut: 0 };
    return { ok: true, kind, gain: pay.net, cut: pay.cut, what, chest, balance: await eco.balance(id), ...(await workState(id)) };
}

// ===========================================================================
// CARTE : un petit quartier, une maison fixe par membre (20 places)
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
    return { w: 1000, h: 700, streets: STREETS, plots: PLOTS.length, houses };
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

module.exports = { workState, workClick, assignHouse, initMap, mapData, profileData, profileImageUrl, STREETS, PLOTS, fmt };
