// Sons synthetises (pas de fichier) : tic sur les picots, carillon a l'arrivee.
let ac = null;
let muted = false;
try { muted = localStorage.getItem('plinko-muted') === '1'; } catch { /* stockage indispo */ }

function ctx() {
    if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
}

function tone(freq, { dur = 0.06, type = 'triangle', gain = 0.05, at = 0 } = {}) {
    if (muted) return;
    const a = ctx();
    if (!a) return;
    const t0 = a.currentTime + at;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
}

export const sound = {
    unlock() { ctx(); },
    get muted() { return muted; },
    toggle() {
        muted = !muted;
        try { localStorage.setItem('plinko-muted', muted ? '1' : '0'); } catch { /* rien */ }
        return muted;
    },
    peg(row, mine) {
        tone(520 + row * 28 + Math.random() * 30, { gain: mine ? 0.035 : 0.015, dur: 0.05 });
    },
    land(mult) {
        if (mult < 1) return tone(220, { dur: 0.16, type: 'sine', gain: 0.05 });
        const base = mult >= 10 ? 660 : 523;
        tone(base, { dur: 0.18, type: 'sine', gain: 0.07 });
        tone(base * 1.26, { dur: 0.2, type: 'sine', gain: 0.06, at: 0.08 });
        if (mult >= 10) {
            tone(base * 1.5, { dur: 0.25, type: 'sine', gain: 0.06, at: 0.16 });
            tone(base * 2, { dur: 0.4, type: 'sine', gain: 0.06, at: 0.26 });
        }
    },
};
