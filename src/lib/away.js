// Journal d'absence : ce que le contremaitre a ramasse et ce que l'entretien a pris
// depuis ta derniere ouverture de l'app. Aucun argent cree ici, on ne fait que compter.
const db = require('../db');

async function add(userId, { foreman = 0, upkeep = 0 }) {
    await db.exec(
        `INSERT INTO away_log (id_user, foreman, upkeep, seen_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE foreman = foreman + VALUES(foreman), upkeep = upkeep + VALUES(upkeep)`,
        [String(userId), Math.trunc(foreman), Math.trunc(upkeep), Date.now()],
    );
}

/** lit et remet a zero ; renvoie aussi depuis quand */
async function take(userId) {
    const id = String(userId);
    return db.tx(async (conn) => {
        const [[row]] = await conn.query('SELECT foreman, upkeep, seen_at FROM away_log WHERE id_user = ? FOR UPDATE', [id]);
        const now = Date.now();
        await conn.query(
            `INSERT INTO away_log (id_user, foreman, upkeep, seen_at) VALUES (?, 0, 0, ?)
             ON DUPLICATE KEY UPDATE foreman = 0, upkeep = 0, seen_at = VALUES(seen_at)`,
            [id, now],
        );
        return { foreman: Number(row?.foreman || 0), upkeep: Number(row?.upkeep || 0), since: Number(row?.seen_at || 0) };
    });
}

module.exports = { add, take };
