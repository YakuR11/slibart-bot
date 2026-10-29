// Happy hour : 1h tiree au hasard chaque soir ou work/gw/daily/mine et l'XP sont x2.
const db = require('../db');

let cache = { start: 0, end: 0, t: 0 };

async function window() {
    if (Date.now() - cache.t > 20_000) {
        cache = {
            start: Number(await db.getSetting('happy_start', '0')),
            end: Number(await db.getSetting('happy_end', '0')),
            t: Date.now(),
        };
    }
    return cache;
}

async function active() {
    const w = await window();
    const n = Date.now();
    return n >= w.start && n < w.end;
}

/** multiplicateur actuel (2 pendant la happy hour, 1 sinon) */
async function mult() {
    return (await active()) ? 2 : 1;
}

const reset = () => { cache.t = 0; };

module.exports = { active, mult, window, reset };
