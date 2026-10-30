// Effets plein ecran partages par tous les jeux : flash, assombrissement, halo d'ecran,
// confettis / pieces / emojis sur une toile par-dessus tout.
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
export const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = $('fx-canvas');
const ctx = canvas.getContext('2d');
let parts = [];
let running = false;
let W = 0;
let H = 0;

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function loop() {
    if (running) return;
    running = true;
    let last = performance.now();
    const tick = (now) => {
        const dt = Math.min(50, now - last);
        last = now;
        ctx.clearRect(0, 0, W, H);
        for (const p of parts) {
            p.age += dt;
            p.vy += p.g * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
            const a = Math.max(0, 1 - p.age / p.life);
            ctx.globalAlpha = Math.min(1, a * 2);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            if (p.emoji) {
                ctx.font = `${p.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(p.emoji, 0, 0);
            } else if (p.coin) {
                const w = Math.abs(Math.cos(p.rot * 4)) * p.size + 1;
                ctx.fillStyle = '#b87a16';
                ctx.beginPath();
                ctx.ellipse(0, 0, w, p.size, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffd76a';
                ctx.beginPath();
                ctx.ellipse(0, 0, w * 0.7, p.size * 0.7, 0, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            }
            ctx.restore();
        }
        ctx.globalAlpha = 1;
        parts = parts.filter((p) => p.age < p.life && p.y < H + 60);
        if (parts.length) requestAnimationFrame(tick);
        else {
            running = false;
            ctx.clearRect(0, 0, W, H);
        }
    };
    requestAnimationFrame(tick);
}

const CONF = ['#ffd76a', '#ff5a4e', '#4fd1ff', '#8cff6b', '#ff6fb5', '#f7ebd7', '#b98bff'];

export const fx = {
    /** confettis depuis le haut */
    confetti(n = 80, colors = CONF) {
        if (reduceMotion) return;
        for (let i = 0; i < n; i++) {
            parts.push({ x: rand(0, W), y: rand(-H * 0.3, -10), vx: rand(-0.05, 0.05), vy: rand(0.08, 0.3), g: 0.00008, rot: rand(0, 6), vr: rand(-0.01, 0.01), size: rand(6, 11), color: colors[i % colors.length], life: rand(2200, 3600), age: 0 });
        }
        loop();
    },
    /** gerbe de pieces depuis un point (coordonnees ecran) */
    coins(x, y, n = 30) {
        if (reduceMotion) n = Math.min(n, 6);
        for (let i = 0; i < n; i++) {
            const a = rand(-Math.PI * 0.9, -Math.PI * 0.1);
            const v = rand(0.25, 0.75);
            parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.0016, rot: rand(0, 6), vr: rand(-0.02, 0.02), size: rand(5, 9), coin: true, life: rand(1200, 1900), age: 0 });
        }
        loop();
    },
    /** des emojis qui jaillissent (🤣 sur les grosses pertes, 💸, 🔥...) */
    emojis(emoji, x, y, n = 12, spread = 1) {
        for (let i = 0; i < n; i++) {
            const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
            const v = rand(0.2, 0.55) * spread;
            parts.push({ x: x + rand(-20, 20), y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.0011, rot: rand(-0.4, 0.4), vr: rand(-0.004, 0.004), size: rand(22, 40), emoji, life: rand(1400, 2200), age: 0 });
        }
        loop();
    },
    /** flash de couleur rapide sur tout l'ecran */
    flash(color = '#fff6d8', strength = 0.5) {
        if (reduceMotion) return;
        const el = document.createElement('div');
        el.className = 'flash-layer';
        el.style.background = color;
        el.style.setProperty('--a', strength);
        document.body.append(el);
        setTimeout(() => el.remove(), 500);
    },
    /** assombrit tout sauf l'element (suspense) ; off() pour revenir */
    dim(on) {
        $('dim').classList.toggle('on', !!on);
    },
    /** halo autour de tout l'ecran (vert = gagne, rouge = perdu), intensite 0..1 */
    glow(color, intensity = 1, ms = 2600) {
        const el = $('screen-glow');
        el.style.setProperty('--g', color);
        el.style.setProperty('--i', String(Math.max(0.15, Math.min(1, intensity))));
        el.classList.remove('on');
        void el.offsetWidth;
        el.classList.add('on');
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('on'), ms);
    },
    /** fait trembler un element */
    shake(el, strength = 1) {
        if (reduceMotion || !el) return;
        el.style.setProperty('--sh', `${4 * strength}px`);
        el.classList.remove('shaking');
        void el.offsetWidth;
        el.classList.add('shaking');
        setTimeout(() => el.classList.remove('shaking'), 450);
    },
};
