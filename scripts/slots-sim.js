// Simulation des slots : RTP du jeu normal et de l'achat du bonus.
// node scripts/slots-sim.js [tours]
const m = require('../src/activity/slotmath');

const N = Number(process.argv[2] || 200000);
let total = 0;
let trig = 0;
let hit = 0;
let max = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
    const r = m.play();
    total += r.total;
    if (r.fs) trig++;
    if (r.total > 0) hit++;
    if (r.total > max) max = r.total;
}
let bonus = 0;
const B = Math.max(2000, Math.round(N / 50));
for (let i = 0; i < B; i++) bonus += m.play({ buy: true }).total;
console.log(`${N} tours en ${Date.now() - t0} ms`);
console.log(`RTP jeu normal : ${((total / N) * 100).toFixed(2)} %`);
console.log(`tours gagnants : ${((hit / N) * 100).toFixed(1)} %  · bonus 1 tour sur ${Math.round(N / Math.max(1, trig))}  · max x${max}`);
console.log(`bonus moyen : x${(bonus / B).toFixed(1)}  (prix d'achat conseille pour 95 % : x${Math.round(bonus / B / 0.95)})`);
