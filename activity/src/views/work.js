// Page Work : une cave ou des stickmen minent sans fin, et 3 gros boutons (Work, Gamblework, Mine)
// cliquables n fois par minute (n = nombre d'esclaves).
import { el, fmt } from '../ui.js';

const KINDS = {
    work: { label: 'Work', emoji: '💼', hint: 'Petit salaire, bonus esclaves' },
    gw: { label: 'Gamblework', emoji: '🎲', hint: 'Au hasard, 25 à 100 en chat' },
    mine: { label: 'Mine', emoji: '⛏️', hint: 'Pierre, or, diamant… roknit ?' },
};
const FOUND = { pierre: '🪨', or: '🟡', diamant: '💎', roknit: '🌟' };

export class WorkView {
    constructor(page, app) {
        this.app = app;
        this.page = page;
        this.canvas = el('canvas.wk-canvas');
        this.cave = el('div.wk-cave', {}, this.canvas, el('div.wk-pops'));
        this.pops = this.cave.lastChild;
        this.btns = {};
        const row = el('div.wk-btns');
        for (const [k, v] of Object.entries(KINDS)) {
            const count = el('span.wk-count', { text: '…' });
            const b = el('button.wk-btn', { type: 'button', onclick: (e) => this.click(k, e) },
                el('span.wk-emoji', { text: v.emoji }), el('b', { text: v.label }), count, el('small', { text: v.hint }));
            this.btns[k] = { b, count };
            row.append(b);
        }
        this.info = el('p.wk-info', { text: '' });
        page.append(el('div.wk-head', {}, el('h2', { text: 'Au boulot' }), this.info), this.cave, row);
        this.stickmen = [];
        this.rocks = [];
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(this.cave);
        this.state = null;
        setInterval(() => this.refresh(), 15000);
        setInterval(() => this.renderCounts(), 1000);
    }

    async refresh() {
        const r = await this.app.req('work.state');
        if (r.error) return;
        this.apply(r);
    }

    apply(r) {
        this.state = { ...r, at: Date.now() };
        // nombre de mineurs = esclaves (max 12 dessines)
        const want = Math.max(1, Math.min(12, r.slaves || 1));
        while (this.stickmen.length < want) this.stickmen.push({ phase: Math.random() * 6, speed: 0.8 + Math.random() * 0.5, boost: 0 });
        this.stickmen.length = want;
        this.layoutMen();
        this.info.textContent = r.slaves
            ? `${r.slaves} esclave${r.slaves > 1 ? 's' : ''} → chaque bouton est cliquable ${r.n} fois par minute.`
            : 'Pas d\'esclave : 1 clic par minute et par bouton. Achète-en avec =buy slave.';
        this.renderCounts();
    }

    /** le "!" sur l'onglet Work : au moins un clic dispo */
    available() {
        if (!this.state) return false;
        return Object.keys(KINDS).some((k) => this.left(k) > 0);
    }

    left(k) {
        const s = this.state?.kinds?.[k];
        if (!s) return 0;
        if (s.left > 0) return s.left;
        return s.next && Date.now() >= s.next ? 1 : 0;
    }

    renderCounts() {
        if (!this.state) return;
        for (const k of Object.keys(KINDS)) {
            const s = this.state.kinds[k];
            const left = this.left(k);
            const { b, count } = this.btns[k];
            b.disabled = left <= 0;
            count.textContent = left > 0 ? `${left}/${this.state.n} dispo` : `dans ${Math.max(1, Math.ceil((s.next - Date.now()) / 1000))} s`;
        }
        this.app.setWorkBang(this.available());
    }

    async click(kind, ev) {
        const r = await this.app.req('work.click', { kind });
        if (r.kinds) this.apply(r);
        if (r.error) return this.app.toast(r.error, true);
        this.app.setBalance(r.balance, r.gain > 0);
        // un mineur tape plus fort, des cailloux volent
        const man = this.stickmen[Math.floor(Math.random() * this.stickmen.length)];
        if (man) man.boost = 1;
        const p = this.manPos(this.stickmen.indexOf(man));
        for (let i = 0; i < 8; i++) this.rocks.push({ x: p.x + 26, y: p.y - 10, vx: (Math.random() - 0.2) * 0.25, vy: -Math.random() * 0.35, life: 700, age: 0, c: kind === 'mine' && r.what === 'diamant' ? '#7fe8ff' : kind === 'mine' && r.what === 'or' ? '#ffd76a' : '#9a8f86' });
        const icon = kind === 'mine' ? FOUND[r.what] || '🪨' : KINDS[kind].emoji;
        const pop = el('div.wk-pop', { text: `${icon} +${fmt(r.gain)}` });
        pop.style.left = `${p.x}px`;
        pop.style.top = `${p.y - 70}px`;
        this.pops.append(pop);
        setTimeout(() => pop.remove(), 1300);
        if (kind === 'mine' && (r.what === 'roknit' || r.what === 'diamant')) {
            this.app.fx.flash(r.what === 'roknit' ? '#ffd76a' : '#7fe8ff', 0.4);
            this.app.sound.win(r.what === 'roknit' ? 3 : 1);
        } else this.app.sound.pickaxe();
        if (r.chest) this.app.toast('📦 Un coffre caché dans la roche ! (=ouvrir)');
        const btn = this.btns[kind].b;
        btn.classList.remove('hit');
        void btn.offsetWidth;
        btn.classList.add('hit');
    }

    show(on) {
        this.visible = on;
        if (on) {
            this.refresh();
            this.resize();
            this.loop();
        }
    }

    resize() {
        const box = this.cave.getBoundingClientRect();
        if (!box.width) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = box.width;
        this.H = box.height;
        this.canvas.width = Math.round(this.W * dpr);
        this.canvas.height = Math.round(this.H * dpr);
        this.ctx = this.canvas.getContext('2d');
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.layoutMen();
    }

    layoutMen() {
        this.slots = this.stickmen.map((_, i) => i);
    }

    manPos(i) {
        const n = this.stickmen.length;
        const cols = Math.min(n, 6);
        const row = Math.floor(i / cols);
        const col = i % cols;
        const span = this.W * 0.8;
        return { x: this.W * 0.1 + (span / cols) * (col + 0.5) - 20, y: this.H * 0.82 - row * 70 };
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
        ctx.clearRect(0, 0, W, H);
        // fond de cave : roche, lampes
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#1b1210');
        g.addColorStop(1, '#3a2a22');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let i = 0; i < 18; i++) {
            const x = (i * 97) % W;
            const y = (i * 53) % (H * 0.6);
            ctx.beginPath();
            ctx.ellipse(x, y, 30 + (i % 5) * 8, 14 + (i % 3) * 6, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        for (const lx of [W * 0.2, W * 0.5, W * 0.8]) {
            const fl = 0.85 + 0.15 * Math.sin(now / 90 + lx);
            const lg = ctx.createRadialGradient(lx, 30, 2, lx, 30, 160 * fl);
            lg.addColorStop(0, 'rgba(255,190,90,0.45)');
            lg.addColorStop(1, 'rgba(255,190,90,0)');
            ctx.fillStyle = lg;
            ctx.fillRect(lx - 170, 0, 340, 220);
            ctx.fillStyle = '#ffcf6a';
            ctx.beginPath();
            ctx.arc(lx, 30, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        // sol
        ctx.fillStyle = '#4a3a30';
        ctx.fillRect(0, H * 0.86, W, H * 0.14);

        // mineurs : un bloc de roche devant chacun, la pioche monte et descend sans avancer
        this.stickmen.forEach((m, i) => {
            m.phase += (dt / 1000) * (4 + m.boost * 10) * m.speed;
            m.boost = Math.max(0, m.boost - dt / 600);
            const p = this.manPos(i);
            const swing = (Math.sin(m.phase) + 1) / 2; // 0 = leve, 1 = frappe
            // le rocher
            ctx.fillStyle = '#6b5d54';
            ctx.beginPath();
            ctx.moveTo(p.x + 30, p.y + 4);
            ctx.lineTo(p.x + 42, p.y - 22);
            ctx.lineTo(p.x + 62, p.y - 26);
            ctx.lineTo(p.x + 74, p.y + 4);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#82736a';
            ctx.beginPath();
            ctx.moveTo(p.x + 44, p.y - 18);
            ctx.lineTo(p.x + 58, p.y - 22);
            ctx.lineTo(p.x + 54, p.y - 8);
            ctx.closePath();
            ctx.fill();
            // le bonhomme
            ctx.strokeStyle = '#f7ebd7';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            const hx = p.x;
            const hy = p.y - 46;
            ctx.beginPath();
            ctx.arc(hx, hy, 7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#ffc400'; // casque
            ctx.beginPath();
            ctx.arc(hx, hy - 2, 8, Math.PI, 0);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(hx, hy + 7);
            ctx.lineTo(hx, hy + 30);
            ctx.lineTo(hx - 8, hy + 46);
            ctx.moveTo(hx, hy + 30);
            ctx.lineTo(hx + 8, hy + 46);
            ctx.stroke();
            // bras + pioche
            const a = -1.9 + swing * 1.9;
            const sx = hx;
            const sy = hy + 14;
            const ex = sx + Math.cos(a) * 18;
            const ey = sy + Math.sin(a) * 18;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.strokeStyle = '#a0784e';
            ctx.lineWidth = 3;
            const tx = ex + Math.cos(a) * 18;
            const ty = ey + Math.sin(a) * 18;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.strokeStyle = '#c9d1d6';
            ctx.lineWidth = 3;
            const pa = a + Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(tx - Math.cos(pa) * 9, ty - Math.sin(pa) * 9);
            ctx.quadraticCurveTo(tx + Math.cos(a) * 4, ty + Math.sin(a) * 4, tx + Math.cos(pa) * 9, ty + Math.sin(pa) * 9);
            ctx.stroke();
            // etincelle a l'impact
            if (swing > 0.96 && Math.random() < 0.5) this.rocks.push({ x: p.x + 34, y: p.y - 14, vx: Math.random() * 0.15, vy: -Math.random() * 0.2, life: 300, age: 0, c: '#ffdb8a' });
        });

        for (const r of this.rocks) {
            r.age += dt;
            r.vy += 0.0012 * dt;
            r.x += r.vx * dt;
            r.y += r.vy * dt;
            ctx.globalAlpha = Math.max(0, 1 - r.age / r.life);
            ctx.fillStyle = r.c;
            ctx.fillRect(r.x, r.y, 3, 3);
        }
        ctx.globalAlpha = 1;
        this.rocks = this.rocks.filter((r) => r.age < r.life);
    }
}
