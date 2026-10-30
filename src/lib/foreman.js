// Le contremaitre encaisse le salaire de =work a la place du joueur.
// Meme pot que le chat et les clics : s'il a deja ete pris, il ne paie pas une deuxieme fois.
const db = require('../db');
const eco = require('./economy');
const boost = require('./boost');
const wages = require('./wages');
const config = require('../config');
const log = require('./logger');
const prestige = require('./prestige');
const away = require('./away');

let running = false;

async function tick() {
    if (running) return { n: 0, total: 0 };
    running = true;
    try {
        const m = await boost.mult();
        const rows = await db.q(
            'SELECT id_user, slavecount, prestige FROM profile WHERE foreman = 1 AND id_user != ?',
            [String(config.casinoId)],
        );
        let n = 0;
        let total = 0;
        for (const r of rows) {
            const pot = wages.workAmount(r.slavecount, { foreman: true, mult: m * prestige.mult(r.prestige) });
            const got = await wages.claim(r.id_user, 'work', pot, pot, { all: true });
            if (got.paid <= 0) continue;
            const pay = await eco.addRb(r.id_user, got.paid);
            await away.add(r.id_user, { foreman: pay.net });
            n++;
            total += pay.net;
        }
        if (n) log.info(`[contremaitre] ${n} salaire(s), ${total} RB`);
        return { n, total };
    } finally {
        running = false;
    }
}

module.exports = { tick };
