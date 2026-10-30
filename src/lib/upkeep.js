// Puits : l'entretien des caves grandit avec le nombre de caves,
// et une taxe prend 1 % de ce qui depasse 20 000 RB (plafond 5 000 par jour).
// Preleve une fois par jour, heure de Paris. L'argent va a la banque du slip.
const db = require('../db');
const eco = require('./economy');
const config = require('../config');
const paris = require('./paris');
const log = require('./logger');
const away = require('./away');

const TAX_FLOOR = 20_000;
const TAX_RATE = 0.01;
const TAX_CAP = 5_000;

/** somme 12, 12*1.15, 12*1.15^2... : la cave n°1 coute 12 RB/jour, la suivante un peu plus */
function caveFee(caves) {
    let fee = 0;
    const n = Math.max(0, Math.trunc(Number(caves) || 0));
    for (let i = 0; i < n; i++) fee += Math.round(12 * (1.15 ** i));
    return fee;
}

function wealthTax(rb) {
    const over = Math.trunc(Number(rb) || 0) - TAX_FLOOR;
    if (over <= 0) return 0;
    return Math.min(TAX_CAP, Math.floor(over * TAX_RATE));
}

function due(rb, caves) {
    return caveFee(caves) + wealthTax(rb);
}

let running = false;

async function tick() {
    if (running) return;
    running = true;
    try {
        await charge();
    } finally {
        running = false;
    }
}

async function charge() {
    const day = paris.now().day;
    if ((await db.getSetting('upkeep_day')) === day) return;
    await db.setSetting('upkeep_day', day);
    const rows = await db.q(
        'SELECT id_user, rb, cavecount FROM profile WHERE id_user != ? AND (cavecount > 0 OR rb > ?)',
        [String(config.casinoId), TAX_FLOOR],
    );
    let n = 0;
    let total = 0;
    for (const r of rows) {
        const bill = due(r.rb, r.cavecount);
        if (bill <= 0) continue;
        const took = await db.tx(async (conn) => {
            const [[p]] = await conn.query('SELECT rb FROM profile WHERE id_user = ? FOR UPDATE', [String(r.id_user)]);
            const pay = Math.min(Number(p?.rb || 0), bill);
            if (pay <= 0) return 0;
            await conn.query('UPDATE profile SET rb = rb - ? WHERE id_user = ?', [pay, String(r.id_user)]);
            await eco.toCasino(pay, conn);
            return pay;
        });
        if (took > 0) {
            await away.add(r.id_user, { upkeep: took });
            n++;
            total += took;
        }
    }
    log.info(`[entretien] ${day} : ${n} compte(s), ${total} RB`);
}

module.exports = { caveFee, wealthTax, due, tick, TAX_FLOOR, TAX_RATE, TAX_CAP };
