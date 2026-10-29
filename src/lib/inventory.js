// Inventaire : coffres, cadenas...
const db = require('../db');

const ITEMS = {
    coffre: { name: 'Coffre commun', emoji: '📦', rarity: 1 },
    coffre_rare: { name: 'Coffre rare', emoji: '🎁', rarity: 2 },
    coffre_legend: { name: 'Coffre légendaire', emoji: '👑', rarity: 3 },
    cadenas: { name: 'Cadenas', emoji: '🔒', rarity: 0 },
};

async function add(userId, item, qty = 1, conn = db.pool) {
    await conn.query(
        'INSERT INTO inventory (id_user, item, qty) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)',
        [String(userId), item, qty],
    );
}

/** retire 1 objet si dispo -> true/false (atomique) */
async function take(userId, item, qty = 1, conn = db.pool) {
    const [res] = await conn.query('UPDATE inventory SET qty = qty - ? WHERE id_user = ? AND item = ? AND qty >= ?', [qty, String(userId), item, qty]);
    return res.affectedRows > 0;
}

async function list(userId) {
    const rows = await db.q('SELECT item, qty FROM inventory WHERE id_user = ? AND qty > 0', [String(userId)]);
    return Object.fromEntries(rows.map((r) => [r.item, Number(r.qty)]));
}

function label(item, qty = 1) {
    if (String(item).startsWith('skin:')) {
        const { SKINS, RARITIES } = require('./skins-catalog');
        const s = SKINS[item.slice(5)];
        if (s) return `🎨 **${s.name}** (${RARITIES[s.rarity].label})`;
    }
    return `${ITEMS[item]?.emoji || '❔'} ${qty > 1 ? `${qty}x ` : ''}**${ITEMS[item]?.name || item}**`;
}

module.exports = { ITEMS, add, take, list, label };
