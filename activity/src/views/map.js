// Carte du quartier (modele "split pane") : la carte a gauche, la liste des voisins a droite.
// 20 maisons, pas une par membre. Sa pp et son nom au-dessus, une cave dessinee par cave en dessous.
// Plus de RB = maison un peu plus grande (+10 % max a 10 000) et plus lumineuse.
import { el, fmt } from '../ui.js';
import { avatarEl, decoImage } from '../avatar.js';
import { icon } from '../icons.js';

const ROOFS = ['#b5523b', '#3e6ea8', '#4c8a5e', '#8758b3', '#c0832b', '#b23d6f', '#2f8f97', '#7a6656'];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const html = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };
const ROAD = 34; // largeur des rues (monde)
/** 0 cabane, 1 maison, 2 villa (10 000+), 3 manoir (50 000+) */
const BLURB = 'Cabane sous 1 000 RB, maison, villa avec piscine dès 10 000, manoir dès 50 000. Les 3 plus riches ont leur médaille.';
const tierOf = (rb) => (rb >= 50000 ? 3 : rb >= 10000 ? 2 : rb >= 1000 ? 1 : 0);

export class MapView {
    constructor(page, app) {
        this.app = app;
        this.page = page;
        this.still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
        page.classList.add('mp');
        this.canvas = el('canvas');
        this.tip = el('div.mp-tip', { hidden: true, role: 'status' });
        const zoomIn = el('button.mp-zoom', { type: 'button', 'aria-label': 'Zoomer', onclick: () => this.zoomBy(1.25) }, el('span', { text: '+' }));
        const zoomOut = el('button.mp-zoom', { type: 'button', 'aria-label': 'Dézoomer', onclick: () => this.zoomBy(0.8) }, el('span', { text: '−' }));
        const recenter = el('button.mp-zoom', { type: 'button', 'aria-label': 'Voir tout le quartier', onclick: () => this.fit() }, html(icon('crosshair', 16)));
        this.wrap = el('section.mp-map', { 'aria-label': 'Carte du quartier' }, this.canvas, this.tip, el('div.mp-tools', {}, zoomIn, zoomOut, recenter));

        this.search = el('input', { id: 'mp-search', type: 'search', autocomplete: 'off', placeholder: 'Nom…' });
        this.search.addEventListener('input', () => this.renderList());
        this.list = el('ol.mp-list');
        this.count = el('span.mp-count', { text: '' });
        const side = el('aside.mp-side', {},
            el('div.mp-side-head', {}, el('h3', { text: 'Les voisins' }), this.count),
            el('label.mp-search', { for: 'mp-search' }, html(icon('search', 16)), el('span.sr', { text: 'Chercher un voisin' }), this.search),
            this.list);

        page.append(
            el('header.pg-head', {}, el('div', {}, el('h2', { text: 'Le quartier' }), this.blurb = el('p', { text: BLURB }))),
            el('div.mp-body', {}, this.wrap, side),
        );

        this.data = null;
        this.imgs = new Map();
        this.hover = null;
        this.focus = null;
        this.cam = { x: 500, y: 350, z: 1 };
        this.target = null;
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(this.wrap);
        this.bindPointer();
    }

    // -----------------------------------------------------------------------
    async show(on) {
        this.visible = on;
        if (!on) return;
        this.resize();
        // au lancement la connexion temps reel peut ne pas etre encore ouverte : on reessaie en silence
        let r = await this.app.req('map');
        for (let k = 0; k < 12 && r.error && this.visible; k++) {
            await new Promise((ok) => setTimeout(ok, 800));
            r = await this.app.req('map');
        }
        if (r.error) return this.app.toast(r.error, true);
        const first = !this.data;
        this.data = r;
        if (this.blurb) {
            this.blurb.textContent = r.full && r.you == null
                ? 'Les 20 maisons sont prises. Plus de RB fait briller une maison, ça n\'en crée pas une 21e.'
                : BLURB;
        }
        this.decor(r);
        for (const h of r.houses) {
            if (!this.imgs.has(h.avatar)) {
                const img = new Image();
                img.src = h.avatar;
                this.imgs.set(h.avatar, img);
            }
        }
        if (first) this.fit(true);
        this.renderList();
        this.loop();
    }

    /** arbres et buissons places une fois, hors des rues et des maisons */
    decor(r) {
        if (this.trees) return;
        const near = (x, y) => r.streets.some((st) => (st.a[1] === st.b[1] ? Math.abs(y - st.a[1]) < ROAD : Math.abs(x - st.a[0]) < ROAD))
            || r.houses.concat(r.plotsXY || []).some((h) => Math.abs(x - h.x) < 60 && Math.abs(y - h.y) < 60);
        let seed = 42;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        this.trees = [];
        for (let i = 0; i < 400 && this.trees.length < 70; i++) {
            const x = 20 + rand() * 960;
            const y = 20 + rand() * 660;
            if (near(x, y)) continue;
            this.trees.push({ x, y, r: 9 + rand() * 9, shade: rand() });
        }
    }

    // -----------------------------------------------------------------------
    // camera : monde 1000 x 700
    // -----------------------------------------------------------------------
    resize() {
        const box = this.wrap.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = box.width;
        this.H = box.height;
        this.canvas.width = Math.round(this.W * dpr);
        this.canvas.height = Math.round(this.H * dpr);
        this.ctx = this.canvas.getContext('2d');
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.minZ = Math.min(this.W / 1000, this.H / 700);
        if (!this.target && this.cam.z < this.minZ) this.fit(true);
    }

    fit(now = false) {
        // remplit le cadre en gardant la place des pp de la premiere rangee (le monde va de -70 a 700 en hauteur)
        const z = Math.max(this.W / 1040, this.H / 770) * 0.98;
        this.flyTo(500, 315, Math.min(z, Math.max(this.minZ || z, z)), now);
        this.focus = null;
        this.renderList();
    }

    flyTo(x, y, z, now = false) {
        if (now) {
            this.cam = { x, y, z };
            this.target = null;
        } else this.target = { x, y, z };
    }

    zoomBy(f) {
        const z = Math.max(this.minZ || 0.3, Math.min(3, (this.target?.z ?? this.cam.z) * f));
        this.flyTo(this.cam.x, this.cam.y, z);
    }

    sx(x) { return (x - this.cam.x) * this.cam.z + this.W / 2; }
    sy(y) { return (y - this.cam.y) * this.cam.z + this.H / 2; }
    wx(px) { return (px - this.W / 2) / this.cam.z + this.cam.x; }
    wy(py) { return (py - this.H / 2) / this.cam.z + this.cam.y; }

    clampCam() {
        const halfW = this.W / 2 / this.cam.z;
        const halfH = this.H / 2 / this.cam.z;
        // marge en haut : les pp et pseudos de la premiere rangee depassent du monde
        this.cam.x = halfW * 2 >= 1040 ? 500 : Math.max(halfW - 20, Math.min(1020 - halfW, this.cam.x));
        this.cam.y = halfH * 2 >= 770 ? 350 : Math.max(halfH - 70, Math.min(700 - halfH, this.cam.y));
    }

    bindPointer() {
        let drag = null;
        this.canvas.addEventListener('pointerdown', (e) => {
            drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
            this.canvas.setPointerCapture(e.pointerId);
        });
        this.canvas.addEventListener('pointermove', (e) => {
            if (drag) {
                const dx = e.clientX - drag.x;
                const dy = e.clientY - drag.y;
                if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
                if (drag.moved) {
                    this.target = null;
                    this.cam.x = drag.cx - dx / this.cam.z;
                    this.cam.y = drag.cy - dy / this.cam.z;
                    this.clampCam();
                    this.canvas.style.cursor = 'grabbing';
                    return;
                }
            }
            this.onHover(e);
        });
        this.canvas.addEventListener('pointerup', (e) => {
            const was = drag;
            drag = null;
            this.canvas.style.cursor = '';
            if (was && !was.moved) {
                const h = this.hit(e);
                if (h) this.select(h, true);
            }
        });
        this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.tip.hidden = true; });
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoomBy(e.deltaY < 0 ? 1.15 : 0.87);
        }, { passive: false });
    }

    /** rayon de la pp (monde) : au moins 24 px a l'ecran quand on dezoome, sans deborder sur les voisins */
    ppR(h) {
        return Math.min(30, Math.max(15 * this.scaleOf(h), 24 / this.cam.z));
    }

    houseBox(h) {
        const s = this.scaleOf(h);
        const z = this.cam.z;
        return { x: this.sx(h.x), y: this.sy(h.y), w: 64 * s * z, top: (70 * s + this.ppR(h) * 2 + 8) * z, bottom: 24 * s * z };
    }

    hit(e) {
        if (!this.data) return null;
        const r = this.canvas.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        return this.data.houses.find((h) => {
            const b = this.houseBox(h);
            return Math.abs(x - b.x) < b.w * 0.7 && y > b.y - b.top && y < b.y + b.bottom;
        }) || null;
    }

    onHover(e) {
        const h = this.hit(e);
        this.hover = h;
        this.canvas.style.cursor = h ? 'pointer' : 'grab';
        this.list.querySelectorAll('li').forEach((li) => li.classList.toggle('hover', li.dataset.id === h?.id));
        if (!h) { this.tip.hidden = true; return; }
        this.tip.hidden = false;
        this.tip.replaceChildren(el('b', { text: h.name }), el('span', { text: `${fmt(h.rb)} RB · ${h.caves} cave${h.caves > 1 ? 's' : ''} · ${h.slaves} esclave${h.slaves > 1 ? 's' : ''}` }), el('small', { text: h.street || '' }));
        const r = this.wrap.getBoundingClientRect();
        this.tip.style.transform = `translate(${Math.min(r.width - 230, e.clientX - r.left + 14)}px, ${Math.min(r.height - 80, e.clientY - r.top + 14)}px)`;
    }

    select(h, openProfile = false) {
        this.focus = h.id;
        this.flyTo(h.x, h.y - 40, Math.max(1.5, this.minZ * 1.7));
        this.renderList();
        if (openProfile) this.app.openProfile(h.id);
    }

    // -----------------------------------------------------------------------
    // liste des voisins
    // -----------------------------------------------------------------------
    renderList() {
        if (!this.data) return;
        const q = this.search.value.trim().toLowerCase();
        const all = [...this.data.houses].sort((a, b) => b.rb - a.rb);
        const rows = all.filter((h) => !q || h.name.toLowerCase().includes(q));
        this.count.textContent = `${this.data.houses.length}/${this.data.plots}`;
        if (!rows.length) {
            this.list.replaceChildren(el('li.mp-empty', {}, el('b', { text: q ? 'Personne avec ce nom' : 'Le quartier est vide' }),
                el('span', { text: q ? 'Essaie un autre nom.' : '20 places. Les premières partent à l\'ouverture de l\'app, ou avec =initmap.' }),
                q ? el('button.chip', { type: 'button', text: 'Effacer la recherche', onclick: () => { this.search.value = ''; this.renderList(); } }) : null));
            return;
        }
        this.list.replaceChildren(...rows.map((h) => {
            const rank = all.indexOf(h) + 1;
            const li = el('li', { dataset: { id: h.id } },
                el('span.mp-rank', { text: String(rank) }),
                avatarEl(h, 34),
                el('div.mp-who', {}, el('b', { text: h.name }), el('span', { text: h.street || '' })),
                el('div.mp-money', {}, el('b', { text: fmt(h.rb) }), el('span', { text: `${h.caves} cave${h.caves > 1 ? 's' : ''}` })));
            const btn = el('button.mp-row', { type: 'button', 'aria-label': `Voir la maison de ${h.name}`, onclick: () => this.select(h) });
            li.prepend(btn);
            if (this.focus === h.id) li.classList.add('on');
            if (h.id === this.app.me()?.id) li.classList.add('me');
            if (this.focus === h.id) {
                li.append(el('button.chip.mp-open', { type: 'button', text: 'Voir le profil', onclick: () => this.app.openProfile(h.id) }));
            }
            return li;
        }));
    }

    // -----------------------------------------------------------------------
    // dessin
    // -----------------------------------------------------------------------
    scaleOf(h) { return 1 + 0.1 * Math.min(1, Math.max(0, h.rb) / 10000); }

    loop() {
        if (this.running) return;
        this.running = true;
        let last = performance.now();
        const tick = (now) => {
            const dt = Math.min(50, now - last);
            last = now;
            if (this.target) {
                const k = 1 - Math.pow(0.001, dt / 1000);
                this.cam.x += (this.target.x - this.cam.x) * k * 4;
                this.cam.y += (this.target.y - this.cam.y) * k * 4;
                this.cam.z += (this.target.z - this.cam.z) * k * 4;
                if (Math.abs(this.target.z - this.cam.z) < 0.002 && Math.abs(this.target.x - this.cam.x) < 0.5) {
                    Object.assign(this.cam, this.target);
                    this.target = null;
                }
                this.clampCam();
            }
            this.draw(now);
            if (this.visible) requestAnimationFrame(tick);
            else this.running = false;
        };
        requestAnimationFrame(tick);
    }

    draw(now) {
        const { ctx } = this;
        if (!ctx || !this.data) return;
        const z = this.cam.z;
        const t = this.still ? 0 : now;
        ctx.clearRect(0, 0, this.W, this.H);
        ctx.fillStyle = '#0f1d18';
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.save();
        ctx.translate(this.W / 2, this.H / 2);
        ctx.scale(z, z);
        ctx.translate(-this.cam.x, -this.cam.y);

        const { xs, ys } = this.grid();
        // terrain
        ctx.fillStyle = '#16291f';
        ctx.fillRect(-200, -200, 1400, 1100);
        // ilots : bordure, trottoir, pelouse rayee
        const cols = [-120, ...xs, 1120];
        const rows = [-120, ...ys, 820];
        for (let i = 0; i < cols.length - 1; i++) {
            for (let j = 0; j < rows.length - 1; j++) {
                const x0 = cols[i] + ROAD / 2;
                const x1 = cols[i + 1] - ROAD / 2;
                const y0 = rows[j] + ROAD / 2;
                const y1 = rows[j + 1] - ROAD / 2;
                if (x1 <= x0 || y1 <= y0) continue;
                ctx.fillStyle = '#6f675c';
                roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 12);
                ctx.fill();
                ctx.fillStyle = '#857b6c';
                roundRect(ctx, x0 + 1.5, y0 + 1.5, x1 - x0 - 3, y1 - y0 - 3, 11);
                ctx.fill();
                ctx.fillStyle = '#21402f';
                roundRect(ctx, x0 + 8, y0 + 8, x1 - x0 - 16, y1 - y0 - 16, 8);
                ctx.fill();
                ctx.save();
                roundRect(ctx, x0 + 8, y0 + 8, x1 - x0 - 16, y1 - y0 - 16, 8);
                ctx.clip();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
                for (let k = x0 + 8; k < x1; k += 24) ctx.fillRect(k, y0, 12, y1 - y0);
                ctx.restore();
            }
        }
        // rues : asphalte, bordures, ligne centrale
        for (const st of this.data.streets) {
            const horiz = st.a[1] === st.b[1];
            ctx.fillStyle = '#1a1b22';
            if (horiz) ctx.fillRect(-200, st.a[1] - ROAD / 2, 1400, ROAD);
            else ctx.fillRect(st.a[0] - ROAD / 2, -200, ROAD, 1100);
        }
        ctx.strokeStyle = 'rgba(232, 198, 106, 0.5)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([9, 11]);
        for (const st of this.data.streets) {
            const horiz = st.a[1] === st.b[1];
            ctx.beginPath();
            if (horiz) { ctx.moveTo(-200, st.a[1]); ctx.lineTo(1200, st.a[1]); } else { ctx.moveTo(st.a[0], -200); ctx.lineTo(st.a[0], 900); }
            ctx.stroke();
        }
        ctx.setLineDash([]);
        // carrefours : on efface la ligne, passages pietons
        for (const x of xs) {
            for (const y of ys) {
                ctx.fillStyle = '#1a1b22';
                ctx.fillRect(x - ROAD / 2, y - ROAD / 2, ROAD, ROAD);
                ctx.fillStyle = 'rgba(240, 232, 214, 0.5)';
                for (let k = -12; k <= 12; k += 6) {
                    ctx.fillRect(x + k - 1.5, y - ROAD / 2 - 8, 3, 7);
                    ctx.fillRect(x + k - 1.5, y + ROAD / 2 + 1, 3, 7);
                    ctx.fillRect(x - ROAD / 2 - 8, y + k - 1.5, 7, 3);
                    ctx.fillRect(x + ROAD / 2 + 1, y + k - 1.5, 7, 3);
                }
            }
        }

        // terrains libres : a vendre
        const taken = new Set(this.data.houses.map((h) => h.plot));
        for (const p of this.data.plotsXY || []) if (!taken.has(p.i)) this.lot(p);

        // arbres (ombre, deux tons, reflet)
        for (const tr of this.trees || []) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.ellipse(tr.x + 3, tr.y + 5, tr.r, tr.r * 0.75, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = tr.shade > 0.5 ? '#245c3c' : '#1f5034';
            ctx.beginPath();
            ctx.arc(tr.x, tr.y, tr.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = tr.shade > 0.5 ? '#2f7449' : '#296640';
            ctx.beginPath();
            ctx.arc(tr.x - tr.r * 0.2, tr.y - tr.r * 0.25, tr.r * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }

        // voitures (sous les lampadaires, au-dessus de la route)
        this.cars(t);
        // lampadaires : flaques de lumiere chaude
        this.lamps(t);

        // plaques de rue (taille ecran) sous les maisons
        ctx.restore();
        this.signs();
        ctx.save();
        ctx.translate(this.W / 2, this.H / 2);
        ctx.scale(z, z);
        ctx.translate(-this.cam.x, -this.cam.y);
        // maisons (de haut en bas), avec leur rang
        const byRb = [...this.data.houses].sort((a, b) => b.rb - a.rb);
        const houses = [...this.data.houses].sort((a, b) => a.y - b.y);
        for (const h of houses) this.house(h, t, byRb.indexOf(h) + 1);
        ctx.restore();

        // vignette : la nuit tombe sur les bords
        const v = ctx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.35, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
        v.addColorStop(0, 'rgba(5, 10, 20, 0)');
        v.addColorStop(1, 'rgba(5, 10, 20, 0.45)');
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, this.W, this.H);
    }

    grid() {
        if (!this._grid) {
            const xs = [...new Set(this.data.streets.filter((s) => s.a[0] === s.b[0]).map((s) => s.a[0]))].sort((a, b) => a - b);
            const ys = [...new Set(this.data.streets.filter((s) => s.a[1] === s.b[1]).map((s) => s.a[1]))].sort((a, b) => a - b);
            this._grid = { xs, ys };
        }
        return this._grid;
    }

    lamps(t) {
        const { ctx } = this;
        const { xs, ys } = this.grid();
        if (!this._lamps) {
            this._lamps = [];
            for (const x of xs) for (const y of ys) this._lamps.push({ x: x + ROAD / 2 + 5, y: y - ROAD / 2 - 5 });
            // un lampadaire au milieu de chaque troncon
            for (let i = 0; i < xs.length - 1; i++) for (const y of ys) this._lamps.push({ x: (xs[i] + xs[i + 1]) / 2, y: y + ROAD / 2 + 5 });
            for (const x of xs) for (let j = 0; j < ys.length - 1; j++) this._lamps.push({ x: x - ROAD / 2 - 5, y: (ys[j] + ys[j + 1]) / 2 });
        }
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const l of this._lamps) {
            const f = 0.92 + 0.08 * Math.sin(t / 900 + l.x * 0.7 + l.y);
            const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, 44);
            g.addColorStop(0, `rgba(255, 196, 110, ${0.3 * f})`);
            g.addColorStop(1, 'rgba(255, 196, 110, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(l.x - 44, l.y - 44, 88, 88);
        }
        ctx.restore();
        for (const l of this._lamps) {
            ctx.fillStyle = '#2b2a2f';
            ctx.beginPath();
            ctx.arc(l.x, l.y, 2.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffe2a8';
            ctx.beginPath();
            ctx.arc(l.x, l.y, 1.4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    cars(t) {
        const { ctx } = this;
        if (!this._cars) {
            const COLORS = ['#e2574c', '#f2c14e', '#4c9be2', '#e8e8e8', '#7bd389', '#c77dff'];
            this._cars = this.data.streets.slice(0, 6).map((st, i) => ({ st, dir: i % 2 ? -1 : 1, speed: 0.035 + (i % 3) * 0.012, off: i * 173, c: COLORS[i % COLORS.length] }));
        }
        for (const car of this._cars) {
            const horiz = car.st.a[1] === car.st.b[1];
            const len = 1400;
            const d = ((car.off + t * car.speed) % len + len) % len;
            const pos = car.dir > 0 ? d - 200 : 1200 - d;
            const lane = car.dir > 0 ? 7 : -7;
            const x = horiz ? pos : car.st.a[0] - lane;
            const y = horiz ? car.st.a[1] + lane : (car.dir > 0 ? d - 200 : 900 - d);
            const ang = horiz ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(ang);
            // phares
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const g = ctx.createLinearGradient(8, 0, 40, 0);
            g.addColorStop(0, 'rgba(255, 240, 200, 0.35)');
            g.addColorStop(1, 'rgba(255, 240, 200, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(8, -3);
            ctx.lineTo(40, -11);
            ctx.lineTo(40, 11);
            ctx.lineTo(8, 3);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            roundRect(ctx, -8, -4, 18, 10, 3);
            ctx.fill();
            ctx.fillStyle = car.c;
            roundRect(ctx, -9, -5, 18, 10, 3);
            ctx.fill();
            ctx.fillStyle = 'rgba(20, 30, 45, 0.85)';
            ctx.fillRect(-3, -4, 6, 8);
            ctx.fillStyle = '#ff5a4f';
            ctx.fillRect(-9, -4, 1.5, 2);
            ctx.fillRect(-9, 2, 1.5, 2);
            ctx.restore();
        }
    }

    /** terrain libre : pelouse en pointilles + panneau a vendre */
    lot(p) {
        const { ctx } = this;
        ctx.strokeStyle = 'rgba(240, 232, 214, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        roundRect(ctx, p.x - 30, p.y - 34, 60, 40, 4);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#5b4632';
        ctx.fillRect(p.x - 1, p.y - 22, 2, 16);
        ctx.fillStyle = '#f0e8d6';
        roundRect(ctx, p.x - 21, p.y - 32, 42, 13, 2);
        ctx.fill();
        ctx.fillStyle = '#b5523b';
        ctx.font = '600 6.5px Bricolage, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('À VENDRE', p.x, p.y - 25.5);
    }

    house(h, t, rank) {
        const { ctx } = this;
        const s = this.scaleOf(h);
        const x = h.x;
        const y = h.y;
        const tier = tierOf(h.rb);
        const shine = Math.min(1, Math.max(0, h.rb) / 10000);
        const hot = this.hover?.id === h.id || this.focus === h.id;
        const me = h.id === this.app.me()?.id;
        const roof = ROOFS[hash(h.id) % ROOFS.length];
        const w = [40, 52, 64, 74][tier] * s;
        const hh = [24, 30, 36, 40][tier] * s;

        // halo (plus de RB = plus de lumiere ; or pour les manoirs)
        if (shine > 0.02 || hot) {
            const pulse = 0.9 + 0.1 * Math.sin(t / 600 + x);
            const r = (50 + 40 * shine + (tier === 3 ? 20 : 0)) * s;
            const col = tier === 3 ? '255, 200, 70' : '255, 215, 140';
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const g = ctx.createRadialGradient(x, y - hh / 2, 6, x, y - hh / 2, r);
            g.addColorStop(0, `rgba(${col}, ${Math.min(0.6, (0.08 + 0.35 * shine) * pulse + (hot ? 0.15 : 0))})`);
            g.addColorStop(1, `rgba(${col}, 0)`);
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - hh / 2 - r, r * 2, r * 2);
            ctx.restore();
        }
        // allee
        ctx.fillStyle = tier >= 2 ? '#cfc3a8' : '#a99c84';
        ctx.fillRect(x - 4, y, 8, 18);

        // ombre portee
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        roundRect(ctx, x - w / 2 + 5, y - hh + 5, w, hh, 2);
        ctx.fill();

        if (tier === 0) this.shack(x, y, w, hh, s, t);
        else if (tier === 1) this.home(x, y, w, hh, s, t, roof, shine);
        else if (tier === 2) this.villa(x, y, w, hh, s, t, roof);
        else this.manor(x, y, w, hh, s, t);

        if (hot) {
            ctx.strokeStyle = '#ffd76a';
            ctx.lineWidth = 2;
            roundRect(ctx, x - w / 2 - 4, y - hh - 4, w + 8, hh + 8, 4);
            ctx.stroke();
        }

        // caves : soupiraux eclaires sous la maison
        const caves = Math.min(6, h.caves);
        if (caves) {
            const cw = 8;
            const gap = 3;
            const total = caves * cw + (caves - 1) * gap;
            const y0 = y + 7;
            ctx.fillStyle = '#4b433b';
            roundRect(ctx, x - total / 2 - 4, y0, total + 8, 13, 3);
            ctx.fill();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.fillRect(x - total / 2 - 4, y0 + 10, total + 8, 3);
            for (let i = 0; i < caves; i++) {
                const cx = x - total / 2 + i * (cw + gap) + cw / 2;
                const flick = 0.75 + 0.25 * Math.sin(t / 250 + i * 2 + x);
                ctx.fillStyle = `rgba(255, 150, 60, ${flick})`;
                ctx.beginPath();
                ctx.moveTo(cx - cw / 2, y0 + 11);
                ctx.lineTo(cx - cw / 2, y0 + 6);
                ctx.arc(cx, y0 + 6, cw / 2, Math.PI, 0);
                ctx.lineTo(cx + cw / 2, y0 + 11);
                ctx.closePath();
                ctx.fill();
            }
            if (h.caves > 6) {
                ctx.font = '600 10px Bricolage, system-ui, sans-serif';
                ctx.fillStyle = '#f7ebd7';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(`+${h.caves - 6}`, x + total / 2 + 7, y0 + 7);
            }
        }

        // pp + nom au-dessus du toit ; podium : or, argent, bronze
        const roofTop = y - hh - [14, 24, 8, 22][tier] * s;
        const r = this.ppR(h);
        const ay = roofTop - r - 6;
        const RING = { 1: '#ffd24a', 2: '#d9dee6', 3: '#d08a4f' };
        ctx.fillStyle = RING[rank] || (me ? '#ffd76a' : '#f7ebd7');
        ctx.beginPath();
        ctx.arc(x, ay, r + (RING[rank] ? 3.5 : 2.5) * (r / 15) ** 0.5, 0, Math.PI * 2);
        ctx.fill();
        const img = this.imgs.get(h.avatar);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, ay, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#0a3533';
        ctx.fillRect(x - r, ay - r, r * 2, r * 2);
        if (img?.complete && img.naturalWidth) ctx.drawImage(img, x - r, ay - r, r * 2, r * 2);
        ctx.restore();
        const deco = decoImage(h.skins);
        // le cadre est un carre de 100 ou la pp occupe un cercle de rayon 36 : demi-cote = r * 50 / 36
        const half = (r * 50) / 36;
        if (deco?.complete) ctx.drawImage(deco, x - half, ay - half, half * 2, half * 2);
        // le nom passe au-dessus du cadre (oreilles, couronne...) au lieu d'etre cache dessous
        const nameY = ay - (deco ? half * 0.92 : r) - 5;
        if (rank === 1) this.crown(x + r * 0.7, ay - r * 0.85, r / 15);
        else if (RING[rank]) {
            // pastille de rang
            ctx.fillStyle = RING[rank];
            ctx.beginPath();
            ctx.arc(x + r * 0.78, ay + r * 0.72, r * 0.38, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#2a1408';
            ctx.font = `600 ${r * 0.5}px Bricolage, system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(rank), x + r * 0.78, ay + r * 0.72 + 0.5);
        }
        // prestige : etoile violette avec le niveau
        if (h.prestige > 0) {
            const px = x - r * 0.8;
            const py = ay + r * 0.72;
            const k = r * 0.46;
            ctx.fillStyle = '#b48cff';
            ctx.strokeStyle = '#2a1050';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const a = -Math.PI / 2 + (i * Math.PI) / 5;
                const rr = i % 2 ? k * 0.48 : k;
                ctx.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#1a0838';
            ctx.font = `600 ${r * 0.42}px Bricolage, system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(h.prestige), px, py + 0.5);
        }
        // nom : texte avec contour, 13 a 16 px a l'ecran
        const fs = Math.max(13, Math.min(16, 13 * this.cam.z * 0.9)) / this.cam.z;
        ctx.font = `600 ${fs}px Bricolage, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4 / this.cam.z;
        ctx.strokeStyle = 'rgba(10, 4, 8, 0.9)';
        const name = h.name.length > 16 ? `${h.name.slice(0, 15)}…` : h.name;
        ctx.strokeText(name, x, nameY);
        ctx.fillStyle = RING[rank] && rank === 1 ? '#ffd24a' : me ? '#ffd76a' : '#f7ebd7';
        ctx.fillText(name, x, nameY);
    }

    crown(x, y, s) {
        const { ctx } = this;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(0.35);
        ctx.scale(s, s);
        ctx.fillStyle = '#ffd24a';
        ctx.strokeStyle = '#7a4a08';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-8, 4);
        ctx.lineTo(-9, -5);
        ctx.lineTo(-4, -1);
        ctx.lineTo(0, -8);
        ctx.lineTo(4, -1);
        ctx.lineTo(9, -5);
        ctx.lineTo(8, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#e2574c';
        ctx.beginPath();
        ctx.arc(0, 1, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    smoke(x, y, s, t) {
        if (this.still) return;
        const { ctx } = this;
        for (let k = 0; k < 3; k++) {
            const p = ((t / 2400 + k / 3) % 1);
            ctx.fillStyle = `rgba(200, 200, 210, ${0.28 * (1 - p)})`;
            ctx.beginPath();
            ctx.arc(x + Math.sin(p * 4 + k) * 3 * s, y - p * 22 * s, (2.5 + p * 4) * s, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /** < 1 000 RB : cabane en planches, toit de tole, fenetre condamnee */
    shack(x, y, w, hh, s) {
        const { ctx } = this;
        ctx.fillStyle = '#7a5434';
        ctx.fillRect(x - w / 2, y - hh, w, hh);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        for (let k = x - w / 2 + 5; k < x + w / 2; k += 5) {
            ctx.beginPath();
            ctx.moveTo(k, y - hh);
            ctx.lineTo(k, y);
            ctx.stroke();
        }
        // tole de travers
        ctx.fillStyle = '#8f969c';
        ctx.beginPath();
        ctx.moveTo(x - w / 2 - 5 * s, y - hh + 2 * s);
        ctx.lineTo(x + w / 2 + 4 * s, y - hh - 10 * s);
        ctx.lineTo(x + w / 2 + 6 * s, y - hh - 4 * s);
        ctx.lineTo(x - w / 2 - 3 * s, y - hh + 6 * s);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#a0623a';
        ctx.fillRect(x + w * 0.1, y - hh - 6 * s, 6 * s, 3 * s);
        // porte + fenetre en croix
        ctx.fillStyle = '#3e2a1a';
        ctx.fillRect(x - 4 * s, y - 13 * s, 8 * s, 13 * s);
        ctx.fillStyle = '#20262c';
        ctx.fillRect(x - w / 2 + 5 * s, y - hh + 7 * s, 8 * s, 7 * s);
        ctx.strokeStyle = '#b08850';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - w / 2 + 5 * s, y - hh + 7 * s);
        ctx.lineTo(x - w / 2 + 13 * s, y - hh + 14 * s);
        ctx.moveTo(x - w / 2 + 13 * s, y - hh + 7 * s);
        ctx.lineTo(x - w / 2 + 5 * s, y - hh + 14 * s);
        ctx.stroke();
    }

    /** 1 000 a 10 000 : maison a deux pans, cheminee qui fume */
    home(x, y, w, hh, s, t, roof, shine) {
        const { ctx } = this;
        const roofH = 24 * s;
        ctx.fillStyle = '#efe3cb';
        ctx.fillRect(x - w / 2, y - hh, w, hh);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(x, y - hh, w / 2, hh);
        ctx.fillStyle = '#6b5446';
        ctx.fillRect(x + w * 0.2, y - hh - roofH * 0.85, 7 * s, 12 * s);
        this.smoke(x + w * 0.2 + 3.5 * s, y - hh - roofH * 0.85, s, t);
        ctx.fillStyle = roof;
        ctx.beginPath();
        ctx.moveTo(x - w / 2 - 6 * s, y - hh);
        ctx.lineTo(x, y - hh - roofH);
        ctx.lineTo(x, y - hh);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = shadeHex(roof, -0.25);
        ctx.beginPath();
        ctx.moveTo(x + w / 2 + 6 * s, y - hh);
        ctx.lineTo(x, y - hh - roofH);
        ctx.lineTo(x, y - hh);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#6b4a2e';
        roundRect(ctx, x - 5 * s, y - 16 * s, 10 * s, 16 * s, 2 * s);
        ctx.fill();
        this.windows(x, y, s, [[-19, -24], [10, -24]], shine > 0.25, t);
    }

    /** 10 000 a 50 000 : villa a toit plat, piscine qui scintille */
    villa(x, y, w, hh, s, t, roof) {
        const { ctx } = this;
        // piscine a droite
        const px = x + w / 2 + 4 * s;
        ctx.fillStyle = '#d9d3c4';
        roundRect(ctx, px - 2 * s, y - 20 * s, 20 * s, 22 * s, 3 * s);
        ctx.fill();
        const wave = 0.5 + 0.5 * Math.sin(t / 500 + x);
        ctx.fillStyle = `rgb(${50 + wave * 20}, ${170 + wave * 30}, ${220 + wave * 20})`;
        roundRect(ctx, px, y - 18 * s, 16 * s, 18 * s, 2 * s);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(px + 3 * s, y - (12 - wave * 3) * s);
        ctx.lineTo(px + 13 * s, y - (10 - wave * 2) * s);
        ctx.stroke();
        // deux etages
        ctx.fillStyle = '#f4efe6';
        ctx.fillRect(x - w / 2, y - hh, w, hh);
        ctx.fillStyle = '#e4dccd';
        ctx.fillRect(x - w / 2 + 6 * s, y - hh - 8 * s, w * 0.6, 8 * s);
        ctx.fillStyle = roof;
        ctx.fillRect(x - w / 2 - 3 * s, y - hh - 2 * s, w + 6 * s, 4 * s);
        ctx.fillRect(x - w / 2 + 4 * s, y - hh - 10 * s, w * 0.6 + 4 * s, 3 * s);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(x, y - hh, w / 2, hh);
        // grande baie vitree eclairee
        ctx.fillStyle = '#ffd88a';
        ctx.fillRect(x - w / 2 + 6 * s, y - 14 * s, w * 0.45, 10 * s);
        ctx.strokeStyle = 'rgba(80, 60, 30, 0.5)';
        ctx.lineWidth = 1;
        for (let k = 1; k < 4; k++) {
            const lx = x - w / 2 + 6 * s + (w * 0.45 * k) / 4;
            ctx.beginPath();
            ctx.moveTo(lx, y - 14 * s);
            ctx.lineTo(lx, y - 4 * s);
            ctx.stroke();
        }
        ctx.fillStyle = '#4a3324';
        ctx.fillRect(x + w * 0.18, y - 15 * s, 9 * s, 15 * s);
        this.windows(x, y, s, [[-w / 2 / s + 8, -30], [4, -30], [w / 2 / s - 16, -30]], true, t);
    }

    /** 50 000 et plus : manoir a colonnes, toit dore */
    manor(x, y, w, hh, s, t) {
        const { ctx } = this;
        const roofH = 22 * s;
        ctx.fillStyle = '#f6efe0';
        ctx.fillRect(x - w / 2, y - hh, w, hh);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(x, y - hh, w / 2, hh);
        // toit noir a liseré or
        ctx.fillStyle = '#2a2230';
        ctx.beginPath();
        ctx.moveTo(x - w / 2 - 6 * s, y - hh);
        ctx.lineTo(x - w / 4, y - hh - roofH);
        ctx.lineTo(x + w / 4, y - hh - roofH);
        ctx.lineTo(x + w / 2 + 6 * s, y - hh);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffd24a';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        // fronton
        ctx.fillStyle = '#efe6d2';
        ctx.beginPath();
        ctx.moveTo(x - 14 * s, y - hh);
        ctx.lineTo(x, y - hh - 11 * s);
        ctx.lineTo(x + 14 * s, y - hh);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#c9a54a';
        ctx.lineWidth = 1;
        ctx.stroke();
        // colonnes
        ctx.fillStyle = '#fffaf0';
        for (const k of [-12, -5, 5, 12]) ctx.fillRect(x + k * s - 1.5 * s, y - hh + 2 * s, 3 * s, hh - 4 * s);
        ctx.fillStyle = '#3a2618';
        roundRect(ctx, x - 3 * s, y - 13 * s, 6 * s, 13 * s, 3 * s);
        ctx.fill();
        this.windows(x, y, s, [[-w / 2 / s + 5, -30], [-w / 2 / s + 5, -16], [w / 2 / s - 13, -30], [w / 2 / s - 13, -16]], true, t);
        // lanternes dorees de part et d'autre de la porte
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const k of [-19, 19]) {
            const g = ctx.createRadialGradient(x + k * s, y - 6 * s, 0, x + k * s, y - 6 * s, 10 * s);
            g.addColorStop(0, 'rgba(255, 210, 90, 0.7)');
            g.addColorStop(1, 'rgba(255, 210, 90, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(x + k * s - 10 * s, y - 16 * s, 20 * s, 20 * s);
        }
        ctx.restore();
        this.smoke(x + w / 4 - 4 * s, y - hh - roofH, s, t);
    }

    windows(x, y, s, list, lit, t) {
        const { ctx } = this;
        list.forEach(([dx, dy], i) => {
            const on = lit && (this.still || Math.sin(t / 3000 + i * 1.7 + x) > -0.85);
            ctx.fillStyle = on ? '#ffd88a' : '#4c6577';
            ctx.fillRect(x + dx * s, y + dy * s, 8 * s, 7 * s);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.fillRect(x + dx * s + 3.6 * s, y + dy * s, 0.8 * s, 7 * s);
        });
    }

    /** plaques de rue vertes, a taille fixe a l'ecran, en bord de carte visible */
    signs() {
        const { ctx } = this;
        ctx.font = '600 12px Bricolage, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        for (const st of this.data.streets) {
            const horiz = st.a[1] === st.b[1];
            let x;
            let y;
            if (horiz) {
                y = this.sy(st.a[1]);
                x = Math.max(80, Math.min(this.W - 80, this.sx(120)));
                if (y < 12 || y > this.H - 12) continue;
            } else {
                x = this.sx(st.a[0]);
                y = Math.max(60, Math.min(this.H - 60, this.sy(st.a[0] % 3 === 0 ? 60 : 640)));
                if (x < 12 || x > this.W - 12) continue;
            }
            ctx.save();
            ctx.translate(x, y);
            if (!horiz) ctx.rotate(-Math.PI / 2);
            const w = ctx.measureText(st.name).width + 16;
            ctx.fillStyle = '#1d6b3c';
            roundRect(ctx, -w / 2, -10, w, 20, 4);
            ctx.fill();
            ctx.strokeStyle = 'rgba(247, 235, 215, 0.9)';
            ctx.lineWidth = 1;
            roundRect(ctx, -w / 2 + 2.5, -7.5, w - 5, 15, 3);
            ctx.stroke();
            ctx.fillStyle = '#f7ebd7';
            ctx.fillText(st.name, 0, 1);
            ctx.restore();
        }
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

function shadeHex(c, k) {
    const n = parseInt(c.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + k))));
    return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}
