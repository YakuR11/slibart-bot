// Carte du quartier : une maison fixe par membre, sa pp et son nom au-dessus, ses caves dessinees
// en dessous. Plus il a de RB, plus la maison est grande (max +10 % a 10 000) et plus elle brille.
import { el, fmt } from '../ui.js';
import { decoImage } from '../avatar.js';

const ROOFS = ['#c8553d', '#3d6bc8', '#4f9d69', '#8e5bc4', '#d18b2c', '#c43d7a', '#2c9fa8', '#7a6a5a'];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export class MapView {
    constructor(page, app) {
        this.app = app;
        this.page = page;
        this.canvas = el('canvas.mp-canvas');
        this.tip = el('div.mp-tip', { hidden: true });
        this.wrap = el('div.mp-wrap', {}, this.canvas, this.tip);
        page.append(el('div.wk-head', {}, el('h2', { text: 'Le quartier' }), el('p.wk-info', { text: 'Clique sur une maison pour voir le profil. Plus t\'as de RB, plus ta maison brille.' })), this.wrap);
        this.data = null;
        this.imgs = new Map();
        this.hover = null;
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(this.wrap);
        this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
        this.canvas.addEventListener('mouseleave', () => { this.hover = null; this.tip.hidden = true; });
        this.canvas.addEventListener('click', (e) => {
            const h = this.hit(e);
            if (h) this.app.openProfile(h.id);
        });
    }

    async show(on) {
        this.visible = on;
        if (!on) return;
        this.resize();
        const r = await this.app.req('map');
        if (r.error) return this.app.toast(r.error, true);
        this.data = r;
        for (const h of r.houses) {
            if (!this.imgs.has(h.avatar)) {
                const img = new Image();
                img.src = h.avatar;
                img.onload = () => this.draw(performance.now());
                this.imgs.set(h.avatar, img);
            }
        }
        this.loop();
    }

    resize() {
        const box = this.wrap.getBoundingClientRect();
        if (!box.width) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = box.width;
        this.H = box.height;
        this.canvas.width = Math.round(this.W * dpr);
        this.canvas.height = Math.round(this.H * dpr);
        this.ctx = this.canvas.getContext('2d');
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** monde 1000 x 700 -> ecran */
    get k() { return Math.min(this.W / 1000, this.H / 700); }
    get ox() { return (this.W - 1000 * this.k) / 2; }
    get oy() { return (this.H - 700 * this.k) / 2; }
    sx(x) { return this.ox + x * this.k; }
    sy(y) { return this.oy + y * this.k; }

    scaleOf(h) { return 1 + 0.1 * Math.min(1, Math.max(0, h.rb) / 10000); }

    hit(e) {
        if (!this.data) return null;
        const r = this.canvas.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        return this.data.houses.find((h) => Math.abs(x - this.sx(h.x)) < 44 * this.k && y > this.sy(h.y) - 80 * this.k && y < this.sy(h.y) + 40 * this.k) || null;
    }

    onMove(e) {
        const h = this.hit(e);
        this.hover = h;
        this.canvas.style.cursor = h ? 'pointer' : 'default';
        if (!h) { this.tip.hidden = true; return; }
        this.tip.hidden = false;
        this.tip.replaceChildren(el('b', { text: h.name }), el('span', { text: `${fmt(h.rb)} RB · ${h.caves} cave${h.caves > 1 ? 's' : ''} · ${h.slaves} esclave${h.slaves > 1 ? 's' : ''}` }), el('small', { text: h.street || '' }));
        const r = this.wrap.getBoundingClientRect();
        this.tip.style.left = `${Math.min(r.width - 220, e.clientX - r.left + 14)}px`;
        this.tip.style.top = `${e.clientY - r.top + 14}px`;
    }

    loop() {
        if (this.running) return;
        this.running = true;
        const tick = (now) => {
            this.draw(now);
            if (this.visible) requestAnimationFrame(tick);
            else this.running = false;
        };
        requestAnimationFrame(tick);
    }

    draw(now) {
        const { ctx, k } = this;
        if (!ctx || !this.data) return;
        ctx.clearRect(0, 0, this.W, this.H);
        // herbe
        ctx.fillStyle = '#2f5d3a';
        ctx.fillRect(this.sx(0), this.sy(0), 1000 * k, 700 * k);
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        for (let i = 0; i < 120; i++) ctx.fillRect(this.sx((i * 137) % 1000), this.sy((i * 71) % 700), 3 * k, 3 * k);

        // rues
        for (const st of this.data.streets) {
            const [ax, ay] = st.a;
            const [bx, by] = st.b;
            ctx.strokeStyle = '#3b3b44';
            ctx.lineWidth = 34 * k;
            ctx.lineCap = 'square';
            ctx.beginPath();
            ctx.moveTo(this.sx(ax), this.sy(ay));
            ctx.lineTo(this.sx(bx), this.sy(by));
            ctx.stroke();
        }
        for (const st of this.data.streets) {
            const [ax, ay] = st.a;
            const [bx, by] = st.b;
            ctx.strokeStyle = 'rgba(255, 230, 150, 0.55)';
            ctx.lineWidth = 2 * k;
            ctx.setLineDash([12 * k, 12 * k]);
            ctx.beginPath();
            ctx.moveTo(this.sx(ax), this.sy(ay));
            ctx.lineTo(this.sx(bx), this.sy(by));
            ctx.stroke();
            ctx.setLineDash([]);
        }
        // noms des rues (panneaux)
        ctx.font = `700 ${Math.max(9, 11 * k)}px Bricolage, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const st of this.data.streets) {
            const horiz = st.a[1] === st.b[1];
            const x = horiz ? (st.a[0] + st.b[0]) / 2 + (st.a[1] === 330 ? -150 : 150) : st.a[0];
            const y = horiz ? st.a[1] : 330 + (st.a[0] % 200) - 60;
            ctx.save();
            ctx.translate(this.sx(x), this.sy(y));
            if (!horiz) ctx.rotate(-Math.PI / 2);
            const w = ctx.measureText(st.name).width + 14;
            ctx.fillStyle = '#1f6b3a';
            ctx.fillRect(-w / 2, -8 * k - 2, w, 16 * k + 4);
            ctx.strokeStyle = '#f7ebd7';
            ctx.lineWidth = 1;
            ctx.strokeRect(-w / 2 + 2, -8 * k, w - 4, 16 * k);
            ctx.fillStyle = '#f7ebd7';
            ctx.fillText(st.name, 0, 1);
            ctx.restore();
        }

        // terrains libres
        const taken = new Set(this.data.houses.map((h) => h.plot));
        // maisons (de haut en bas pour que les noms ne se chevauchent pas)
        for (const h of [...this.data.houses].sort((a, b) => a.y - b.y)) this.house(h, now);
        void taken;
    }

    house(h, now) {
        const { ctx, k } = this;
        const s = this.scaleOf(h) * k;
        const x = this.sx(h.x);
        const y = this.sy(h.y);
        const shine = Math.min(1, Math.max(0, h.rb) / 10000);
        const hov = this.hover?.id === h.id;
        // halo (plus de RB = plus de lumiere)
        if (shine > 0.02 || hov) {
            const pulse = 0.85 + 0.15 * Math.sin(now / 400 + h.x);
            const r = (60 + 30 * shine) * s;
            const g = ctx.createRadialGradient(x, y - 10 * s, 4, x, y - 10 * s, r);
            g.addColorStop(0, `rgba(255, 215, 106, ${(0.15 + 0.45 * shine) * pulse + (hov ? 0.2 : 0)})`);
            g.addColorStop(1, 'rgba(255, 215, 106, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y - 10 * s, r, 0, Math.PI * 2);
            ctx.fill();
        }
        const w = 46 * s;
        const hh = 30 * s;
        const roof = ROOFS[hash(h.id) % ROOFS.length];
        // murs
        ctx.fillStyle = '#efe2c8';
        ctx.fillRect(x - w / 2, y - hh, w, hh);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - w / 2, y - hh, w, hh);
        // toit
        ctx.fillStyle = roof;
        ctx.beginPath();
        ctx.moveTo(x - w / 2 - 6 * s, y - hh);
        ctx.lineTo(x, y - hh - 24 * s);
        ctx.lineTo(x + w / 2 + 6 * s, y - hh);
        ctx.closePath();
        ctx.fill();
        // porte + fenetres (allumees si riche)
        ctx.fillStyle = '#6b4a2e';
        ctx.fillRect(x - 5 * s, y - 15 * s, 10 * s, 15 * s);
        ctx.fillStyle = shine > 0.3 ? `rgba(255, 220, 120, ${0.6 + 0.4 * shine})` : '#9ec3d6';
        ctx.fillRect(x - 18 * s, y - 24 * s, 9 * s, 8 * s);
        ctx.fillRect(x + 9 * s, y - 24 * s, 9 * s, 8 * s);

        // caves sous la maison (1 dessin par cave, 8 max + le reste en texte)
        const caves = Math.min(8, h.caves);
        const cw = 10 * k;
        const startX = x - ((caves - 1) * (cw + 3 * k)) / 2;
        for (let i = 0; i < caves; i++) {
            const cx = startX + i * (cw + 3 * k);
            const cy = y + 9 * k;
            ctx.fillStyle = '#5b4b40';
            ctx.beginPath();
            ctx.arc(cx, cy + 4 * k, cw / 2 + 2 * k, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#120c0a';
            ctx.beginPath();
            ctx.arc(cx, cy + 4 * k, cw / 2 - 1 * k, Math.PI, 0);
            ctx.fill();
        }
        if (h.caves > 8) {
            ctx.fillStyle = '#f7ebd7';
            ctx.font = `700 ${Math.max(8, 9 * k)}px Bricolage, system-ui, sans-serif`;
            ctx.fillText(`+${h.caves - 8}`, startX + 8 * (cw + 3 * k) + 4 * k, y + 11 * k);
        }

        // pp + nom au-dessus
        const r = 14 * s;
        const ay = y - hh - 24 * s - r - 6 * k;
        ctx.fillStyle = h.id === this.app.me()?.id ? '#ffd76a' : '#f7ebd7';
        ctx.beginPath();
        ctx.arc(x, ay, r + 2, 0, Math.PI * 2);
        ctx.fill();
        const img = this.imgs.get(h.avatar);
        if (img?.complete && img.naturalWidth) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, ay, r, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, x - r, ay - r, r * 2, r * 2);
            ctx.restore();
        }
        const deco = decoImage(h.skins);
        if (deco?.complete) ctx.drawImage(deco, x - r / 0.72, ay - r / 0.72, (r / 0.72) * 2, (r / 0.72) * 2);
        ctx.font = `800 ${Math.max(9, 11 * k)}px Bricolage, system-ui, sans-serif`;
        const name = h.name.length > 14 ? `${h.name.slice(0, 13)}…` : h.name;
        const tw = ctx.measureText(name).width + 10;
        ctx.fillStyle = 'rgba(20, 4, 8, 0.8)';
        ctx.fillRect(x - tw / 2, ay - r - 18 * k, tw, 14 * k);
        ctx.fillStyle = h.id === this.app.me()?.id ? '#ffd76a' : '#f7ebd7';
        ctx.fillText(name, x, ay - r - 11 * k);
    }
}
