// Carte du quartier (modele "split pane") : la carte a gauche, la liste des voisins a droite.
// Une maison fixe par membre : sa pp et son nom au-dessus, une cave dessinee par cave en dessous.
// Plus de RB = maison un peu plus grande (+10 % max a 10 000) et plus lumineuse.
import { el, fmt } from '../ui.js';
import { avatarEl, decoImage } from '../avatar.js';
import { icon } from '../icons.js';

const ROOFS = ['#b5523b', '#3e6ea8', '#4c8a5e', '#8758b3', '#c0832b', '#b23d6f', '#2f8f97', '#7a6656'];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const html = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };
const ROAD = 34; // largeur des rues (monde)

export class MapView {
    constructor(page, app) {
        this.app = app;
        this.page = page;
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
            el('header.wk-head', {}, el('div', {}, el('h2', { text: 'Le quartier' }), el('p', { text: 'Chaque membre a sa maison. Plus il a de RB, plus elle brille.' }))),
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
        const r = await this.app.req('map');
        if (r.error) return this.app.toast(r.error, true);
        const first = !this.data;
        this.data = r;
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
        const z = Math.max(this.W / 1000, this.H / 700) * 0.98; // remplit le cadre, pas de bandes vides
        this.flyTo(500, 350, Math.min(z, Math.max(this.minZ || z, z)), now);
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
        this.cam.x = halfW * 2 >= 1000 ? 500 : Math.max(halfW, Math.min(1000 - halfW, this.cam.x));
        this.cam.y = halfH * 2 >= 700 ? 350 : Math.max(halfH, Math.min(700 - halfH, this.cam.y));
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

    houseBox(h) {
        const s = this.scaleOf(h) * this.cam.z;
        return { x: this.sx(h.x), y: this.sy(h.y), w: 52 * s, top: 60 * s + 38 * s, bottom: 24 * s };
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
        this.flyTo(h.x, h.y - 20, Math.max(1.6, this.minZ * 1.8));
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
                el('span', { text: q ? 'Essaie un autre nom.' : 'Les membres reçoivent une maison en ouvrant l\'app (ou avec =initmap).' }),
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
        ctx.clearRect(0, 0, this.W, this.H);
        // fond : herbe sombre sur tout le cadre
        ctx.fillStyle = '#1d3a2c';
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.save();
        ctx.translate(this.W / 2, this.H / 2);
        ctx.scale(z, z);
        ctx.translate(-this.cam.x, -this.cam.y);

        // terrain
        ctx.fillStyle = '#2b5440';
        ctx.fillRect(-200, -200, 1400, 1100);
        // ilots : trottoir + pelouse
        const xs = [...new Set(this.data.streets.filter((s) => s.a[0] === s.b[0]).map((s) => s.a[0]))].sort((a, b) => a - b);
        const ys = [...new Set(this.data.streets.filter((s) => s.a[1] === s.b[1]).map((s) => s.a[1]))].sort((a, b) => a - b);
        const cols = [-120, ...xs, 1120];
        const rows = [-120, ...ys, 820];
        for (let i = 0; i < cols.length - 1; i++) {
            for (let j = 0; j < rows.length - 1; j++) {
                const x0 = cols[i] + ROAD / 2;
                const x1 = cols[i + 1] - ROAD / 2;
                const y0 = rows[j] + ROAD / 2;
                const y1 = rows[j + 1] - ROAD / 2;
                if (x1 <= x0 || y1 <= y0) continue;
                ctx.fillStyle = '#b9ac93'; // trottoir
                roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 10);
                ctx.fill();
                ctx.fillStyle = '#356b4f'; // pelouse
                roundRect(ctx, x0 + 7, y0 + 7, x1 - x0 - 14, y1 - y0 - 14, 7);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.05)';
                ctx.lineWidth = 1;
                for (let k = x0 + 16; k < x1 - 8; k += 14) {
                    ctx.beginPath();
                    ctx.moveTo(k, y0 + 8);
                    ctx.lineTo(k, y1 - 8);
                    ctx.stroke();
                }
            }
        }
        // rues
        for (const st of this.data.streets) {
            const horiz = st.a[1] === st.b[1];
            ctx.fillStyle = '#2c2c34';
            if (horiz) ctx.fillRect(-200, st.a[1] - ROAD / 2, 1400, ROAD);
            else ctx.fillRect(st.a[0] - ROAD / 2, -200, ROAD, 1100);
        }
        ctx.strokeStyle = 'rgba(243, 207, 122, 0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 12]);
        for (const st of this.data.streets) {
            const horiz = st.a[1] === st.b[1];
            ctx.beginPath();
            if (horiz) { ctx.moveTo(-200, st.a[1]); ctx.lineTo(1200, st.a[1]); } else { ctx.moveTo(st.a[0], -200); ctx.lineTo(st.a[0], 900); }
            ctx.stroke();
        }
        ctx.setLineDash([]);
        // passages pietons aux carrefours
        ctx.fillStyle = 'rgba(247, 235, 215, 0.55)';
        for (const x of xs) {
            for (const y of ys) {
                for (let k = -12; k <= 12; k += 6) {
                    ctx.fillRect(x + k - 1.5, y - ROAD / 2 - 9, 3, 8);
                    ctx.fillRect(x - ROAD / 2 - 9, y + k - 1.5, 8, 3);
                }
            }
        }

        // arbres
        for (const t of this.trees || []) {
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.beginPath();
            ctx.ellipse(t.x + 4, t.y + 5, t.r, t.r * 0.8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = t.shade > 0.5 ? '#2f7a4c' : '#27693f';
            ctx.beginPath();
            ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(160, 230, 160, 0.18)';
            ctx.beginPath();
            ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.55, 0, Math.PI * 2);
            ctx.fill();
        }

        // plaques de rue (taille ecran) sous les maisons : elles ne masquent plus pp et noms
        ctx.restore();
        this.signs();
        ctx.save();
        ctx.translate(this.W / 2, this.H / 2);
        ctx.scale(z, z);
        ctx.translate(-this.cam.x, -this.cam.y);
        // maisons (de haut en bas)
        const houses = [...this.data.houses].sort((a, b) => a.y - b.y);
        for (const h of houses) this.house(h, now);
        ctx.restore();
    }

    house(h, now) {
        const { ctx } = this;
        const s = this.scaleOf(h);
        const x = h.x;
        const y = h.y;
        const shine = Math.min(1, Math.max(0, h.rb) / 10000);
        const hot = this.hover?.id === h.id || this.focus === h.id;
        const me = h.id === this.app.me()?.id;

        // lueur (plus de RB = plus de lumiere), opacite seulement
        if (shine > 0.02 || hot) {
            const pulse = 0.9 + 0.1 * Math.sin(now / 600 + x);
            const r = (56 + 34 * shine) * s;
            const g = ctx.createRadialGradient(x, y - 14 * s, 6, x, y - 14 * s, r);
            g.addColorStop(0, `rgba(255, 215, 106, ${Math.min(0.75, (0.12 + 0.5 * shine) * pulse + (hot ? 0.18 : 0))})`);
            g.addColorStop(1, 'rgba(255, 215, 106, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y - 14 * s, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // allee
        ctx.fillStyle = '#c9bca2';
        ctx.fillRect(x - 4, y, 8, 22);

        const w = 52 * s;
        const hh = 30 * s;
        const roofH = 24 * s;
        // ombre portee
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(x - w / 2 + 6, y - hh + 6, w, hh);
        // facade
        ctx.fillStyle = '#efe3cb';
        ctx.fillRect(x - w / 2, y - hh, w, hh);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(x, y - hh, w / 2, hh);
        // toit a deux pans
        const roof = ROOFS[hash(h.id) % ROOFS.length];
        ctx.fillStyle = roof;
        ctx.beginPath();
        ctx.moveTo(x - w / 2 - 6 * s, y - hh);
        ctx.lineTo(x, y - hh - roofH);
        ctx.lineTo(x, y - hh);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = shadeHex(roof, -0.22);
        ctx.beginPath();
        ctx.moveTo(x + w / 2 + 6 * s, y - hh);
        ctx.lineTo(x, y - hh - roofH);
        ctx.lineTo(x, y - hh);
        ctx.closePath();
        ctx.fill();
        // cheminee
        ctx.fillStyle = '#6b5446';
        ctx.fillRect(x + w * 0.2, y - hh - roofH * 0.85, 7 * s, 12 * s);
        // porte + fenetres (allumees si riche)
        ctx.fillStyle = '#6b4a2e';
        roundRect(ctx, x - 5 * s, y - 16 * s, 10 * s, 16 * s, 2 * s);
        ctx.fill();
        const lit = shine > 0.25;
        ctx.fillStyle = lit ? '#ffd88a' : '#8fb5c9';
        ctx.fillRect(x - 19 * s, y - 24 * s, 9 * s, 8 * s);
        ctx.fillRect(x + 10 * s, y - 24 * s, 9 * s, 8 * s);
        // contour si survol / selection
        if (hot) {
            ctx.strokeStyle = '#ffd76a';
            ctx.lineWidth = 2;
            ctx.strokeRect(x - w / 2 - 3, y - hh - 3, w + 6, hh + 6);
        }

        // caves : une arche de pierre par cave, sous la maison (8 dessinees max)
        const caves = Math.min(8, h.caves);
        if (caves) {
            const cw = 9;
            const gap = 3;
            const total = caves * cw + (caves - 1) * gap;
            const y0 = y + 8;
            ctx.fillStyle = '#4a4038';
            roundRect(ctx, x - total / 2 - 4, y0 - 2, total + 8, 14, 4);
            ctx.fill();
            for (let i = 0; i < caves; i++) {
                const cx = x - total / 2 + i * (cw + gap) + cw / 2;
                ctx.fillStyle = '#0f0a08';
                ctx.beginPath();
                ctx.arc(cx, y0 + 10, cw / 2, Math.PI, 0);
                ctx.fill();
            }
            if (h.caves > 8) {
                ctx.font = '600 12px Bricolage, system-ui, sans-serif';
                ctx.fillStyle = '#f7ebd7';
                ctx.textAlign = 'left';
                ctx.fillText(`+${h.caves - 8}`, x + total / 2 + 8, y0 + 9);
            }
        }

        // pp + nom au-dessus du toit
        const r = 15 * s;
        const ay = y - hh - roofH - r - 6;
        ctx.fillStyle = me ? '#ffd76a' : '#f7ebd7';
        ctx.beginPath();
        ctx.arc(x, ay, r + 2.5, 0, Math.PI * 2);
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
        if (deco?.complete) ctx.drawImage(deco, x - r / 0.36, ay - r / 0.36, (r / 0.36) * 2, (r / 0.36) * 2);
        // nom : texte avec contour (lisible sur l'herbe, sans etiquette decorative)
        const fs = Math.max(13, Math.min(16, 13 * this.cam.z * 0.9)) / this.cam.z; // 13 a 16 px a l'ecran
        ctx.font = `600 ${fs}px Bricolage, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4 / this.cam.z;
        ctx.strokeStyle = 'rgba(15, 4, 8, 0.85)';
        const name = h.name.length > 16 ? `${h.name.slice(0, 15)}…` : h.name;
        ctx.strokeText(name, x, ay - r - 5);
        ctx.fillStyle = me ? '#ffd76a' : '#f7ebd7';
        ctx.fillText(name, x, ay - r - 5);
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
