// Credit : on emprunte, et tout ce qui entre ensuite sur le compte est preleve
// a la source (work, daily, casino, quetes, dons, recompenses).
// Plus la dette est grosse, plus le pourcentage est fort, jusqu'a 50 %.
const db = require('../db');
const eco = require('./economy');
const { fmt } = require('./utils');

// Plafond selon le niveau : sinon on emprunte 100M au niveau 0, on donne tout a un pote
// et la dette reste coincee sur un compte jetable = argent infini.
const MAX_DEBT = 250_000; // plafond absolu
const MIN_LOAN = 100;
const FEE = 0.10; // 10 % de frais : emprunter 1000 = devoir 1100
const maxDebt = (level) => Math.min(MAX_DEBT, 5_000 + 3_000 * (Number(level) || 0));
const FULL_RATE_AT = 100_000; // a partir de 100k, le work est preleve a 50 %

/** 10 % pour une petite dette, 50 % des 100k. */
function rate(debt) {
    if (debt <= 0) return 0;
    const t = Math.min(1, debt / FULL_RATE_AT);
    return 0.1 + 0.4 * t;
}

const pct = (debt) => Math.round(rate(debt) * 100);

/** Ligne a coller sous un gain, vide s'il n'y a rien a prelever. */
function note(cut, debt) {
    if (!cut) return '';
    const left = Number(debt) || 0;
    return `\n🏦 La banque prend **${fmt(cut)}** (${pct(left + cut)} %) · dette **${fmt(left)}**`;
}

/**
 * Prelevement a la source. Le joueur ne recoit que le net.
 * Retourne { net, cut, debt, rate }.
 */
async function withhold(userId, gross, conn = db.pool) {
    const [rows] = await conn.query('SELECT debt FROM profile WHERE id_user = ? FOR UPDATE', [String(userId)]);
    const debt = Number(rows[0]?.debt || 0);
    if (debt <= 0 || gross <= 0) return { net: gross, cut: 0, debt: 0, rate: 0 };
    const r = rate(debt);
    const cut = Math.min(debt, Math.floor(gross * r));
    if (cut <= 0) return { net: gross, cut: 0, debt, rate: r };
    const res = await db.exec('UPDATE profile SET debt = debt - ? WHERE id_user = ? AND debt >= ?', [cut, String(userId), cut], conn);
    if (!res.affectedRows) return { net: gross, cut: 0, debt, rate: r };
    await eco.toCasino(cut, conn);
    return { net: gross - cut, cut, debt: debt - cut, rate: r };
}

/** Emprunte. Le montant arrive sur le compte, la dette augmente du montant + 10 %. */
async function borrow(userId, amount) {
    return db.tx(async (conn) => {
        await db.ensureProfile(userId, conn);
        const [rows] = await conn.query('SELECT debt, level FROM profile WHERE id_user = ? FOR UPDATE', [String(userId)]);
        const debt = Number(rows[0]?.debt || 0);
        const cap = maxDebt(rows[0]?.level);
        const owed = Math.ceil(amount * (1 + FEE));
        if (debt + owed > cap) return { error: 'cap', debt, cap, room: Math.max(0, Math.floor((cap - debt) / (1 + FEE))) };
        await eco.addRb(userId, amount, conn, { raw: true });
        await db.exec('UPDATE profile SET debt = debt + ? WHERE id_user = ?', [owed, String(userId)], conn);
        const next = debt + owed;
        return { debt: next, rate: rate(next), owed, cap };
    });
}

/** Rembourse avant l'heure, depuis le solde. */
async function repay(userId, amount) {
    return db.tx(async (conn) => {
        await db.ensureProfile(userId, conn);
        const [rows] = await conn.query('SELECT debt, rb FROM profile WHERE id_user = ? FOR UPDATE', [String(userId)]);
        const debt = Number(rows[0]?.debt || 0);
        const bal = Number(rows[0]?.rb || 0);
        if (debt <= 0) return { error: 'none' };
        const pay = Math.min(debt, amount, bal);
        if (pay <= 0) return { error: 'broke', debt };
        const ok = await eco.takeRb(userId, pay, conn);
        if (!ok) return { error: 'broke', debt };
        await db.exec('UPDATE profile SET debt = debt - ? WHERE id_user = ?', [pay, String(userId)], conn);
        await eco.toCasino(pay, conn);
        return { paid: pay, debt: debt - pay, rate: rate(debt - pay) };
    });
}

module.exports = { MAX_DEBT, MIN_LOAN, FEE, maxDebt, rate, pct, note, withhold, borrow, repay };
