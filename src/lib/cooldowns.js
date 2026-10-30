// Cooldowns stockes en base : ils survivent a un redemarrage du bot
// (avant, un restart remettait tout le monde a zero -> farm infini de =work).
const db = require('../db');

/** ms restantes avant de pouvoir refaire l'action (0 = dispo) */
async function remaining(userId, name) {
    const rows = await db.q('SELECT expires_at FROM cooldowns WHERE id_user = ? AND name = ?', [String(userId), name]);
    const left = Number(rows[0]?.expires_at || 0) - Date.now();
    return left > 0 ? left : 0;
}

async function setUntil(userId, name, timestamp) {
    await db.exec(
        `INSERT INTO cooldowns (id_user, name, expires_at, uses) VALUES (?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
        [String(userId), name, Math.trunc(timestamp)],
    );
}

const set = (userId, name, ms) => setUntil(userId, name, Date.now() + ms);

/**
 * Verifie + pose le cooldown en une seule requete atomique.
 * Retourne 0 si l'action est autorisee (cooldown pose), sinon les ms restantes.
 */
async function take(userId, name, msOrUntil, { absolute = false } = {}) {
    const now = Date.now();
    const until = absolute ? msOrUntil : now + msOrUntil;
    return db.tx(async (conn) => {
        const [rows] = await conn.query(
            'SELECT expires_at FROM cooldowns WHERE id_user = ? AND name = ? FOR UPDATE',
            [String(userId), name],
        );
        const left = Number(rows[0]?.expires_at || 0) - now;
        if (left > 0) return left;
        await conn.query(
            `INSERT INTO cooldowns (id_user, name, expires_at, uses) VALUES (?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
            [String(userId), name, Math.trunc(until)],
        );
        return 0;
    });
}

/**
 * Limite "N utilisations par fenetre" (ex : =rc 8 fois par heure).
 * Retourne { ok, left, resetIn }
 */
async function window(userId, name, max, windowMs) {
    const now = Date.now();
    return db.tx(async (conn) => {
        const [rows] = await conn.query(
            'SELECT expires_at, uses FROM cooldowns WHERE id_user = ? AND name = ? FOR UPDATE',
            [String(userId), name],
        );
        let exp = Number(rows[0]?.expires_at || 0);
        let uses = Number(rows[0]?.uses || 0);
        if (exp <= now) {
            exp = now + windowMs;
            uses = 0;
        }
        if (uses >= max) return { ok: false, left: 0, resetIn: exp - now };
        uses += 1;
        await conn.query(
            `INSERT INTO cooldowns (id_user, name, expires_at, uses) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at), uses = VALUES(uses)`,
            [String(userId), name, exp, uses],
        );
        return { ok: true, left: max - uses, resetIn: exp - now };
    });
}

/** etat d'une fenetre sans la consommer (0 restant => next = fin de la fenetre) */
async function windowState(userId, name, max, windowMs) {
    const rows = await db.q('SELECT expires_at, uses FROM cooldowns WHERE id_user = ? AND name = ?', [String(userId), name]);
    const now = Date.now();
    const exp = Number(rows[0]?.expires_at || 0);
    const uses = Number(rows[0]?.uses || 0);
    if (exp <= now) return { left: max, next: 0 };
    const left = Math.max(0, max - uses);
    return { left, next: left > 0 ? 0 : exp };
}

async function clear(userId, name = null) {
    if (name) await db.exec('DELETE FROM cooldowns WHERE id_user = ? AND name = ?', [String(userId), name]);
    else await db.exec('DELETE FROM cooldowns WHERE id_user = ?', [String(userId)]);
}

module.exports = { remaining, set, setUntil, take, window, windowState, clear };
