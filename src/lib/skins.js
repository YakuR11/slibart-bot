// Cadres d'avatar et GIF perso : possession (inventaire, objets "skin:..." / "perk:gif"),
// achat, equipement, drops des coffres, et remboursement des anciens skins (billes, tables...).
const db = require('../db');
const eco = require('./economy');
const log = require('./logger');
const { SLOTS, SKINS, DEFAULTS, PRICE, GIF_PRICE, price } = require('./skins-catalog');

const isSkin = (item) => typeof item === 'string' && item.startsWith('skin:');
const itemOf = (id) => `skin:${id}`;

async function owned(userId) {
    const rows = await db.q("SELECT item FROM inventory WHERE id_user = ? AND qty > 0 AND item LIKE 'skin:%'", [String(userId)]);
    const set = new Set(Object.values(DEFAULTS));
    for (const r of rows) {
        const id = r.item.slice(5);
        if (SKINS[id]) set.add(id);
    }
    return set;
}

async function equipped(userId) {
    const rows = await db.q('SELECT slot, skin FROM skin_equip WHERE id_user = ?', [String(userId)]);
    const out = { ...DEFAULTS };
    for (const r of rows) if (SKINS[r.skin]?.slot === r.slot) out[r.slot] = r.skin;
    return out;
}

/** Achat : debit atomique, l'argent part a la banque du slip. */
async function buy(userId, id) {
    if (id === 'perk:gif') return buyGif(userId);
    const p = price(id);
    if (!SKINS[id]) return { error: 'Cadre inconnu.' };
    if (p === null) return { error: SKINS[id].chest ? 'Ce cadre ne se trouve que dans les coffres 🎁' : 'Ce cadre est gratuit.' };
    return db.tx(async (conn) => {
        const [have] = await conn.query('SELECT qty FROM inventory WHERE id_user = ? AND item = ? FOR UPDATE', [String(userId), itemOf(id)]);
        if (Number(have[0]?.qty) > 0) return { error: 'Tu l\'as déjà.' };
        if (!(await eco.takeRb(userId, p, conn))) return { error: 'Pas assez de Rokbux.' };
        await conn.query('INSERT INTO inventory (id_user, item, qty) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE qty = 1', [String(userId), itemOf(id)]);
        await eco.toCasino(p, conn);
        return { ok: true, price: p };
    });
}

async function equip(userId, id) {
    const s = SKINS[id];
    if (!s) return { error: 'Cadre inconnu.' };
    if (!(await owned(userId)).has(id)) return { error: 'Tu ne l\'as pas encore.' };
    await db.exec(
        'INSERT INTO skin_equip (id_user, slot, skin) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE skin = VALUES(skin)',
        [String(userId), s.slot, id],
    );
    return { ok: true, equipped: await equipped(userId) };
}

/** Drop de coffre : un cadre pas encore possede (les "coffre uniquement" 2x plus souvent). null si tout possede. */
async function fromChest(userId) {
    const have = await owned(userId);
    const pool = [];
    for (const [id, s] of Object.entries(SKINS)) {
        if (s.default || have.has(id)) continue;
        for (let i = 0; i < (s.chest ? 2 : 1); i++) pool.push(id);
    }
    if (!pool.length) return null;
    const id = pool[Math.floor(Math.random() * pool.length)];
    await db.exec('INSERT INTO inventory (id_user, item, qty) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE qty = 1', [String(userId), itemOf(id)]);
    return id;
}

const label = (id) => (SKINS[id] ? `🖼️ Cadre **${SKINS[id].name}**` : id);

// ---------------------------------------------------------------------------
// GIF perso : achete une fois (1000), le lien se change quand on veut
// ---------------------------------------------------------------------------
const hasGif = async (userId) => (await db.q("SELECT 1 FROM inventory WHERE id_user = ? AND item = 'perk:gif' AND qty > 0", [String(userId)])).length > 0;

async function buyGif(userId) {
    return db.tx(async (conn) => {
        const [have] = await conn.query("SELECT qty FROM inventory WHERE id_user = ? AND item = 'perk:gif' FOR UPDATE", [String(userId)]);
        if (Number(have[0]?.qty) > 0) return { error: 'Tu l\'as déjà.' };
        if (!(await eco.takeRb(userId, GIF_PRICE, conn))) return { error: 'Pas assez de Rokbux.' };
        await conn.query("INSERT INTO inventory (id_user, item, qty) VALUES (?, 'perk:gif', 1) ON DUPLICATE KEY UPDATE qty = 1", [String(userId)]);
        await eco.toCasino(GIF_PRICE, conn);
        return { ok: true, price: GIF_PRICE };
    });
}

/**
 * Lien de GIF accepte : GIPHY uniquement (Tenor bloque le chargement de ses GIF hors de son site).
 * Fichier direct (media*.giphy.com / i.giphy.com) ou page giphy.com/gifs/... (convertie).
 */
function normalizeGif(raw) {
    let url;
    try { url = new URL(String(raw).trim()); } catch { return null; }
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (/^(i|media\d*)\.giphy\.com$/.test(host) && /\.(gif|webp)$/i.test(url.pathname)) return url.href;
    const page = host.endsWith('giphy.com') && url.pathname.match(/^\/gifs\/(?:.*-)?([A-Za-z0-9]{8,})\/?$/);
    if (page) return `https://i.giphy.com/media/${page[1]}/giphy.gif`;
    return null;
}

async function setGif(userId, raw) {
    if (!(await hasGif(userId))) return { error: 'Achète d\'abord le GIF perso dans la boutique.' };
    if (!raw) {
        await db.setSetting(`gif:${userId}`, '');
        return { ok: true, url: null };
    }
    const url = normalizeGif(raw);
    if (!url) {
        const tenor = /tenor\.com/i.test(String(raw));
        return { error: tenor
            ? 'Les liens Tenor ne marchent pas : prends ton GIF sur giphy.com et colle son lien.'
            : 'Colle un lien GIPHY (giphy.com/gifs/… ou media.giphy.com/…/giphy.gif).' };
    }
    await db.setSetting(`gif:${userId}`, url);
    return { ok: true, url };
}

async function gifOf(userId) {
    if (!(await hasGif(userId))) return null;
    // les anciens liens Tenor enregistres ne s'affichent pas : on fait comme s'il n'y avait pas de GIF
    return normalizeGif((await db.getSetting(`gif:${userId}`)) || '') || null;
}

// ---------------------------------------------------------------------------
// Une seule fois : les skins de billes / traînées / tables disparaissent (remboursés au prix paye),
// les anciens cadres plus chers que 500 sont rembourses de la difference.
// ---------------------------------------------------------------------------
const OLD_PRICES = {
    'ball:rubis': 2500, 'ball:emeraude': 2500, 'ball:saphir': 2500, 'ball:neon-rose': 10000, 'ball:neon-cyan': 10000,
    'ball:lave': 40000, 'ball:galaxie': 40000, 'ball:disco': 150000,
    'trail:etincelles': 10000, 'trail:feu': 10000, 'trail:arc': 40000, 'trail:comete': 150000,
    'board:nuit': 2500, 'board:velours': 10000, 'board:neon': 40000, 'board:or': 150000,
    'frame:laiton': 2500, 'frame:argent': 2500, 'frame:neon': 10000, 'frame:flammes': 40000, 'frame:couronne': 150000,
};

async function migrateV2() {
    if ((await db.getSetting('skins_v2')) === 'done') return;
    const rows = await db.q("SELECT id_user, item FROM inventory WHERE item LIKE 'skin:%' AND qty > 0");
    const refunds = new Map();
    for (const r of rows) {
        const id = r.item.slice(5);
        const old = OLD_PRICES[id] || 0;
        const isFrame = id.startsWith('frame:');
        const back = isFrame ? Math.max(0, old - PRICE) : old;
        if (back) refunds.set(r.id_user, (refunds.get(r.id_user) || 0) + back);
        if (!isFrame || !SKINS[id]) await db.exec('DELETE FROM inventory WHERE id_user = ? AND item = ?', [r.id_user, r.item]);
    }
    await db.exec("DELETE FROM skin_equip WHERE slot <> 'frame'");
    for (const [uid, n] of refunds) {
        await eco.addRb(uid, n, undefined, { raw: true });
        log.info(`[skins] remboursement ${uid} : ${n}`);
    }
    await db.setSetting('skins_v2', 'done');
}

module.exports = {
    owned, equipped, buy, equip, fromChest, label, isSkin, hasGif, setGif, gifOf, normalizeGif, migrateV2,
    SKINS, SLOTS, DEFAULTS, PRICE, GIF_PRICE, price,
};
