// Verifie le retour au joueur des Slip Originals : node scripts/originals-sim.js [tirages]
// Dice, Limbo, Keno, Tour : calcul exact. HiLo : simulation.
const m = require('../src/activity/origmath');

const N = Number(process.argv[2]) || 400_000;
const rnd = Math.random;
const pct = (x) => `${(x * 100).toFixed(2)} %`;
let bad = 0;
const check = (name, rtp, lo = 0.93, hi = 0.995) => {
    const ok = rtp >= lo && rtp <= hi;
    if (!ok) bad++;
    console.log(`${ok ? 'ok ' : 'KO '} ${name.padEnd(34)} ${pct(rtp)}`);
};

// Dice et Limbo : calcul exact (une simulation de gains rares bouge trop d'un lancement a l'autre)
for (const c of [1, 10, 49.5, 75, 95]) check(`dice chance ${c} % [x${m.diceMult(c)}]`, (c / 100) * m.diceMult(c));
for (const t of [1.01, 2, 10, 100, 1000]) check(`limbo x${t}`, (m.RTP / t) * t);
for (const risk of Object.keys(m.KENO_RISKS)) {
    for (let n = 1; n <= 10; n++) {
        const t = m.kenoTable(n, risk);
        check(`keno ${risk} ${n} numero(s) [max x${t[n]}]`, t.reduce((a, v, k) => a + v * m.kenoProb(n, k), 0));
    }
}
for (const diff of Object.keys(m.TOWER)) {
    const { cols, safe } = m.TOWER[diff];
    for (const stop of [1, 4, m.TOWER_LEVELS]) check(`tour ${diff} encaisse a l'etage ${stop} [x${m.towerMult(diff, stop)}]`, m.towerMult(diff, stop) * (safe / cols) ** stop);
}
for (const stop of [1, 3]) {
    let pay = 0;
    for (let i = 0; i < N; i++) {
        let card = m.hiloCard(rnd);
        let raw = 1;
        let k = 0;
        while (k < stop) {
            const guess = card.r <= 7 ? 'hi' : 'lo';
            const next = m.hiloCard(rnd);
            if (!m.hiloWins(card.r, guess, next.r)) { raw = 0; break; }
            raw /= m.hiloChance(card.r, guess);
            card = next;
            k++;
        }
        if (raw) pay += m.hiloMult(raw);
    }
    check(`hilo encaisse apres ${stop} carte(s)`, pay / N, 0.9, 1.03);
}
if (bad) { console.error(`\n${bad} table(s) hors limites`); process.exit(1); }
console.log('\ntout est dans les clous');
