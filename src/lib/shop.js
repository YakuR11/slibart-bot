// Magasin du tycoon : prix et achats, partages par les commandes (=buy) et l'app (page Empire).
// Un seul endroit pour les prix : le chat et l'app affichent toujours la meme chose.
const db = require('../db');
const eco = require('./economy');
const cd = require('./cooldowns');
const inv = require('./inventory');
const wages = require('./wages');

// Prix exponentiels : chaque achat coute plus cher que le precedent, pas de limite.
// esclave n°1 = 90, n°11 = 364, n°21 = 1 473, n°31 = 5 959, n°41 = 24 108...
// cave n°1 = 300, n°3 = 867, n°5 = 2 506, n°8 = 12 310, n°10 = 35 576...
const SLAVE_BASE = 90;
const SLAVE_GROWTH = 1.15; // +15% par esclave que tu possedes deja
const SLAVE_INFLATION = 1; // +1 RB par esclave existant sur tout le serveur
const SLAVES_PER_CAVE = 5;
const CAVE_BASE = 300;
const CAVE_GROWTH = 1.7; // +70% par cave que tu possedes deja
const CAVE_CD = 90 * 60 * 1000;
const BULK_MAX = 50; // max d'esclaves achetes en une fois
const LOCK_PRICE = 600;
const LOCK_MAX = 10;

const slaveUnit = (owned, server) => Math.round(SLAVE_BASE * SLAVE_GROWTH ** owned + SLAVE_INFLATION * server);
const cavePrice = (owned) => Math.round(CAVE_BASE * CAVE_GROWTH ** owned);
/** cout de qty esclaves quand on en a deja owned (chaque unite plus chere) */
function slaveCost(owned, qty, server) {
    let c = 0;
    for (let k = 0; k < qty; k++) c += slaveUnit(owned + k, server + k);
    return c;
}

const serverSlaves = async (conn = db.pool) => {
    const [[{ total }]] = await conn.query('SELECT COALESCE(SUM(slavecount), 0) AS total FROM profile');
    return Number(total);
};

/** quantite = nombre, ou 'max' (autant que possible dans la place et le budget) */
async function buySlaves(userId, quantite) {
    const id = String(userId);
    return db.tx(async (conn) => {
        await db.ensureProfile(id, conn);
        const [[p]] = await conn.query('SELECT rb, slavecount, cavecount FROM profile WHERE id_user = ? FOR UPDATE', [id]);
        const server = await serverSlaves(conn);
        const rb = Number(p.rb);
        const owned = Number(p.slavecount);
        const room = Number(p.cavecount) * SLAVES_PER_CAVE - owned;
        if (room <= 0) return { err: 'room', cave: cavePrice(Number(p.cavecount)) };
        let qty;
        if (['max', 'all'].includes(String(quantite).toLowerCase())) {
            qty = 0;
            while (qty < Math.min(room, BULK_MAX) && slaveCost(owned, qty + 1, server) <= rb) qty++;
        } else qty = quantite === undefined || quantite === null ? 1 : parseInt(quantite, 10);
        const first = slaveUnit(owned, server);
        if (!qty || qty < 0 || Number.isNaN(qty)) return { err: rb < first ? 'broke' : 'qty', need: first, rb };
        if (qty > BULK_MAX) return { err: 'bulk' };
        if (qty > room) return { err: 'roomfor', room };
        const cost = slaveCost(owned, qty, server);
        if (rb < cost) return { err: 'broke', need: cost, rb, qty };
        await conn.query('UPDATE profile SET rb = rb - ?, slavecount = slavecount + ? WHERE id_user = ?', [cost, qty, id]);
        return { qty, cost, total: owned + qty, next: slaveUnit(owned + qty, server + qty) };
    });
}

async function buyCave(userId) {
    const id = String(userId);
    const left = await cd.remaining(id, 'cave');
    if (left) return { err: 'cd', until: Date.now() + left };
    const res = await db.tx(async (conn) => {
        await db.ensureProfile(id, conn);
        const [[p]] = await conn.query('SELECT rb, cavecount FROM profile WHERE id_user = ? FOR UPDATE', [id]);
        const price = cavePrice(Number(p.cavecount));
        if (Number(p.rb) < price) return { err: 'broke', need: price, rb: Number(p.rb), n: Number(p.cavecount) + 1 };
        await conn.query('UPDATE profile SET rb = rb - ?, cavecount = cavecount + 1 WHERE id_user = ?', [price, id]);
        return { total: Number(p.cavecount) + 1, price };
    });
    if (!res.err) await cd.set(id, 'cave', CAVE_CD);
    return res;
}

async function buyForeman(userId) {
    const id = String(userId);
    return db.tx(async (conn) => {
        await db.ensureProfile(id, conn);
        const [[p]] = await conn.query('SELECT rb, foreman, slavecount FROM profile WHERE id_user = ? FOR UPDATE', [id]);
        if (Number(p.foreman)) return { err: 'owned' };
        const price = wages.FOREMAN_PRICE;
        if (Number(p.rb) < price) return { err: 'broke', need: price, rb: Number(p.rb) };
        const [upd] = await conn.query('UPDATE profile SET rb = rb - ?, foreman = 1 WHERE id_user = ? AND foreman = 0 AND rb >= ?', [price, id, price]);
        if (!upd.affectedRows) return { err: 'retry' };
        return { price, offer: wages.foremanOffer(p.slavecount) };
    });
}

async function buyLocks(userId, quantite) {
    const id = String(userId);
    const qty = Math.min(LOCK_MAX, Math.max(1, parseInt(quantite, 10) || 1));
    const have = (await inv.list(id)).cadenas || 0;
    if (have + qty > LOCK_MAX) return { err: 'max', have };
    if (!(await eco.takeRb(id, qty * LOCK_PRICE))) return { err: 'broke', need: qty * LOCK_PRICE };
    await inv.add(id, 'cadenas', qty);
    return { qty, have: have + qty, cost: qty * LOCK_PRICE };
}

module.exports = {
    SLAVE_BASE, SLAVE_GROWTH, SLAVE_INFLATION, SLAVES_PER_CAVE, CAVE_BASE, CAVE_GROWTH, CAVE_CD, BULK_MAX, LOCK_PRICE, LOCK_MAX,
    slaveUnit, cavePrice, slaveCost, serverSlaves, buySlaves, buyCave, buyForeman, buyLocks,
};
