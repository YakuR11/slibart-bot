// Prestige (rebirth facon tycoon Roblox) : tu repars de zero (RB, esclaves, caves)
// contre un bonus permanent sur tes revenus de travail. Le contremaitre, l'XP, les objets et les cadres restent.
//
// Equilibre :
// - le bonus ne touche que work / gw / mine / daily / contremaitre, jamais le casino ni les quetes
// - +20 % par prestige, 10 max (x3) ; le seuil monte a chaque fois (x1,6 en RB, +5 esclaves)
// - l'argent remis a zero est detruit : c'est le plus gros puits de RB du jeu
const db = require('../db');

const STEP = 0.2;
const MAX = 10;
const BASE_RB = 100_000;
const RB_GROWTH = 1.6;
const BASE_SLAVES = 30;
const SLAVES_STEP = 5;

const mult = (level) => 1 + STEP * Math.min(MAX, Math.max(0, Math.trunc(Number(level) || 0)));

/** conditions pour passer du prestige n au n+1 */
function need(level) {
    const n = Math.max(0, Math.trunc(Number(level) || 0));
    return { rb: Math.round((BASE_RB * RB_GROWTH ** n) / 1000) * 1000, slaves: BASE_SLAVES + SLAVES_STEP * n };
}

function status(p) {
    const level = Number(p.prestige || 0);
    const req = need(level);
    const maxed = level >= MAX;
    const ready = !maxed && Number(p.rb) >= req.rb && Number(p.slavecount) >= req.slaves && Number(p.debt || 0) <= 0;
    return { level, max: MAX, mult: mult(level), nextMult: mult(level + 1), need: req, ready, maxed, debt: Number(p.debt || 0) };
}

async function rebirth(userId) {
    const id = String(userId);
    return db.tx(async (conn) => {
        await db.ensureProfile(id, conn);
        const [[p]] = await conn.query('SELECT rb, slavecount, debt, prestige FROM profile WHERE id_user = ? FOR UPDATE', [id]);
        const st = status({ rb: p.rb, slavecount: p.slavecount, debt: p.debt, prestige: p.prestige });
        if (st.maxed) return { err: 'max' };
        if (st.debt > 0) return { err: 'debt' };
        if (!st.ready) return { err: 'need', need: st.need };
        await conn.query(
            'UPDATE profile SET rb = 0, slavecount = 0, cavecount = 0, prestige = prestige + 1 WHERE id_user = ? AND prestige = ?',
            [id, Number(p.prestige)],
        );
        // le salaire de la demi-heure en cours repart aussi de zero
        await conn.query('DELETE FROM wage_slot WHERE id_user = ?', [id]);
        return { level: st.level + 1, mult: mult(st.level + 1), burned: Number(p.rb) };
    });
}

module.exports = { STEP, MAX, mult, need, status, rebirth };
