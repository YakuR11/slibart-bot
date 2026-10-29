// Toutes les operations d'argent passent par ici.
// Chaque debit est atomique (UPDATE ... WHERE rb >= montant) : impossible de passer
// en negatif ou de depenser deux fois le meme argent en spammant une commande.
const db = require('../db');
const config = require('../config');

/**
 * Credite un compte. Tout argent qui entre chez un joueur endette est preleve
 * a la source (casino, daily, work, recompenses, dons...). opts.raw saute le prelevement
 * (le pret lui-meme, et le compte du casino).
 * Retourne { net, cut, debt, gross }.
 */
async function addRb(userId, amount, conn = db.pool, opts = {}) {
    const n = Math.trunc(Number(amount) || 0);
    await db.ensureProfile(userId, conn);
    const raw = opts.raw || n <= 0 || String(userId) === String(config.casinoId);
    if (raw) {
        if (n) await db.exec('UPDATE profile SET rb = rb + ? WHERE id_user = ?', [n, String(userId)], conn);
        return { net: n, cut: 0, debt: 0, gross: n };
    }
    const { withhold } = require('./credit');
    const w = await withhold(userId, n, conn);
    if (w.net > 0) await db.exec('UPDATE profile SET rb = rb + ? WHERE id_user = ?', [w.net, String(userId)], conn);
    return { net: w.net, cut: w.cut, debt: w.debt, gross: n };
}

/** Debite si le solde suffit. Retourne true/false. */
async function takeRb(userId, amount, conn = db.pool) {
    await db.ensureProfile(userId, conn);
    const res = await db.exec(
        'UPDATE profile SET rb = rb - ? WHERE id_user = ? AND rb >= ?',
        [Math.trunc(amount), String(userId), Math.trunc(amount)],
        conn,
    );
    return res.affectedRows > 0;
}

async function balance(userId, conn = db.pool) {
    await db.ensureProfile(userId, conn);
    const [rows] = await conn.query('SELECT rb FROM profile WHERE id_user = ? LIMIT 1', [String(userId)]);
    return Number(rows[0]?.rb || 0);
}

/** Virement atomique. Retourne false si fonds insuffisants. */
async function transfer(fromId, toId, amount) {
    return db.tx(async (conn) => {
        const ok = await takeRb(fromId, amount, conn);
        if (!ok) return false;
        return addRb(toId, amount, conn);
    });
}

/** Incremente des compteurs : bump(id, { wacount: 1, minecount: 5 }) */
async function bump(userId, fields, conn = db.pool) {
    const keys = Object.keys(fields).filter((k) => db.COUNTERS.includes(k));
    if (!keys.length) return;
    await db.ensureProfile(userId, conn);
    const set = keys.map((k) => `${k} = ${k} + ?`).join(', ');
    await db.exec(`UPDATE profile SET ${set} WHERE id_user = ?`, [...keys.map((k) => Math.trunc(fields[k])), String(userId)], conn);
}

/** Le casino encaisse les pertes */
const toCasino = (amount, conn) => addRb(config.casinoId, amount, conn);

/**
 * Parse un montant : "500", "1k", "2.5k", "1m", "all", "half"/"moitie".
 * Retourne un entier > 0 ou null.
 */
function parseAmount(input, balanceNow) {
    if (input === undefined || input === null) return null;
    const s = String(input).trim().toLowerCase().replace(/[\s_]/g, '');
    if (['all', 'tout', 'max'].includes(s)) return balanceNow > 0 ? balanceNow : null;
    if (['half', 'moitie', 'moitié'].includes(s)) return balanceNow >= 2 ? Math.floor(balanceNow / 2) : null;
    const m = s.match(/^(\d+(?:[.,]\d+)?)([km]?)$/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(',', '.')) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
    const v = Math.floor(n);
    return v > 0 && Number.isSafeInteger(v) ? v : null;
}

module.exports = { addRb, takeRb, balance, transfer, bump, toCasino, parseAmount };
