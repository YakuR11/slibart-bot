// Heure de Paris (le conteneur Docker tourne en UTC).
const TZ = 'Europe/Paris';

/** { y, mo, d, h, mi, dow, day:'YYYY-MM-DD' } a l'heure de Paris */
function now(ts = Date.now()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, dow, day: `${p.year}-${p.month}-${p.day}` };
}

/** timestamp d'une heure de Paris (y, mois 1-12, jour, heure, minute) */
function at(y, mo, d, h = 0, mi = 0) {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const p = now(guess);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    return guess - (asUtc - guess);
}

/** cle de semaine = date du lundi (heure de Paris) */
function weekKey(ts = Date.now()) {
    const p = now(ts);
    const back = (p.dow + 6) % 7; // lundi = 0
    const monday = new Date(Date.UTC(p.y, p.mo - 1, p.d - back));
    return monday.toISOString().slice(0, 10);
}

/** prochain dimanche 21h (fin de saison) */
function weekEnd(ts = Date.now()) {
    const p = now(ts);
    const ahead = (7 - p.dow) % 7;
    const sun = new Date(Date.UTC(p.y, p.mo - 1, p.d + ahead));
    let t = at(sun.getUTCFullYear(), sun.getUTCMonth() + 1, sun.getUTCDate(), 21, 0);
    if (t <= ts) t = at(sun.getUTCFullYear(), sun.getUTCMonth() + 1, sun.getUTCDate() + 7, 21, 0);
    return t;
}

module.exports = { now, at, weekKey, weekEnd };
