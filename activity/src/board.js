// Rendu du plateau : picots laiton sur feutrine, billes nacrees, godets couleur bonbon.
// La bille suit le chemin tire par le serveur (0 = gauche, 1 = droite a chaque rangee).
// Une bille peut etre lancee AVANT de connaitre son chemin : elle tombe vers le premier
// picot pendant que le serveur repond, puis suit le chemin des qu'il arrive (zero latence ressentie).

const COLORS = {
    brass: '#d9a441',
    brassHi: '#f3cf7a',
    brassLo: '#8f6420',
    lacquer: '#24070e',
};
// du centre (petit gain) vers les bords (gros multiplicateurs)
const BUCKET_STOPS = ['#f7e7a0', '#ffd25a', '#ffb627', '#ff8a3d', '#ff5a4e', '#d92f45'];
const CONFETTI = ['#ffd76a', '#ff5a4e', '#4fd1ff', '#8cff6b', '#ff6fb5', '#f7ebd7', '#b98bff'];

const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
export const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(c1, c2, t) {
    const a = hex(c1);
    const b = hex(c2);
    return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
}
export function bucketColor(k, rows) {
    const d = Math.abs(k - rows / 2) / (rows / 2); // 0 au centre, 1 au bord
    const x = d * (BUCKET_STOPS.length - 1);
    const i = Math.min(BUCKET_STOPS.length - 2, Math.floor(x));
    return mix(BUCKET_STOPS[i], BUCKET_STOPS[i + 1], x - i);
}
export function multLabel(m) {
    return m >= 100 ? `${m}` : `${m}×`;
}

export class Board {
    /**
     * @param canvas
     * @param popsEl conteneur des textes flottants (null en mode mini)
     * @param opts.mini petit plateau (tribune des potes)
     */
    constructor(canvas, popsEl, opts = {}) {
        this.mini = !!opts.mini;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.pops = popsEl;
        this.static = document.createElement('canvas');
        this.balls = [];
        this.parts = [];
        this.pegHits = new Map();
        this.bucketHits = new Map();
        this.rows = 12;
        this.mults = [];
        this.running = false;
        this.shakeAmp = 0;
        this.tenseUntil = 0;
        this.tenseLevel = 0;
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(canvas.parentElement);
        this.resize();
    }

    setLayout(rows, mults) {
        const changed = rows !== this.rows;
        this.rows = rows;
        this.mults = mults;
        if (changed) {
            // les billes deja lancees sur l'ancien plateau arrivent tout de suite (l'argent reste juste)
            for (const b of this.balls) {
                if (b.pts) {
                    b.done = true;
                    b.onLand?.(b.final, null);
                }
            }
            this.balls = this.balls.filter((b) => !b.done);
            this.pegHits.clear();
            this.bucketHits.clear();
        }
        this.layout();
        this.renderStatic();
        this.kick();
    }

    resize() {
        const box = this.canvas.parentElement.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const min = this.mini ? 60 : 200;
        this.W = Math.max(min, box.width);
        this.H = Math.max(min, box.height);
        this.dpr = dpr;
        for (const c of [this.canvas, this.static]) {
            c.width = Math.round(this.W * dpr);
            c.height = Math.round(this.H * dpr);
        }
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.layout();
        this.renderStatic();
        this.draw(performance.now());
    }

    layout() {
        const { W, H, rows, mini } = this;
        const bucketH = mini ? Math.max(9, Math.min(16, H * 0.11)) : Math.max(26, Math.min(44, H * 0.075));
        const top = H * (mini ? 0.07 : 0.09);
        const bottomRoom = bucketH + (mini ? 5 : 22);
        const h0 = H - top - bottomRoom;
        const padX = mini ? 6 : 36;
        // ecart horizontal / vertical des picots ~1.18 ; si la largeur manque, on tasse le triangle
        const s = Math.min((W - padX) / (rows + 1.6), (h0 / (rows + 0.2)) * 1.18);
        const vsp = s / 1.18;
        this.top = top + (h0 - vsp * (rows + 0.2)) / 2;
        this.vs = vsp;
        this.s = s;
        this.cx = W / 2;
        this.pegR = Math.max(mini ? 1.1 : 2.4, s * 0.1);
        this.ballR = Math.max(mini ? 2.6 : 5, s * (mini ? 0.27 : 0.24));
        this.bucketH = bucketH;
        this.bucketY = this.rowY(rows - 1) + vsp * 0.62;
        this.startY = this.top - vsp * 1.1;
    }

    rowY(r) { return this.top + r * this.vs; }
    pegX(r, j) { return this.cx + (j - (r + 2) / 2) * this.s; }
    bucketX(k) { return this.cx + (k - this.rows / 2) * this.s; }

    /** les picots ne bougent pas : dessines une fois sur un calque */
    renderStatic() {
        const c = this.static.getContext('2d');
        c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        c.clearRect(0, 0, this.W, this.H);
        for (let r = 0; r < this.rows; r++) {
            const y = this.rowY(r);
            for (let j = 0; j < r + 3; j++) {
                const x = this.pegX(r, j);
                c.fillStyle = 'rgba(0, 0, 0, 0.3)';
                c.beginPath();
                c.arc(x + this.pegR * 0.3, y + this.pegR * 0.45, this.pegR, 0, Math.PI * 2);
                c.fill();
                const g = c.createRadialGradient(x - this.pegR * 0.35, y - this.pegR * 0.4, this.pegR * 0.1, x, y, this.pegR);
                g.addColorStop(0, COLORS.brassHi);
                g.addColorStop(0.55, COLORS.brass);
                g.addColorStop(1, COLORS.brassLo);
                c.fillStyle = g;
                c.beginPath();
                c.arc(x, y, this.pegR, 0, Math.PI * 2);
                c.fill();
            }
        }
    }

    /** points de contact de la bille pour un chemin donne */
    route(path) {
        const pts = [{ x: this.cx, y: this.startY }];
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
     * Ajoute une bille. Sans path, elle attend en tombant doucement (setPath plus tard).
     * opts: { path, color, img, label, mine, onPeg(row, ball), onLand(bucket, pos), onTension(level) }
     */
    addBall(opts) {
        const now = performance.now();
        const b = {
            ...opts,
            pts: null,
            seg: 0,
            t: 0,
            trail: [],
            wait: 0,
            slow: 1,
            rights: 0,
            jx: (Math.random() - 0.5) * this.s * 0.35,
            x: this.cx,
            y: this.startY - this.vs * 0.6,
            last: now,
        };
        b.x += b.jx;
        if (opts.path) this.setPath(b, opts.path, opts);
        this.balls.push(b);
        this.kick();
        return {
            setPath: (path, o) => this.setPath(b, path, o),
            cancel: () => this.cancel(b),
            get ball() { return b; },
        };
    }

    setPath(b, path, { tension = false } = {}) {
        if (b.done) return;
        b.path = path;
        b.pts = this.route(path);
        b.pts[0] = { x: b.x, y: b.y };
        b.final = path.reduce((a, v) => a + v, 0);
        b.tension = tension && !reduceMotion;
        const dy = Math.max(1, b.pts[1].y - b.y);
        b.firstDur = Math.max(70, Math.min(260, 260 * Math.sqrt(dy / (this.vs * 1.7))));
        b.seg = 0;
        b.t = 0;
        this.kick();
    }

    cancel(b) {
        if (b.done) return;
        b.done = true;
        this.burst(b.x, b.y, { color: '#cdbb9f', n: 6, kind: 'spark', power: 0.5 });
        this.balls = this.balls.filter((x) => x !== b);
    }

    segDur(b, i) {
        const base = i === 0 ? b.firstDur : i === b.pts.length - 2 ? 190 : 118;
        return (base * (reduceMotion ? 2.2 : 1) * (b.mine ? 1 : 0.92)) / b.slow;
    }

    kick() {
        if (this.running) return;
        this.running = true;
        this.lastFrame = performance.now();
        const tick = (now) => {
            this.step(now);
            this.draw(now);
            const busy = this.balls.length || this.parts.length || this.pegHits.size
                || [...this.bucketHits.values()].some((t) => now - t < 700)
                || this.shakeAmp > 0.2 || now < this.tenseUntil + 400;
            if (busy) requestAnimationFrame(tick);
            else this.running = false;
        };
        requestAnimationFrame(tick);
    }

    // -----------------------------------------------------------------------
    // effets
    // -----------------------------------------------------------------------
    burst(x, y, { color = '#ffd76a', n = 12, kind = 'spark', power = 1 } = {}) {
        if (reduceMotion) n = Math.min(n, 4);
        if (this.parts.length > 600) return;
        for (let i = 0; i < n; i++) {
            const a = kind === 'coin' ? rand(-Math.PI * 0.85, -Math.PI * 0.15) : rand(0, Math.PI * 2);
            const v = rand(0.08, kind === 'coin' ? 0.42 : 0.3) * power;
            this.parts.push({
                kind,
                x, y,
                vx: Math.cos(a) * v,
                vy: Math.sin(a) * v - (kind === 'coin' ? 0.15 * power : 0),
                life: rand(500, 900) * (kind === 'coin' ? 1.4 : 1),
                age: 0,
                size: kind === 'coin' ? rand(3.5, 6) : kind === 'confetti' ? rand(3, 6) : rand(1.2, 2.6),
                color: kind === 'confetti' ? CONFETTI[i % CONFETTI.length] : color,
                rot: rand(0, Math.PI * 2),
                vr: rand(-0.02, 0.02),
            });
        }
        this.kick();
    }

    /** pluie de confettis sur tout le plateau */
    rain(n = 80, colors = CONFETTI) {
        if (reduceMotion) return;
        for (let i = 0; i < n; i++) {
            this.parts.push({
                kind: 'confetti',
                x: rand(0, this.W),
                y: rand(-this.H * 0.4, -10),
                vx: rand(-0.04, 0.04),
                vy: rand(0.05, 0.2),
                life: rand(1800, 3200),
                age: 0,
                size: rand(4, 8),
                color: colors[i % colors.length],
                rot: rand(0, Math.PI * 2),
                vr: rand(-0.012, 0.012),
                floaty: true,
            });
        }
        this.kick();
    }

    shake(amp) {
        if (reduceMotion) return;
        this.shakeAmp = Math.max(this.shakeAmp, amp);
        this.kick();
    }

    pop(text, x, kind, color) {
        if (!this.pops) return;
        const el = document.createElement('div');
        el.className = `pop ${kind}`;
        el.textContent = text;
        el.style.left = `${Math.max(30, Math.min(this.W - 30, x))}px`;
        el.style.top = `${this.bucketY - 18}px`;
        if (color) el.style.color = color;
        this.pops.appendChild(el);
        while (this.pops.children.length > 24) this.pops.firstChild.remove();
        setTimeout(() => el.remove(), 1300);
    }

    // -----------------------------------------------------------------------
    // simulation
    // -----------------------------------------------------------------------
    step(now) {
        const frame = Math.min(50, now - this.lastFrame);
        this.lastFrame = now;
        let tense = false;

        for (const b of this.balls) {
            let dt = now - b.last;
            b.last = now;

            // pas encore de chemin : la bille descend vers le premier picot et patiente
            if (!b.pts) {
                b.wait += dt;
                const t = Math.min(1, b.wait / 320);
                const target = this.startY + (this.rowY(0) - this.startY) * 0.55;
                b.x = this.cx + b.jx * (1 - t * 0.6);
                b.y = lerp(this.startY - this.vs * 0.6, target, 1 - (1 - t) ** 2) + Math.sin(b.wait / 70) * this.vs * 0.05 * t;
                b.trail.push([b.x, b.y]);
                if (b.trail.length > 6) b.trail.shift();
                continue;
            }

            while (dt > 0 && b.seg < b.pts.length - 1) {
                const dur = this.segDur(b, b.seg);
                const need = (1 - b.t) * dur;
                if (dt >= need) {
                    dt -= need;
                    b.seg++;
                    b.t = 0;
                    const p = b.pts[b.seg];
                    if (p.peg) {
                        const r = p.peg[0];
                        this.pegHits.set(p.peg.join(','), now);
                        this.checkTension(b, r);
                        b.onPeg?.(r, b);
                        if (b.mine && !this.mini && Math.random() < 0.5) this.burst(p.x, p.y + this.ballR, { color: '#fff1c4', n: 2, power: 0.35 });
                        b.rights += b.path[r];
                    }
                    if (p.bucket !== undefined) {
                        this.bucketHits.set(p.bucket, now);
                        b.done = true;
                        b.onLand?.(p.bucket, { x: p.x, y: this.bucketY });
                        break;
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
                if (b.trail.length > (b.mine ? 8 : 12)) b.trail.shift();
                if (b.slow < 1) tense = true;
            }
        }
        this.balls = this.balls.filter((b) => !b.done);
        if (tense) this.tenseUntil = now;

        // particules
        for (const p of this.parts) {
            p.age += frame;
            p.vy += (p.floaty ? 0.00006 : 0.0011) * frame;
            if (p.floaty) p.vx += Math.sin((p.age + p.rot * 1000) / 300) * 0.0004 * frame;
            p.x += p.vx * frame;
            p.y += p.vy * frame;
            p.rot += p.vr * frame;
        }
        this.parts = this.parts.filter((p) => p.age < p.life && p.y < this.H + 20);
        this.shakeAmp *= Math.pow(0.88, frame / 16);
        for (const [k, t] of this.pegHits) if (now - t > 420) this.pegHits.delete(k);
    }

    /**
     * Anticipation : quand MA bille arrive dans les dernieres rangees et qu'un gros godet
     * est encore atteignable, elle ralentit (et ca bat fort). Si le gros godet n'est plus
     * atteignable, elle repart a vitesse normale.
     */
    checkTension(b, r) {
        if (!b.tension || this.mini) return;
        const remaining = this.rows - r;
        if (remaining > 3) return;
        const lo = b.rights;
        const hi = b.rights + remaining;
        let best = 0;
        for (let k = lo; k <= hi; k++) best = Math.max(best, this.mults[k] || 0);
        if (best >= 10) {
            b.slow = remaining === 1 ? 0.32 : remaining === 2 ? 0.45 : 0.6;
            this.tenseLevel = best;
            b.onTension?.(best, remaining);
        } else {
            b.slow = 1;
        }
    }

    // -----------------------------------------------------------------------
    // dessin
    // -----------------------------------------------------------------------
    draw(now) {
        const { ctx, W, H, rows } = this;
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        if (this.shakeAmp > 0.2) ctx.translate(rand(-1, 1) * this.shakeAmp, rand(-1, 1) * this.shakeAmp);
        ctx.drawImage(this.static, 0, 0, W, H);

        // picots touches
        for (const [key, hit] of this.pegHits) {
            const [r, j] = key.split(',').map(Number);
            if (r >= rows) continue;
            const x = this.pegX(r, j);
            const y = this.rowY(r);
            const glow = Math.max(0, 1 - (now - hit) / 380);
            const rad = this.pegR * (1.5 + glow * 2.4);
            const halo = ctx.createRadialGradient(x, y, 0, x, y, rad);
            halo.addColorStop(0, `rgba(255, 230, 160, ${0.85 * glow})`);
            halo.addColorStop(1, 'rgba(255, 190, 80, 0)');
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `rgba(255, 248, 220, ${glow})`;
            ctx.beginPath();
            ctx.arc(x, y, this.pegR, 0, Math.PI * 2);
            ctx.fill();
        }

        this.drawBuckets(now);

        // particules
        for (const p of this.parts) {
            const a = 1 - p.age / p.life;
            ctx.globalAlpha = Math.min(1, a * 1.6);
            if (p.kind === 'coin') {
                const w = Math.abs(Math.cos(p.rot * 6)) * p.size + 0.6;
                ctx.fillStyle = '#b87a16';
                ctx.beginPath();
                ctx.ellipse(p.x, p.y, w, p.size, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffd76a';
                ctx.beginPath();
                ctx.ellipse(p.x, p.y, w * 0.72, p.size * 0.72, 0, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.kind === 'confetti') {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.rot * 3)) + 1);
                ctx.restore();
            } else {
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * a + 0.4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;

        // billes : les potes d'abord, la mienne par-dessus
        for (const b of this.balls) if (!b.mine) this.drawBall(b, now);
        for (const b of this.balls) if (b.mine) this.drawBall(b, now);
        if (!this.mini) for (const b of this.balls) if (b.label && b.pts) this.drawLabel(b);
        ctx.restore();

        // vignette d'anticipation
        if (!this.mini && now < this.tenseUntil + 400) {
            const k = Math.max(0, 1 - Math.max(0, now - this.tenseUntil) / 400);
            const pulse = 0.5 + 0.5 * Math.sin(now / 90);
            const v = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.25, W / 2, H * 0.55, Math.max(W, H) * 0.75);
            v.addColorStop(0, 'rgba(0,0,0,0)');
            v.addColorStop(1, `rgba(120, 0, 20, ${(0.35 + 0.2 * pulse) * k})`);
            ctx.fillStyle = v;
            ctx.fillRect(0, 0, W, H);
        }
    }

    drawBuckets(now) {
        const { ctx, rows } = this;
        const bw = this.s * 0.9;
        const tense = !this.mini && now < this.tenseUntil + 300;
        const pulse = 0.5 + 0.5 * Math.sin(now / 80);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fontSize = this.mini ? Math.min(9, bw * 0.34) : Math.max(9, Math.min(15, bw * (rows === 16 ? 0.3 : 0.32)));
        ctx.font = `700 ${fontSize}px Bricolage, system-ui, sans-serif`;
        const radius = this.mini ? 3 : 7;
        for (let k = 0; k <= rows; k++) {
            const x = this.bucketX(k);
            const hit = this.bucketHits.get(k);
            const e = hit ? Math.max(0, 1 - (now - hit) / 650) : 0;
            if (hit && !e) this.bucketHits.delete(k);
            const dip = Math.sin(Math.min(1, e * 1.4) * Math.PI) * this.bucketH * 0.28;
            const y = this.bucketY + dip;
            const m = this.mults[k];
            const color = bucketColor(k, rows);
            if (!this.mini) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
                roundRect(ctx, x - bw / 2, y + 4, bw, this.bucketH, radius);
                ctx.fill();
            }
            // gros godet sous tension : il clignote
            if (tense && m >= 10) {
                ctx.fillStyle = `rgba(255, 240, 180, ${0.25 + 0.45 * pulse})`;
                roundRect(ctx, x - bw / 2 - 3, y - 3, bw + 6, this.bucketH + 6, radius + 2);
                ctx.fill();
            }
            ctx.fillStyle = color;
            roundRect(ctx, x - bw / 2, y, bw, this.bucketH, radius);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
            roundRect(ctx, x - bw / 2 + 1.5, y + 1.5, bw - 3, this.bucketH * 0.32, Math.max(1, radius - 2));
            ctx.fill();
            if (e > 0) {
                ctx.fillStyle = `rgba(255, 255, 255, ${0.6 * e})`;
                roundRect(ctx, x - bw / 2, y, bw, this.bucketH, radius);
                ctx.fill();
                if (!this.mini) {
                    // colonne de lumiere au-dessus du godet
                    const g = ctx.createLinearGradient(0, y, 0, y - this.vs * 3.2);
                    g.addColorStop(0, `rgba(255, 240, 200, ${0.35 * e})`);
                    g.addColorStop(1, 'rgba(255, 240, 200, 0)');
                    ctx.fillStyle = g;
                    ctx.fillRect(x - bw / 2, y - this.vs * 3.2, bw, this.vs * 3.2);
                }
            }
            if (m !== undefined && (!this.mini || bw > 13)) {
                ctx.fillStyle = COLORS.lacquer;
                ctx.fillText(this.mini ? shortMult(m) : multLabel(m), x, y + this.bucketH / 2 + 1);
            }
        }
    }

    drawBall(b, now) {
        const { ctx } = this;
        const r = b.mine ? this.ballR : this.ballR * (b.img ? 1.12 : 0.95);
        // trainee
        const n = b.trail.length;
        b.trail.forEach(([tx, ty], i) => {
            ctx.fillStyle = withAlpha(b.color, (i / n) * (b.mine ? 0.28 : 0.4));
            ctx.beginPath();
            ctx.arc(tx, ty, r * (0.35 + (i / n) * 0.55), 0, Math.PI * 2);
            ctx.fill();
        });
        // en attente du serveur : halo qui pulse
        if (!b.pts) {
            ctx.fillStyle = withAlpha(b.color, 0.18 + 0.12 * Math.sin(now / 60));
            ctx.beginPath();
            ctx.arc(b.x, b.y, r * 1.9, 0, Math.PI * 2);
            ctx.fill();
        }
        if (b.slow < 1) {
            ctx.fillStyle = withAlpha('#fff1c4', 0.25 + 0.2 * Math.sin(now / 50));
            ctx.beginPath();
            ctx.arc(b.x, b.y, r * 2.2, 0, Math.PI * 2);
            ctx.fill();
        }
        if (!this.mini) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.ellipse(b.x + 2, b.y + r * 0.9, r * 0.8, r * 0.35, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        if (b.img && b.img.complete && b.img.naturalWidth && !this.mini) {
            ctx.fillStyle = b.color;
            ctx.beginPath();
            ctx.arc(b.x, b.y, r + 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.save();
            ctx.beginPath();
            ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(b.img, b.x - r, b.y - r, r * 2, r * 2);
            ctx.restore();
            return;
        }
        const g = ctx.createRadialGradient(b.x - r * 0.4, b.y - r * 0.45, r * 0.1, b.x, b.y, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.35, b.color);
        g.addColorStop(1, shade(b.color));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    drawLabel(b) {
        const { ctx } = this;
        ctx.font = '700 11px Bricolage, system-ui, sans-serif';
        const w = ctx.measureText(b.label).width + 10;
        const y = b.y - this.ballR * 1.12 - 13;
        ctx.fillStyle = 'rgba(20, 4, 8, 0.78)';
        roundRect(ctx, b.x - w / 2, y - 8, w, 16, 8);
        ctx.fill();
        ctx.fillStyle = b.color;
        ctx.fillText(b.label, b.x, y + 0.5);
    }
}

function shortMult(m) {
    return m >= 1000 ? '1k' : m >= 100 ? `${m}` : m >= 10 ? `${Math.round(m)}` : `${m}`;
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
    if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `, ${a})`);
    const [r, g, b] = hex(color);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function shade(color) {
    if (color.startsWith('hsl(')) return color.replace(/(\d+)%\)$/, (m, l) => `${Math.max(10, Number(l) - 28)}%)`);
    return mix(color, '#2a1a05', 0.55);
}
