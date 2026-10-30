// Sons 100 % synthetises (pas de fichier a charger) :
// xylophone pentatonique sur les picots, pieces qui tintent, fanfares par palier de gain,
// battement de coeur quand la bille frole un gros godet, cliquetis du compteur.
let ac = null;
let master = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('plinko-muted') === '1'; } catch { /* stockage indispo */ }

function ctx() {
    if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.9;
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 10;
        comp.ratio.value = 5;
        comp.attack.value = 0.003;
        comp.release.value = 0.2;
        master.connect(comp).connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
}

// limite le nombre de sons par instant (une rafale de 50 billes ne doit pas saturer)
let budget = 0;
let budgetT = 0;
function allow(cost = 1, max = 7) {
    const now = performance.now();
    if (now - budgetT > 45) {
        budget = 0;
        budgetT = now;
    }
    if (budget + cost > max) return false;
    budget += cost;
    return true;
}

function osc(freq, { type = 'sine', at = 0, dur = 0.1, gain = 0.05, attack = 0.004, slide = 0, to = null } = {}) {
    if (muted) return;
    const a = ctx();
    if (!a) return;
    const t0 = a.currentTime + at;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(to || master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
}

function noise({ at = 0, dur = 0.1, gain = 0.05, type = 'bandpass', freq = 2000, q = 1, slideTo = null, attack = 0.004 } = {}) {
    if (muted) return;
    const a = ctx();
    if (!a) return;
    const t0 = a.currentTime + at;
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    const f = a.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    f.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
}

const PENTA = [0, 2, 4, 7, 9];
function note(i, base = 523.25) {
    const oct = Math.floor(i / 5);
    return base * 2 ** ((PENTA[((i % 5) + 5) % 5] + 12 * oct) / 12);
}

/** piece qui tinte : partiels inharmoniques facon cloche + petit clic */
function coin(at = 0, pitch = 1, gain = 0.035) {
    const f = 1850 * pitch;
    osc(f, { at, dur: 0.32, gain, type: 'sine' });
    osc(f * 2.76, { at, dur: 0.18, gain: gain * 0.5, type: 'sine' });
    osc(f * 5.4, { at, dur: 0.08, gain: gain * 0.25, type: 'sine' });
    noise({ at, dur: 0.03, gain: gain * 0.6, freq: 7000, q: 2 });
}

function arp(steps, { base = 523.25, gap = 0.07, at = 0, gain = 0.06, type = 'triangle', dur = 0.25 } = {}) {
    steps.forEach((s, i) => {
        osc(note(s, base), { at: at + i * gap, dur, gain, type });
        osc(note(s, base) * 2, { at: at + i * gap, dur: dur * 0.6, gain: gain * 0.25, type: 'sine' });
    });
}

let lastTick = 0;
let engineNodes = null;

export const sound = {
    unlock() { ctx(); },
    get muted() { return muted; },
    toggle() {
        muted = !muted;
        if (muted) this.engine(false);
        try { localStorage.setItem('plinko-muted', muted ? '1' : '0'); } catch { /* rien */ }
        return muted;
    },

    /** petit bruit de lancer */
    launch() {
        if (!allow(1)) return;
        osc(300, { dur: 0.08, gain: 0.04, slide: 260, type: 'triangle' });
    },

    /** chaque picot = une note, qui monte en descendant le plateau */
    peg(row, rows, mine, tense = false) {
        if (!allow(mine ? 1 : 1.6)) return;
        const i = Math.round((row / Math.max(1, rows - 1)) * 9);
        const f = note(i, mine ? 523.25 : 392);
        osc(f, { type: 'triangle', dur: tense ? 0.18 : 0.07, gain: mine ? 0.045 : 0.014 });
        if (mine) osc(f * 2, { type: 'sine', dur: 0.04, gain: 0.01 });
    },

    /** bille qui frole un gros godet : battement de coeur + montee */
    tension(level, remaining) {
        const k = remaining === 1 ? 1 : remaining === 2 ? 0.75 : 0.5;
        osc(62, { dur: 0.14, gain: 0.3 * k, slide: -22 });
        osc(58, { at: 0.16, dur: 0.12, gain: 0.22 * k, slide: -20 });
        noise({ dur: 0.35, gain: 0.025 * k, freq: 900 + (3 - remaining) * 900, slideTo: 3000 + (3 - remaining) * 1500, q: 4 });
    },

    /** arrivee dans un godet, selon le multiplicateur */
    land(mult) {
        if (mult < 1) {
            if (!allow(1)) return;
            osc(150, { dur: 0.12, gain: 0.06, slide: -50 });
            noise({ dur: 0.05, gain: 0.03, type: 'lowpass', freq: 500 });
            return;
        }
        if (mult < 2) {
            if (!allow(2)) return;
            coin(0, 1 + Math.random() * 0.1);
            return;
        }
        if (!allow(3, 10)) return;
        // 2x a 10x : arpege qui monte + quelques pieces
        const n = mult >= 5 ? 5 : 3;
        arp([0, 2, 4, 5, 7].slice(0, n), { gap: 0.055, gain: 0.05 });
        for (let i = 0; i < n; i++) coin(0.05 + i * 0.07, 1 + i * 0.06, 0.025);
    },

    /** gros gain : 1 = gros, 2 = mega, 3 = jackpot */
    bigWin(tier, seconds) {
        // montee
        noise({ dur: 0.4, gain: 0.05, freq: 400, slideTo: 5000, q: 3, attack: 0.3 });
        // impact
        osc(65, { at: 0.35, dur: 0.5 + tier * 0.2, gain: 0.35, slide: -30 });
        noise({ at: 0.35, dur: 0.25, gain: 0.08, type: 'lowpass', freq: 1200 });
        // accord majeur + arpege qui grimpe
        const base = tier >= 3 ? 587.33 : 523.25;
        [0, 2, 3, 5].forEach((s) => osc(note(s, base / 2), { at: 0.36, dur: 0.9, gain: 0.05, type: 'triangle' }));
        arp([0, 1, 2, 3, 4, 5, 6, 7, 8, 10].slice(0, 6 + tier * 2), { base, at: 0.4, gap: 0.06, gain: 0.05 });
        if (tier >= 2) arp([5, 7, 9, 10], { base, at: 0.4 + (6 + tier * 2) * 0.06 + 0.05, gap: 0.11, gain: 0.06, dur: 0.5 });
        // pluie de pieces pendant tout le compteur
        const coins = 10 + tier * 14;
        for (let i = 0; i < coins; i++) coin(0.4 + Math.random() * seconds, 0.85 + Math.random() * 0.4, 0.02);
    },

    /** cliquetis du compteur qui defile */
    tick(progress = 0) {
        const now = performance.now();
        if (now - lastTick < 40) return;
        lastTick = now;
        osc(1400 + progress * 900, { type: 'square', dur: 0.018, gain: 0.01 });
    },

    /** serie de gains d'affilee */
    streak(n) {
        if (!allow(2, 10)) return;
        const i = 5 + Math.min(n, 12);
        osc(note(i), { dur: 0.16, gain: 0.04, type: 'sine', at: 0.12 });
        osc(note(i + 2), { dur: 0.2, gain: 0.035, type: 'sine', at: 0.2 });
    },

    /** un pote touche un gros godet */
    friendWin(tier = 1) {
        arp([0, 2, 4, 7], { base: 392, gap: 0.07, gain: 0.04 });
        for (let i = 0; i < 4 + tier * 3; i++) coin(0.15 + Math.random() * 0.6, 0.9 + Math.random() * 0.3, 0.018);
    },

    // ---------------- crash ----------------
    /** moteur de la fusee : un grondement qui monte avec le multiplicateur */
    engine(on) {
        if (!on || muted) {
            if (engineNodes) {
                const { o, g, a } = engineNodes;
                g.gain.setTargetAtTime(0.0001, a.currentTime, 0.08);
                o.stop(a.currentTime + 0.4);
                engineNodes = null;
            }
            return;
        }
        if (engineNodes) return;
        const a = ctx();
        if (!a) return;
        const o = a.createOscillator();
        const f = a.createBiquadFilter();
        const g = a.createGain();
        o.type = 'sawtooth';
        o.frequency.value = 55;
        f.type = 'lowpass';
        f.frequency.value = 380;
        g.gain.value = 0.0001;
        g.gain.setTargetAtTime(0.035, a.currentTime, 0.2);
        o.connect(f).connect(g).connect(master);
        o.start();
        engineNodes = { o, f, g, a };
    },
    engineAt(m) {
        if (!engineNodes) return;
        const { o, f, a } = engineNodes;
        const k = Math.log(Math.max(1, m));
        o.frequency.setTargetAtTime(55 + k * 38, a.currentTime, 0.1);
        f.frequency.setTargetAtTime(380 + k * 500, a.currentTime, 0.1);
    },
    countdown(sec) {
        osc(sec === 1 ? 880 : 660, { type: 'triangle', dur: 0.09, gain: 0.04 });
    },
    chip(mine = false) {
        if (!allow(1)) return;
        noise({ dur: 0.04, gain: mine ? 0.06 : 0.025, freq: 3200, q: 3 });
        osc(mine ? 1300 : 1100, { type: 'square', dur: 0.03, gain: mine ? 0.015 : 0.006 });
    },
    cashout(mult) {
        coin(0, 1.1, 0.04);
        coin(0.06, 1.25, 0.035);
        arp([0, 2, 4, 7], { gap: 0.05, gain: 0.05 });
        if (mult >= 3) for (let i = 0; i < 6; i++) coin(0.25 + i * 0.06, 0.9 + Math.random() * 0.4, 0.02);
    },
    friendCash() {
        if (!allow(2)) return;
        coin(0, 0.95, 0.018);
    },
    boom() {
        osc(70, { dur: 0.7, gain: 0.4, slide: -45 });
        noise({ dur: 0.6, gain: 0.12, type: 'lowpass', freq: 1800, slideTo: 200 });
        noise({ dur: 0.15, gain: 0.08, freq: 5000, q: 1 });
    },
    // ---------------- jeux de l'app ----------------
    /** tic de roue / rouleau qui ralentit (t = 0..1 : de plus en plus grave) */
    spinTick(t = 0) {
        if (!allow(1, 9)) return;
        osc(1500 - t * 700, { type: 'square', dur: 0.022, gain: 0.018 });
    },
    lever() {
        noise({ dur: 0.25, gain: 0.05, freq: 600, slideTo: 2400, q: 2 });
        osc(180, { dur: 0.2, gain: 0.05, slide: 120, type: 'triangle' });
    },
    reelStop(i = 0) {
        osc(200 - i * 25, { dur: 0.12, gain: 0.12, slide: -60 });
        noise({ dur: 0.06, gain: 0.06, type: 'lowpass', freq: 900 });
    },
    heartbeat() {
        for (let i = 0; i < 3; i++) {
            osc(60, { at: i * 0.45, dur: 0.13, gain: 0.3, slide: -22 });
            osc(56, { at: i * 0.45 + 0.16, dur: 0.12, gain: 0.22, slide: -20 });
        }
    },
    /** gain : 1 petit, 2 moyen, 3 gros */
    win(level = 1) {
        const steps = level >= 3 ? [0, 2, 4, 5, 7, 9, 10] : level === 2 ? [0, 2, 4, 7, 9] : [0, 2, 4, 7];
        arp(steps, { gap: 0.06, gain: 0.055 });
        for (let i = 0; i < 3 + level * 4; i++) coin(0.1 + i * 0.06, 0.9 + Math.random() * 0.4, 0.022);
    },
    /** perte : grave, plus long si c'est une grosse perte */
    lose(amount = 0) {
        if (amount >= 2000) return this.sad();
        osc(220, { type: 'triangle', dur: 0.18, gain: 0.05, slide: -60 });
        osc(165, { type: 'triangle', dur: 0.25, gain: 0.05, slide: -50, at: 0.14 });
    },
    /** trombone triste "wah wah wah waaah" */
    sad() {
        const n = [392, 370, 349, 330];
        n.forEach((f, i) => osc(f, { type: 'sawtooth', dur: i === 3 ? 0.9 : 0.32, gain: 0.035, at: i * 0.34, slide: i === 3 ? -40 : 0 }));
    },
    /** des petits rires (grosse perte d'un pote) */
    laugh() {
        if (!allow(3, 10)) return;
        for (let i = 0; i < 5; i++) {
            osc(520 + Math.random() * 80, { type: 'triangle', dur: 0.08, gain: 0.03, at: i * 0.11, slide: -120 });
            noise({ at: i * 0.11, dur: 0.06, gain: 0.015, freq: 2200, q: 2 });
        }
    },
    betBig(tier = 4) {
        if (!allow(2, 10)) return;
        osc(tier >= 5 ? 110 : 150, { dur: 0.35, gain: 0.12, slide: -40 });
        noise({ dur: 0.3, gain: 0.04, freq: 500, slideTo: 3000, q: 2 });
    },
    card() {
        if (!allow(1)) return;
        noise({ dur: 0.07, gain: 0.07, freq: 3000, q: 0.8, slideTo: 1200 });
    },
    flip() {
        noise({ dur: 0.05, gain: 0.06, freq: 2400, q: 1 });
        osc(700, { type: 'sine', dur: 0.06, gain: 0.02 });
    },
    gem(k = 1) {
        osc(note(4 + Math.min(k, 12), 523.25), { type: 'sine', dur: 0.25, gain: 0.05 });
        osc(note(6 + Math.min(k, 12), 523.25), { type: 'sine', dur: 0.2, gain: 0.03, at: 0.05 });
    },
    bomb() {
        osc(55, { dur: 0.8, gain: 0.45, slide: -30 });
        noise({ dur: 0.7, gain: 0.16, type: 'lowpass', freq: 2200, slideTo: 150 });
    },
    pickaxe() {
        if (!allow(1)) return;
        osc(2200 + Math.random() * 400, { type: 'square', dur: 0.03, gain: 0.02 });
        noise({ dur: 0.05, gain: 0.05, freq: 4000, q: 3 });
        osc(140, { dur: 0.08, gain: 0.06, slide: -40 });
    },
    duelStart() {
        arp([0, 4, 7], { base: 392, gap: 0.09, gain: 0.05, type: 'sawtooth', dur: 0.2 });
    },
    drum() {
        for (let i = 0; i < 8; i++) noise({ at: i * 0.11, dur: 0.06, gain: 0.05 + i * 0.008, type: 'lowpass', freq: 400 });
    },
    // ---------------- boutique ----------------
    purchase() {
        arp([0, 2, 4, 5, 7, 9], { gap: 0.05, gain: 0.05 });
        for (let i = 0; i < 8; i++) coin(0.1 + i * 0.05, 0.9 + Math.random() * 0.4, 0.022);
    },
    equip() {
        osc(880, { type: 'sine', dur: 0.08, gain: 0.04 });
        osc(1320, { type: 'sine', dur: 0.12, gain: 0.035, at: 0.06 });
    },

    error() {
        osc(170, { type: 'square', dur: 0.1, gain: 0.025 });
        osc(125, { type: 'square', dur: 0.14, gain: 0.025, at: 0.09 });
    },
};
