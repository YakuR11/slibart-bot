// Skins : possession (dans l'inventaire, objets "skin:..."), achat, equipement, drops des coffres.
const db = require('../db');
const eco = require('./economy');
const { RARITIES, SLOTS, SKINS, DEFAULTS, price } = require('./skins-catalog');

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
    const p = price(id);
    if (!SKINS[id]) return { error: 'Skin inconnu.' };
    if (p === null) return { error: SKINS[id].chest ? 'Ce skin ne se trouve que dans les coffres 🎁' : 'Ce skin est gratuit.' };
    return db.tx(async (conn) => {
        const [have] = await conn.query('SELECT qty FROM inventory WHERE id_user = ? AND item = ? FOR UPDATE', [String(userId), itemOf(id)]);
        if (Number(have[0]?.qty) > 0) return { error: 'Tu l\'as déjà.' };
        if (!(await eco.takeRb(userId, p, conn))) return { error: 'Pas assez de Rokbux.' };
        await conn.query(
            'INSERT INTO inventory (id_user, item, qty) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE qty = 1',
            [String(userId), itemOf(id)],
        );
        await eco.toCasino(p, conn);
        return { ok: true, price: p };
    });
}

async function equip(userId, id) {
    const s = SKINS[id];
    if (!s) return { error: 'Skin inconnu.' };
    if (!(await owned(userId)).has(id)) return { error: 'Tu ne l\'as pas encore.' };
    await db.exec(
        'INSERT INTO skin_equip (id_user, slot, skin) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE skin = VALUES(skin)',
        [String(userId), s.slot, id],
    );
    return { ok: true, equipped: await equipped(userId) };
}

/**
 * Drop de coffre : un skin pas encore possede, de rarete entre min et max.
 * Les skins "coffre uniquement" ont 2x plus de chances de tomber.
 * Retourne l'id du skin, ou null si le joueur a deja tout dans ces raretes.
 */
async function fromChest(userId, minRarity, maxRarity) {
    const have = await owned(userId);
    const lo = RARITIES[minRarity].rank;
    const hi = RARITIES[maxRarity].rank;
    const pool = [];
    for (const [id, s] of Object.entries(SKINS)) {
        if (s.default || have.has(id)) continue;
        const r = RARITIES[s.rarity].rank;
        if (r < lo || r > hi) continue;
        // les plus rares tombent moins souvent
        const w = (s.chest ? 2 : 1) * (r === hi && hi > lo ? 1 : 3);
        for (let i = 0; i < w; i++) pool.push(id);
    }
    if (!pool.length) return null;
    const id = pool[Math.floor(Math.random() * pool.length)];
    await db.exec(
        'INSERT INTO inventory (id_user, item, qty) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE qty = 1',
        [String(userId), itemOf(id)],
    );
    return id;
}

const label = (id) => {
    const s = SKINS[id];
    return s ? `🎨 **${s.name}** (${SLOTS[s.slot].label.replace(/s$/, '').toLowerCase()} ${RARITIES[s.rarity].label.toLowerCase()})` : id;
};

module.exports = { owned, equipped, buy, equip, fromChest, label, isSkin, SKINS, RARITIES, SLOTS, DEFAULTS, price };
