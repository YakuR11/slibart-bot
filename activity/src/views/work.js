// Page Work (modele "dashboard") : bande de chiffres, la mine en grand, les 3 actions, le journal.
// Chaque action est cliquable n fois par minute (n = nombre d'esclaves, 1 minimum).
import { el, fmt } from '../ui.js';
import { icon } from '../icons.js';

const KINDS = {
    work: { label: 'Work', verb: 'Travailler', icon: 'briefcase', hint: 'Morceaux du salaire de =work' },
    gw: { label: 'Gamblework', verb: 'Parier', icon: 'dice', hint: 'Morceaux du =gw de la demi-heure' },
    mine: { label: 'Mine', verb: 'Miner', icon: 'gem', hint: 'Une pioche par minute, partagée avec =mine' },
};
const FOUND = { pierre: 'pierre', or: 'or', diamant: 'diamant', roknit: 'roknit' };
const ORE = { pierre: '#a1958c', or: '#ffd76a', diamant: '#7fe8ff', roknit: '#ff8fd0' };
const rnd = (a, b) => a + Math.random() * (b - a);
const html = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };

export class WorkView {
    constructor(page, app) {
        this.app = app;
        this.page = page;
        this.session = 0;
        this.clicks = 0;
        this.log = [];
        page.classList.add('wk');

        // --- entete + bande de chiffres
        this.kpi = {};
        const kpi = (key, label, ic) => {
            const v = el('b.wk-kpi-v', { text: '–' });
            this.kpi[key] = v;
            return el('div.wk-kpi', {}, html(icon(ic, 18)), el('span.wk-kpi-l', { text: label }), v);
        };
        page.append(
            el('header.wk-head', {},
                el('div', {}, el('h2', { text: 'Work' }), el('p', { text: 'Les clics prennent le même salaire que =work et =gw. La mine est la même pioche que =mine, une fois par minute.' }))),
            el('div.wk-kpis', {}, kpi('slaves', 'Esclaves', 'users'), kpi('rate', 'Clics / min par action', 'zap'), kpi('session', 'Gagné cette session', 'coins'), kpi('next', 'Prochain clic', 'timer')),
        );

        // --- la mine
        this.canvas = el('canvas');
        this.pops = el('div.wk-pops');
        this.scene = el('section.wk-scene', { 'aria-label': 'La mine' }, this.canvas, this.pops);

        // --- les actions
        this.rows = {};
        const actions = el('section.wk-actions', { 'aria-label': 'Actions' });
        for (const [k, v] of Object.entries(KINDS)) {
            const meter = el('div.wk-meter');
            const est = el('span.wk-est', { text: '' });
            const status = el('span.wk-status', { text: '' });
            const bar = el('i');
            const btn = el('button.wk-go', { type: 'button', onclick: () => this.click(k) }, el('span', { text: v.verb }), html(icon('arrow', 16)));
            const row = el('article.wk-action', {},
                el('div.wk-ic', {}, html(icon(v.icon, 22))),
                el('div.wk-main', {}, el('h3', { text: v.label }), el('p', { text: v.hint })),
                btn,
                el('div.wk-info', {}, el('div.wk-line', {}, est, status), meter, el('div.wk-cd', {}, bar)));
            this.rows[k] = { row, btn, meter, est, status, bar };
            actions.append(row);
        }

        // --- journal
        this.logList = el('ol.wk-log');
        const logBox = el('section.wk-logbox', { 'aria-label': 'Derniers clics' }, el('h3', { text: 'Derniers clics' }), this.logList);

        page.append(el('div.wk-body', {}, this.scene, el('div.wk-side', {}, actions, logBox)));
        this.renderLog();

        this.men = [];
        this.parts = [];
        this.ore = [];
        this.cart = { fill: 0, bump: 0 };
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(this.scene);
        this.state = null;
        setInterval(() => this.refresh(), 15000);
        setInterval(() => this.renderCounts(), 500);
    }

    async refresh() {
        const r = await this.app.req('work.state');
        if (!r.error) this.apply(r);
    }

    apply(r) {
        this.state = { ...r, at: Date.now() };
        const want = Math.max(1, Math.min(6, r.slaves || 1));
        while (this.men.length < want) this.men.push({ phase: Math.random() * 6, speed: rnd(0.85, 1.15), boost: 0 });
        this.men.length = want;
        this.kpi.slaves.textContent = fmt(r.slaves);
        this.kpi.rate.textContent = `${r.n}`;
        for (const k of Object.keys(KINDS)) {
            const e = r.est?.[k] || 0;
            this.rows[k].est.textContent = `≈ ${e >= 10 ? fmt(e) : e.toFixed(1).replace('.', ',')} RB par clic`;
        }
        this.renderCounts();
    }

    left(k) {
        const s = this.state?.kinds?.[k];
        if (!s) return 0;
        if (s.left > 0) return s.left;
        return s.next && Date.now() >= s.next ? 1 : 0;
    }

    available() {
        return !!this.state && Object.keys(KINDS).some((k) => this.left(k) > 0);
    }

    renderCounts() {
        if (!this.state) return;
        const n = this.state.n;
        let soonest = Infinity;
        for (const k of Object.keys(KINDS)) {
            const s = this.state.kinds[k];
            const left = this.left(k);
            const r = this.rows[k];
            const cap = s.cap || n;
            const windowMs = s.windowMs || 60000;
            r.btn.disabled = left <= 0;
            r.row.classList.toggle('ready', left > 0);
            // jauge : une case par clic de la fenetre
            if (r.meter.children.length !== Math.min(cap, 30)) r.meter.replaceChildren(...Array.from({ length: Math.min(cap, 30) }, () => el('i')));
            [...r.meter.children].forEach((c, i) => c.classList.toggle('on', i < left));
            if (left > 0) {
                r.status.textContent = `${left}/${cap} dispo`;
                r.bar.style.transform = 'scaleX(1)';
            } else {
                const wait = Math.max(0, (s.next || 0) - Date.now());
                soonest = Math.min(soonest, wait);
                r.status.textContent = s.note || `recharge ${Math.ceil(wait / 1000)} s`;
                r.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - wait / windowMs))})`;
            }
            if (left > 0) soonest = 0;
        }
        this.kpi.next.textContent = soonest === 0 ? 'maintenant' : soonest === Infinity ? '–' : `${Math.ceil(soonest / 1000)} s`;
        this.kpi.session.textContent = `${this.session > 0 ? '+' : ''}${fmt(this.session)} RB`;
        this.app.setWorkBang(this.available());
    }

    renderLog() {
        if (!this.log.length) {
            this.logList.replaceChildren(el('li.wk-empty', {}, el('b', { text: 'Rien pour l\'instant' }), el('span', { text: 'Clique sur une action pour commencer à gagner des RB.' })));
            return;
        }
        this.logList.replaceChildren(...this.log.map((l) => el('li', {},
            el('span.wk-t', { text: l.time }),
            el('span.wk-what', { text: l.text }),
            el('b', { text: `+${fmt(l.gain)}` }))));
    }

    async click(kind) {
        const row = this.rows[kind];
        row.btn.disabled = true;
        const r = await this.app.req('work.click', { kind });
        if (r.kinds) this.apply(r);
        if (r.error) return this.app.toast(r.error === 'Repose-toi un peu…' ? 'Plus de clic dispo pour cette action, attends la recharge.' : r.error, true);
        this.app.setBalance(r.balance, r.gain > 0);
        this.session += r.gain;
        this.clicks++;
        const what = kind === 'mine' ? FOUND[r.what] || 'pierre' : null;
        this.log.unshift({
            time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            text: kind === 'mine' ? `Mine · ${what}${r.chest ? ' + coffre' : ''}` : KINDS[kind].label,
            gain: r.gain,
        });
        this.log.length = Math.min(this.log.length, 8);
        this.renderLog();
        this.renderCounts();
        this.hit(kind, r, what);
    }

    /** un mineur frappe fort, du minerai vole jusqu'au wagonnet */
    hit(kind, r, what) {
        const i = Math.floor(Math.random() * this.men.length);
        const m = this.men[i];
        if (m) m.boost = 1;
        const p = this.manPos(i);
        const color = kind === 'mine' ? ORE[what] : kind === 'gw' ? '#ffb627' : '#ffd76a';
        for (let k = 0; k < 10; k++) this.parts.push({ x: p.wall, y: p.y - 30 * p.S, vx: rnd(-0.2, 0.05), vy: rnd(-0.35, -0.05), life: rnd(400, 800), age: 0, c: color, s: rnd(2, 4) });
        // un caillou part dans le wagonnet
        this.ore.push({ x: p.wall - 10, y: p.y - 30 * p.S, tx: this.cartX() + rnd(-18, 18), ty: this.floor() - 46, t: 0, c: color });
        const pop = el('div.wk-pop', { text: r.gain ? `+${fmt(r.gain)} RB` : (r.what ? `+ ${r.what}` : '+0 RB') });
        pop.style.left = `${p.x}px`;
        pop.style.top = `${p.y - 96}px`;
        this.pops.append(pop);
        setTimeout(() => pop.remove(), 1200);
        if (kind === 'mine' && (what === 'roknit' || what === 'diamant')) {
            this.app.fx.flash(ORE[what], 0.35);
            this.app.sound.win(what === 'roknit' ? 3 : 1);
        } else this.app.sound.pickaxe();
        if (r.chest) this.app.toast('Un coffre était caché dans la roche (=ouvrir).');
    }

    show(on) {
        this.visible = on;
        if (on) {
            this.refresh();
            this.resize();
            this.loop();
        }
    }

    // -----------------------------------------------------------------------
    // dessin de la mine
    // -----------------------------------------------------------------------
    resize() {
        const box = this.scene.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = box.width;
        this.H = box.height;
        this.canvas.width = Math.round(this.W * dpr);
        this.canvas.height = Math.round(this.H * dpr);
        this.ctx = this.canvas.getContext('2d');
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // decor fixe : roche et filons tires une fois
        this.rock = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.7, w: rnd(18, 60), h: rnd(8, 22), a: rnd(-0.4, 0.4), l: Math.random() }));
        this.veins = Array.from({ length: 16 }, () => ({ x: rnd(0.08, 0.92), y: rnd(0.25, 0.62), c: Math.random() < 0.15 ? ORE.diamant : Math.random() < 0.4 ? ORE.or : '#d9c3a5', r: rnd(1.5, 3.2) }));
    }

    floor() { return this.H * 0.8; }
    cartX() { return this.W * 0.88; }

    manPos(i) {
        const n = this.men.length;
        const span = this.W * 0.6;
        const x = this.W * 0.08 + (span / n) * (i + 0.42);
        // les mineurs grandissent avec la scene, sans se chevaucher
        const S = Math.max(1, Math.min(this.H / 300, span / n / 92, 2));
        this.S = S;
        return { x, y: this.floor(), wall: x + 34 * S, S };
    }

    loop() {
        if (this.running) return;
        this.running = true;
        let last = performance.now();
        const tick = (now) => {
            const dt = Math.min(50, now - last);
            last = now;
            this.draw(now, dt);
            if (this.visible) requestAnimationFrame(tick);
            else this.running = false;
        };
        requestAnimationFrame(tick);
    }

    draw(now, dt) {
        const { ctx, W, H } = this;
        if (!ctx) return;
        const F = this.floor();
        ctx.clearRect(0, 0, W, H);

        // paroi du fond : brun chaud, plus sombre en haut
        const bg = ctx.createLinearGradient(0, 0, 0, F);
        bg.addColorStop(0, '#120b09');
        bg.addColorStop(1, '#3b2a21');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, F);
        // blocs de roche (texture)
        for (const r of this.rock) {
            ctx.fillStyle = `rgba(${90 + r.l * 40}, ${70 + r.l * 28}, ${58 + r.l * 20}, 0.1)`;
            ctx.save();
            ctx.translate(r.x * W, r.y * F);
            ctx.rotate(r.a);
            ctx.beginPath();
            ctx.ellipse(0, 0, r.w, r.h, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        // strates
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.lineWidth = 2;
        for (let k = 1; k < 5; k++) {
            const y = F * (k / 5.2);
            ctx.beginPath();
            for (let x = 0; x <= W; x += 40) ctx.lineTo(x, y + Math.sin(x * 0.02 + k) * 8);
            ctx.stroke();
        }
        // filons qui scintillent
        for (const v of this.veins) {
            const tw = 0.5 + 0.5 * Math.sin(now / 400 + v.x * 20);
            ctx.globalAlpha = 0.4 + 0.6 * tw;
            ctx.fillStyle = v.c;
            ctx.beginPath();
            ctx.arc(v.x * W, v.y * F, v.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // etais en bois + lanternes
        const beams = [0.04, 0.37, 0.7];
        for (const b of beams) {
            const x = W * b;
            const span = W * 0.3;
            ctx.fillStyle = '#5a3d24';
            ctx.fillRect(x, F * 0.12, 12, F * 0.88);
            ctx.fillRect(x + span - 12, F * 0.12, 12, F * 0.88);
            ctx.fillStyle = '#6e4a2b';
            ctx.fillRect(x - 6, F * 0.1, span + 12, 14);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(x - 6, F * 0.1 + 14, span + 12, 4);
            // lanterne au milieu du linteau
            const lx = x + span / 2;
            const ly = F * 0.1 + 34;
            const fl = 0.9 + 0.1 * Math.sin(now / 110 + b * 9);
            const lg = ctx.createRadialGradient(lx, ly, 4, lx, ly, 190 * fl);
            lg.addColorStop(0, 'rgba(255, 196, 110, 0.35)');
            lg.addColorStop(1, 'rgba(255, 196, 110, 0)');
            ctx.fillStyle = lg;
            ctx.fillRect(lx - 200, ly - 60, 400, F);
            ctx.strokeStyle = '#2a1d14';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(lx, F * 0.1 + 14);
            ctx.lineTo(lx, ly - 8);
            ctx.stroke();
            ctx.fillStyle = '#2a1d14';
            ctx.fillRect(lx - 7, ly - 8, 14, 18);
            ctx.fillStyle = `rgba(255, 210, 120, ${0.85 * fl})`;
            ctx.fillRect(lx - 4, ly - 4, 8, 11);
        }

        // sol + rails
        ctx.fillStyle = '#2a1d16';
        ctx.fillRect(0, F, W, H - F);
        ctx.fillStyle = '#3a2a20';
        ctx.fillRect(0, F, W, 6);
        for (let x = 0; x < W; x += 26) {
            ctx.fillStyle = '#4b3424';
            ctx.fillRect(x, F + 16, 16, 6);
        }
        ctx.fillStyle = '#8d97a0';
        ctx.fillRect(0, F + 14, W, 3);
        ctx.fillRect(0, F + 22, W, 3);

        // wagonnet (se remplit avec les clics)
        this.cart.bump = Math.max(0, this.cart.bump - dt / 300);
        const cx = this.cartX();
        const cy = F + 10 - this.cart.bump * 4;
        const fill = Math.min(1, this.clicks / 20);
        ctx.fillStyle = '#4b5560';
        ctx.beginPath();
        ctx.moveTo(cx - 44, cy - 40);
        ctx.lineTo(cx + 44, cy - 40);
        ctx.lineTo(cx + 36, cy);
        ctx.lineTo(cx - 36, cy);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#2f363d';
        ctx.lineWidth = 2;
        ctx.stroke();
        if (fill > 0) {
            ctx.fillStyle = '#7a6a5e';
            ctx.beginPath();
            ctx.ellipse(cx, cy - 40, 42, 6 + fill * 14, 0, Math.PI, 0);
            ctx.fill();
            for (let k = 0; k < Math.round(fill * 8); k++) {
                ctx.fillStyle = k % 3 === 0 ? ORE.or : k % 5 === 0 ? ORE.diamant : '#a1958c';
                ctx.beginPath();
                ctx.arc(cx - 30 + k * 8, cy - 42 - (k % 2) * 5 - fill * 6, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.fillStyle = '#1b1f24';
        for (const wx of [cx - 24, cx + 24]) {
            ctx.beginPath();
            ctx.arc(wx, cy + 4, 8, 0, Math.PI * 2);
            ctx.fill();
        }

        // mineurs face a la paroi
        this.men.forEach((m, i) => {
            m.phase += (dt / 1000) * (4.2 + m.boost * 9) * m.speed;
            m.boost = Math.max(0, m.boost - dt / 700);
            const p = this.manPos(i);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.scale(p.S, p.S);
            const lp = { x: 0, y: 0, wall: 34, i };
            this.drawRockFace(lp, now);
            this.drawMiner(lp, m, p);
            ctx.restore();
        });

        // minerai qui vole jusqu'au wagonnet
        for (const o of this.ore) {
            o.t += dt / 650;
            const t = Math.min(1, o.t);
            const x = o.x + (o.tx - o.x) * t;
            const y = o.y + (o.ty - o.y) * t - Math.sin(t * Math.PI) * 90;
            ctx.fillStyle = o.c;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
            if (t >= 1 && !o.done) {
                o.done = true;
                this.cart.bump = 1;
            }
        }
        this.ore = this.ore.filter((o) => o.t < 1);

        // eclats
        for (const q of this.parts) {
            q.age += dt;
            q.vy += 0.0012 * dt;
            q.x += q.vx * dt;
            q.y += q.vy * dt;
            ctx.globalAlpha = Math.max(0, 1 - q.age / q.life);
            ctx.fillStyle = q.c;
            ctx.fillRect(q.x, q.y, q.s, q.s);
        }
        ctx.globalAlpha = 1;
        this.parts = this.parts.filter((q) => q.age < q.life);

        // vignette douce
        const v = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.75);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(1, 'rgba(0,0,0,0.45)');
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, W, H);
    }

    drawRockFace(p, now) {
        const { ctx } = this;
        const x = p.wall;
        const y = p.y;
        ctx.fillStyle = '#5e5047';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 6, y - 50);
        ctx.lineTo(x + 26, y - 64);
        ctx.lineTo(x + 46, y - 40);
        ctx.lineTo(x + 50, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#76665b';
        ctx.beginPath();
        ctx.moveTo(x + 10, y - 44);
        ctx.lineTo(x + 26, y - 56);
        ctx.lineTo(x + 30, y - 34);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = ORE.or;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 300 + p.i * 1.7);
        ctx.fillRect(x + 20, y - 30, 4, 4);
        ctx.fillRect(x + 32, y - 18, 3, 3);
        ctx.globalAlpha = 1;
    }

    drawMiner(p, m, real) {
        const { ctx } = this;
        const swing = (Math.sin(m.phase) + 1) / 2; // 0 leve, 1 frappe
        const hx = p.x;
        const hy = p.y - 58;
        ctx.strokeStyle = '#f2e6d0';
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // corps
        ctx.beginPath();
        ctx.arc(hx, hy, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(hx, hy + 8);
        ctx.lineTo(hx + 2, hy + 34);
        ctx.lineTo(hx - 8, hy + 58);
        ctx.moveTo(hx + 2, hy + 34);
        ctx.lineTo(hx + 12, hy + 58);
        ctx.stroke();
        // casque + lampe
        ctx.fillStyle = '#ffc400';
        ctx.beginPath();
        ctx.arc(hx, hy - 2, 9.5, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(hx - 11, hy - 3, 22, 3);
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath();
        ctx.arc(hx + 6, hy - 7, 2.4, 0, Math.PI * 2);
        ctx.fill();
        const beam = ctx.createLinearGradient(hx + 6, hy - 7, hx + 70, hy + 6);
        beam.addColorStop(0, 'rgba(255, 243, 196, 0.35)');
        beam.addColorStop(1, 'rgba(255, 243, 196, 0)');
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(hx + 6, hy - 9);
        ctx.lineTo(hx + 72, hy - 20);
        ctx.lineTo(hx + 72, hy + 26);
        ctx.closePath();
        ctx.fill();
        // bras + pioche (pivot a l'epaule)
        const a = -2.2 + swing * 2.1;
        const sx = hx + 2;
        const sy = hy + 16;
        const ex = sx + Math.cos(a) * 18;
        const ey = sy + Math.sin(a) * 18;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        const tx = ex + Math.cos(a) * 20;
        const ty = ey + Math.sin(a) * 20;
        ctx.strokeStyle = '#9b6b3e';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        const pa = a + Math.PI / 2;
        ctx.strokeStyle = '#d3dbe0';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(tx - Math.cos(pa) * 10, ty - Math.sin(pa) * 10);
        ctx.quadraticCurveTo(tx + Math.cos(a) * 5, ty + Math.sin(a) * 5, tx + Math.cos(pa) * 10, ty + Math.sin(pa) * 10);
        ctx.stroke();
        if (swing > 0.97 && Math.random() < 0.6) this.parts.push({ x: real.wall + 2, y: real.y - 34 * real.S, vx: rnd(-0.1, 0.05), vy: rnd(-0.2, -0.05), life: 300, age: 0, c: '#ffdb8a', s: 2 });
    }
}
