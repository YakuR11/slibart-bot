// Salaire de la demi-heure : =work / =gw et les clics de l'app puisent dans le MEME pot.
// Trente minutes de clics, ou un =work, c'est le meme argent. Pas les deux.
const db = require('../db');

const WORK_BASE = 50;
const WORK_PER_SLAVE = 25;
const SLOT_MS = 30 * 60 * 1000;
const GW_AVG = 62.5;

const slotEnd = (now = Date.now()) => Math.ceil((now + 1) / SLOT_MS) * SLOT_MS;

/** part d'un clic pour vider le pot en 30 min a n clics par minute */
function sliceOf(pot, n) {
    const clicks = 30 * Math.max(1, n);
    return Math.max(1, Math.round(Number(pot) / clicks));
}

/**
 * Prend `request` RB dans le pot du creneau (ou tout le reste si all).
 * lockPot : le montant est tire une fois (gw). Sinon il peut monter (esclaves, happy hour).
 * request 0 ne paie rien et ne cree pas de ligne : sert a lire l'etat.
 */
async function claim(userId, kind, potNow, request, { all = false, lockPot = false } = {}) {
    const id = String(userId);
    const now = Date.now();
    const end = slotEnd(now);
    return db.tx(async (conn) => {
        const [rows] = await conn.query(
            'SELECT slot_end, pot, paid, tracked FROM wage_slot WHERE id_user = ? AND kind = ? FOR UPDATE',
            [id, kind],
        );
        const row = rows[0];
        const open = row && Number(row.slot_end) > now;
        let pot = open ? Number(row.pot) : potNow;
        let paid = open ? Number(row.paid) : 0;
        let tracked = open ? Number(row.tracked) : 0;
        const until = open ? Number(row.slot_end) : end;
        if (!open) {
            if (request === 0 && !all) return { paid: 0, left: potNow, slotEnd: end, pot: potNow, already: 0, fresh: false, opened: false };
            await conn.query(
                `INSERT INTO wage_slot (id_user, kind, slot_end, pot, paid, tracked) VALUES (?, ?, ?, ?, 0, 0)
                 ON DUPLICATE KEY UPDATE slot_end = VALUES(slot_end), pot = VALUES(pot), paid = 0, tracked = 0`,
                [id, kind, end, potNow],
            );
            pot = potNow;
            paid = 0;
            tracked = 0;
        } else if (!lockPot && potNow > pot) {
            pot = potNow;
            await conn.query('UPDATE wage_slot SET pot = ? WHERE id_user = ? AND kind = ?', [pot, id, kind]);
        }
        const left = Math.max(0, pot - paid);
        const take = all ? left : Math.min(left, Math.max(0, Math.trunc(request)));
        if (take <= 0) return { paid: 0, left, slotEnd: until, pot, already: paid, fresh: false, opened: true };
        await conn.query(
            'UPDATE wage_slot SET paid = paid + ?, tracked = 1 WHERE id_user = ? AND kind = ?',
            [take, id, kind],
        );
        return { paid: take, left: left - take, slotEnd: until, pot, already: paid, fresh: !tracked, opened: true };
    });
}

async function peek(userId, kind) {
    const rows = await db.q('SELECT slot_end, pot, paid FROM wage_slot WHERE id_user = ? AND kind = ?', [String(userId), kind]);
    const row = rows[0];
    if (!row || Number(row.slot_end) <= Date.now()) return null;
    const pot = Number(row.pot);
    const paid = Number(row.paid);
    return { pot, paid, left: Math.max(0, pot - paid), slotEnd: Number(row.slot_end) };
}

module.exports = { WORK_BASE, WORK_PER_SLAVE, SLOT_MS, GW_AVG, slotEnd, sliceOf, claim, peek };
