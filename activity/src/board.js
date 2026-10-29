// Rendu du plateau : picots laiton sur feutrine, billes nacrees, godets couleur bonbon.
// La bille suit le chemin tire par le serveur (0 = gauche, 1 = droite a chaque rangee).

const COLORS = {
    brass: '#d9a441',
    brassHi: '#f3cf7a',
    brassLo: '#8f6420',
    lacquer: '#24070e',
    cream: '#f7ebd7',
};
// du centre (petit gain) vers les bords (gros multiplicateurs)
const BUCKET_STOPS = ['#f7e7a0', '#ffd25a', '#ffb627', '#ff8a3d', '#ff5a4e', '#d92f45'];

const lerp = (a, b, t) => a + (b - a) * t;
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(c1, c2, t) {
    const a = hex(c1);
    const b = hex(c2);
    return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
}
function bucketColor(k, rows) {
    const d = Math.abs(k - rows / 2) / (rows / 2); // 0 au centre, 1 au bord
    const x = d * (BUCKET_STOPS.length - 1);
    const i = Math.min(BUCKET_STOPS.length - 2, Math.floor(x));
    return mix(BUCKET_STOPS[i], BUCKET_STOPS[i + 1], x - i);
}

export function multLabel(m) {
    return m >= 100 ? `${m}` : `${m}×`;
}
export { bucketColor };

export class Board {
    constructor(canvas, popsEl) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.pops = popsEl;
        this.balls = [];
        this.pegHits = new Map();
        this.bucketHits = new Map();
        this.rows = 12;
        this.mults = [];
        this.running = false;
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(canvas.parentElement);
        this.resize();
    }

    setLayout(rows, mults) {
        this.rows = rows;
        this.mults = mults;
        this.balls = [];
        this.pegHits.clear();
        this.bucketHits.clear();
        this.layout();
        this.draw(performance.now());
    }

    resize() {
        const box = this.canvas.parentElement.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = Math.max(200, box.width);
        this.H = Math.max(200, box.height);
        this.canvas.width = Math.round(this.W * dpr);
        this.canvas.height = Math.round(this.H * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.layout();
        this.draw(performance.now());
    }

    layout() {
        const { W, H, rows } = this;
        const bucketH = Math.max(26, Math.min(44, H * 0.075));
        const top = H * 0.09;
        const bottomRoom = bucketH + 22;
        const h0 = H - top - bottomRoom;
        // ecart horizontal / vertical des picots ~1.18 ; si la largeur manque, on tasse le triangle
        const s = Math.min((W - 36) / (rows + 1.6), (h0 / (rows + 0.2)) * 1.18);
        const vsp = s / 1.18;
        this.top = top + (h0 - vsp * (rows + 0.2)) / 2;
        this.vs = vsp;
        this.s = s;
        this.cx = W / 2;
        this.pegR = Math.max(2.4, s * 0.1);
        this.ballR = Math.max(4.5, s * 0.24);
        this.bucketH = bucketH;
        this.bucketY = this.rowY(rows - 1) + vsp * 0.62;
    }

    rowY(r) { return this.top + r * this.vs; }
    pegX(r, j) { return this.cx + (j - (r + 2) / 2) * this.s; }
    bucketX(k) { return this.cx + (k - this.rows / 2) * this.s; }

    /** points de contact de la bille pour un chemin donne */
    route(path) {
        const pts = [{ x: this.cx + (Math.random() - 0.5) * this.s * 0.08, y: this.top - this.vs * 1.1, peg: null }];
        let rights = 0;
        for (let r = 0; r < this.rows; r++) {
            const j = rights + 1;
            const jitter = (Math.random() - 0.5) * this.s * 0.1;
            pts.push({ x: this.pegX(r, j) + jitter, y: this.rowY(r) - this.pegR - this.ballR * 0.85, peg: [r, j] });
            rights += path[r];
        }
        pts.push({ x: this.bucketX(rights), y: this.bucketY + this.bucketH * 0.35, bucket: rights });
        return pts;
    }

    /**
     * Ajoute une bille.
     * opts: { path, color, label, mine, onPeg(row), onLand(bucket) }
     */
    addBall(opts) {
        const pts = this.route(opts.path);
        const speed = reduceMotion ? 0.35 : 1;
        this.balls.push({
            ...opts,
            pts,
            seg: 0,
            t: 0,
            segDur: (i) => (i === 0 ? 260 : i === pts.length - 2 ? 190 : 118) * speed * (opts.mine ? 1 : 0.9),
            trail: [],
            x: pts[0].x,
            y: pts[0].y,
            last: performance.now(),
        });
        this.start();
    }

    start() {
        if (this.running) return;
        this.running = true;
        const tick = (now) => {
            this.step(now);
            this.draw(now);
            const busy = this.balls.length
                || [...this.pegHits.values()].some((t) => now - t < 400)
                || [...this.bucketHits.values()].some((t) => now - t < 600);
            if (busy) requestAnimationFrame(tick);
            else this.running = false;
        };
        requestAnimationFrame(tick);
    }

    step(now) {
        for (const b of this.balls) {
            let dt = now - b.last;
            b.last = now;
            while (dt > 0 && b.seg < b.pts.length - 1) {
                const dur = b.segDur(b.seg);
                const need = (1 - b.t) * dur;
                if (dt >= need) {
                    dt -= need;
                    b.seg++;
                    b.t = 0;
                    const p = b.pts[b.seg];
                    if (p.peg) {
                        this.pegHits.set(p.peg.join(','), now);
                        b.onPeg?.(p.peg[0]);
                    }
                    if (p.bucket !== undefined) {
                        this.bucketHits.set(p.bucket, now);
                        b.done = true;
                        b.onLand?.(p.bucket, { x: p.x, y: this.bucketY });
                    }
                } else {
                    b.t += dt / dur;
                    dt = 0;
                }
            }
            if (!b.done) {
                const a = b.pts[b.seg];
                const c = b.pts[b.seg + 1];
                const t = b.t;
                const hop = b.seg === 0 ? 0 : this.vs * 0.42;
                b.x = lerp(a.x, c.x, t);
                b.y = a.y + (c.y - a.y) * t * t - hop * 4 * t * (1 - t) * (b.seg === b.pts.length - 2 ? 0.4 : 1);
                b.trail.push([b.x, b.y]);
                if (b.trail.length > 7) b.trail.shift();
            }
        }
        this.balls = this.balls.filter((b) => !b.done);
    }

    draw(now) {
        const { ctx, W, H, rows } = this;
        ctx.clearRect(0, 0, W, H);

        // picots
        for (let r = 0; r < rows; r++) {
            const y = this.rowY(r);
            for (let j = 0; j < r + 3; j++) {
                const x = this.pegX(r, j);
                const hit = this.pegHits.get(`${r},${j}`);
                const glow = hit ? Math.max(0, 1 - (now - hit) / 380) : 0;
                if (glow > 0) {
                    const halo = ctx.createRadialGradient(x, y, 0, x, y, this.pegR * (1.5 + glow * 2.2));
                    halo.addColorStop(0, `rgba(255, 220, 140, ${0.75 * glow})`);
                    halo.addColorStop(1, 'rgba(255, 190, 80, 0)');
                    ctx.fillStyle = halo;
                    ctx.beginPath();
                    ctx.arc(x, y, this.pegR * (1.5 + glow * 2.2), 0, Math.PI * 2);
                    ctx.fill();
                }
                const g = ctx.createRadialGradient(x - this.pegR * 0.35, y - this.pegR * 0.4, this.pegR * 0.1, x, y, this.pegR);
                g.addColorStop(0, glow > 0 ? '#fff6d8' : COLORS.brassHi);
                g.addColorStop(0.55, COLORS.brass);
                g.addColorStop(1, COLORS.brassLo);
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(x, y, this.pegR, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // godets
        const bw = this.s * 0.9;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fontSize = Math.max(9, Math.min(15, bw * (rows === 16 ? 0.3 : 0.32)));
        ctx.font = `700 ${fontSize}px Bricolage, system-ui, sans-serif`;
        for (let k = 0; k <= rows; k++) {
            const x = this.bucketX(k);
            const hit = this.bucketHits.get(k);
            const e = hit ? Math.max(0, 1 - (now - hit) / 550) : 0;
            const dip = Math.sin(e * Math.PI) * this.bucketH * 0.22;
            const y = this.bucketY + dip;
            const color = bucketColor(k, rows);
            // ombre portee
            ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
            roundRect(ctx, x - bw / 2, y + 4, bw, this.bucketH, 7);
            ctx.fill();
            ctx.fillStyle = color;
            roundRect(ctx, x - bw / 2, y, bw, this.bucketH, 7);
            ctx.fill();
            // reflet
            ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
            roundRect(ctx, x - bw / 2 + 2, y + 2, bw - 4, this.bucketH * 0.32, 5);
            ctx.fill();
            if (e > 0) {
                ctx.fillStyle = `rgba(255, 255, 255, ${0.45 * e})`;
                roundRect(ctx, x - bw / 2, y, bw, this.bucketH, 7);
                ctx.fill();
            }
            ctx.fillStyle = COLORS.lacquer;
            const m = this.mults[k];
            if (m !== undefined) ctx.fillText(multLabel(m), x, y + this.bucketH / 2 + 1);
        }

        // billes
        for (const b of this.balls) {
            const r = this.ballR * (b.mine ? 1 : 0.85);
            b.trail.forEach(([tx, ty], i) => {
                ctx.fillStyle = withAlpha(b.color, (i / b.trail.length) * 0.22);
                ctx.beginPath();
                ctx.arc(tx, ty, r * (0.5 + i / b.trail.length * 0.4), 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.ellipse(b.x + 2, b.y + r * 0.9, r * 0.8, r * 0.35, 0, 0, Math.PI * 2);
            ctx.fill();
            const g = ctx.createRadialGradient(b.x - r * 0.4, b.y - r * 0.45, r * 0.1, b.x, b.y, r);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.35, b.color);
            g.addColorStop(1, shade(b.color));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
            ctx.fill();
            if (b.label) {
                ctx.font = `600 11px Bricolage, system-ui, sans-serif`;
                ctx.fillStyle = 'rgba(247, 235, 215, 0.85)';
                ctx.fillText(b.label, b.x, b.y - r - 9);
            }
        }
    }

    /** texte qui monte au-dessus d'un godet */
    pop(text, x, kind) {
        const el = document.createElement('div');
        el.className = `pop ${kind}`;
        el.textContent = text;
        el.style.left = `${x}px`;
        el.style.top = `${this.bucketY - 18}px`;
        this.pops.appendChild(el);
        setTimeout(() => el.remove(), 1200);
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function withAlpha(color, a) {
    if (color.startsWith('hsl(')) return color.replace('hsl(', 'hsla(').replace(')', `, ${a})`);
    const [r, g, b] = hex(color);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function shade(color) {
    if (color.startsWith('hsl(')) return color.replace(/(\d+)%\)$/, (m, l) => `${Math.max(10, Number(l) - 28)}%)`);
    return mix(color, '#2a1a05', 0.55);
}
