// Multiplicateur de gains : happy hour (x2, 1h tiree au hasard chaque soir) et evenement
// (=event, ex. "retour du slip" x5 pendant 48h). Le plus gros des deux s'applique a
// work / gw / daily / mine, au salaire du contremaitre et a toute l'XP.
const db = require('../db');

let cache = { start: 0, end: 0, ev: null, t: 0 };

async function load() {
    if (Date.now() - cache.t > 20_000) {
        const [start, end, evMult, evStart, evEnd, evName] = await Promise.all([
            db.getSetting('happy_start', '0'),
            db.getSetting('happy_end', '0'),
            db.getSetting('event_mult', '1'),
            db.getSetting('event_start', '0'),
            db.getSetting('event_end', '0'),
            db.getSetting('event_name', ''),
        ]);
        cache = {
            start: Number(start),
            end: Number(end),
            ev: { mult: Number(evMult) || 1, start: Number(evStart), end: Number(evEnd), name: evName || 'Retour du slip' },
            t: Date.now(),
        };
    }
    return cache;
}

const window = load;

/** happy hour en cours ? */
async function active() {
    const w = await load();
    const n = Date.now();
    return n >= w.start && n < w.end;
}

/** evenement en cours : { mult, start, end, name }, sinon null */
async function event() {
    const { ev } = await load();
    const n = Date.now();
    return ev && ev.mult > 1 && n >= ev.start && n < ev.end ? ev : null;
}

/** multiplicateur actuel (evenement, sinon 2 pendant la happy hour, sinon 1) */
async function mult() {
    const ev = await event();
    return Math.max(ev ? ev.mult : 1, (await active()) ? 2 : 1);
}

/** petit texte a coller dans les messages de gain (vide hors bonus) */
async function tag() {
    const ev = await event();
    if (ev && ev.mult >= 2) return ` · 🩲 **${ev.name.toUpperCase()} x${ev.mult}**`;
    return (await active()) ? ' · 🔥 **HAPPY HOUR x2**' : '';
}

async function startEvent(m, durationMs, name = 'Retour du slip') {
    const now = Date.now();
    await db.setSetting('event_mult', String(m));
    await db.setSetting('event_start', String(now));
    await db.setSetting('event_end', String(now + durationMs));
    await db.setSetting('event_name', name);
    await db.setSetting('event_ended', '');
    reset();
    return event();
}

async function stopEvent() {
    await db.setSetting('event_end', String(Date.now()));
    reset();
}

const reset = () => { cache.t = 0; };

module.exports = { active, mult, window, reset, event, tag, startEvent, stopEvent };
