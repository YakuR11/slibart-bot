// Boutique de skins : apercu anime de chaque skin, achat (avec confirmation) et equipement.
import { SKINS, RARITIES, SLOTS, paintBall, paintTrail, withAlpha } from './looks.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.trunc(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ');

export class ShopView {
    /** opts: { api(path, body), toast, sound, onBalance(bal), onEquip(equipped), me(), avatarImg(url), balance() } */
    constructor(opts) {
        this.o = opts;
        this.slot = 'ball';
        this.owned = new Set();
        this.equipped = {};
        this.cards = [];
        this.visible = false;
        this.confirm = null;
        this.renderSlots();
        $('shop-grid').addEventListener('click', (e) => this.onClick(e));
    }

    async load() {
        const { ok, data } = await this.o.api('api/shop');
        if (!ok) return this.o.toast(data.error || 'Boutique indisponible', true);
        this.owned = new Set(data.owned);
        this.equipped = data.equipped;
        this.o.onEquip(this.equipped, true);
        this.o.onBalance(data.balance);
        this.render();
    }

    show(on) {
        this.visible = on;
        if (on) {
            this.load();
            this.animate();
        }
    }

    renderSlots() {
        const el = $('shop-slots');
        el.replaceChildren(...Object.entries(SLOTS).map(([k, s]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.role = 'tab';
            b.textContent = s.label;
            b.dataset.slot = k;
            b.setAttribute('aria-checked', String(k === this.slot));
            b.addEventListener('click', () => {
                this.slot = k;
                for (const x of el.children) x.setAttribute('aria-checked', String(x === b));
                this.render();
            });
            return b;
        }));
    }

    render() {
        const grid = $('shop-grid');
        $('shop-sub').textContent = SLOTS[this.slot].hint;
        const items = Object.entries(SKINS)
            .filter(([, s]) => s.slot === this.slot)
            .sort((a, b) => (a[1].default ? -1 : b[1].default ? 1 : RARITIES[a[1].rarity].rank - RARITIES[b[1].rarity].rank || priceOf(a) - priceOf(b)));
        this.cards = [];
        grid.replaceChildren(...items.map(([id, s]) => {
            const card = document.createElement('article');
            card.className = 'skin';
            card.style.setProperty('--r', RARITIES[s.rarity].color);
            card.dataset.id = id;
            if (this.equipped[s.slot] === id) card.classList.add('on');

            const prev = document.createElement('div');
            prev.className = 'skin-prev';
            const canvas = document.createElement('canvas');
            prev.append(canvas);
            if (s.slot === 'board') {
                prev.style.background = `radial-gradient(90% 70% at 50% 25%, ${s.look.felt2}, ${s.look.felt})`;
            }
            if (s.slot === 'frame') {
                const img = document.createElement('img');
                img.className = 'av';
                img.src = this.o.me()?.avatar || '';
                img.alt = '';
                img.dataset.frame = s.look.kind;
                if (s.look.colors) {
                    img.style.setProperty('--f1', s.look.colors[0]);
                    img.style.setProperty('--f2', s.look.colors[1] || s.look.colors[0]);
                }
                prev.append(img);
            }

            const meta = document.createElement('div');
            meta.className = 'skin-meta';
            const name = document.createElement('b');
            name.textContent = s.name;
            const rar = document.createElement('span');
            rar.className = 'rar';
            rar.textContent = RARITIES[s.rarity].label;
            meta.append(name, rar);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'skin-btn';
            this.setButton(btn, id, s);
            card.append(prev, meta, btn);
            this.cards.push({ id, s, canvas, t0: Math.random() * 1000 });
            return card;
        }));
        this.sizeCanvases();
    }

    setButton(btn, id, s) {
        btn.disabled = false;
        btn.className = 'skin-btn';
        if (this.equipped[s.slot] === id) {
            btn.textContent = 'Équipé ✓';
            btn.disabled = true;
            btn.classList.add('eq');
        } else if (this.owned.has(id)) {
            btn.textContent = 'Équiper';
            btn.classList.add('own');
        } else if (s.chest) {
            btn.textContent = '🎁 Coffres';
            btn.disabled = true;
            btn.classList.add('chest');
        } else {
            const p = RARITIES[s.rarity].price;
            btn.textContent = this.confirm === id ? `Confirmer ${fmt(p)} ?` : `${fmt(p)} RB`;
            if (this.confirm === id) btn.classList.add('confirm');
            if (p > this.o.balance()) btn.classList.add('poor');
        }
    }

    async onClick(e) {
        const btn = e.target.closest('.skin-btn');
        if (!btn || btn.disabled) return;
        const id = btn.closest('.skin').dataset.id;
        const s = SKINS[id];
        this.o.sound.unlock();
        if (this.owned.has(id)) return this.equip(id);
        // achat en 2 clics, pour eviter les accidents
        if (this.confirm !== id) {
            if (RARITIES[s.rarity].price > this.o.balance()) {
                this.o.sound.error();
                return this.o.toast('Pas assez de Rokbux pour ce skin.', true);
            }
            this.confirm = id;
            clearTimeout(this.confirmT);
            this.confirmT = setTimeout(() => { this.confirm = null; this.render(); }, 3500);
            return this.render();
        }
        this.confirm = null;
        btn.disabled = true;
        const { ok, data } = await this.o.api('api/shop/buy', { id });
        if (!ok) {
            this.o.sound.error();
            this.o.toast(data.error || 'Achat impossible', true);
            return this.render();
        }
        this.owned = new Set(data.owned);
        this.o.onBalance(data.balance);
        this.o.sound.purchase();
        this.o.toast(`🎨 ${s.name} est à toi !`);
        await this.equip(id, true);
        const card = $('shop-grid').querySelector(`[data-id="${CSS.escape(id)}"]`);
        card?.classList.add('bought');
    }

    async equip(id, quiet = false) {
        const { ok, data } = await this.o.api('api/shop/equip', { id });
        if (!ok) return this.o.toast(data.error || 'Impossible d\'équiper', true);
        this.equipped = data.equipped;
        this.o.onEquip(this.equipped);
        if (!quiet) this.o.sound.equip();
        this.render();
    }

    sizeCanvases() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (const c of this.cards) {
            const box = c.canvas.parentElement.getBoundingClientRect();
            c.w = box.width || 160;
            c.h = box.height || 100;
            c.canvas.width = Math.round(c.w * dpr);
            c.canvas.height = Math.round(c.h * dpr);
            c.canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }

    animate() {
        if (this.raf) return;
        const tick = (now) => {
            if (!this.visible) { this.raf = null; return; }
            for (const c of this.cards) this.drawPreview(c, now);
            this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
    }

    drawPreview(c, now) {
        const ctx = c.canvas.getContext('2d');
        const { w, h, s } = c;
        if (!w) return;
        ctx.clearRect(0, 0, w, h);
        const t = (now + c.t0) / 1000;
        if (s.slot === 'ball') {
            const y = h / 2 + Math.sin(t * 3) * 6;
            paintBall(ctx, w / 2, y, Math.min(w, h) * 0.2, s.look, now);
        } else if (s.slot === 'trail') {
            // la bille dessine un 8
            const trail = [];
            for (let i = 14; i >= 0; i--) {
                const u = t * 2.2 - i * 0.07;
                trail.push([w / 2 + Math.sin(u) * w * 0.3, h / 2 + Math.sin(u * 2) * h * 0.2]);
            }
            const ball = { kind: 'grad', colors: ['#fff6d8', '#ffd76a', '#8a5a12'] };
            paintTrail(ctx, trail, 7, ball, s.look, now, null);
            const [x, y] = trail[trail.length - 1];
            paintBall(ctx, x, y, 7, ball, now);
        } else if (s.slot === 'board') {
            const rows = 4;
            for (let r = 0; r < rows; r++) {
                for (let j = 0; j < r + 3; j++) {
                    const x = w / 2 + (j - (r + 2) / 2) * 18;
                    const y = h * 0.22 + r * 16;
                    if (s.look.neon) {
                        ctx.fillStyle = withAlpha(s.look.neon, 0.3);
                        ctx.beginPath();
                        ctx.arc(x, y, 6, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    const g = ctx.createRadialGradient(x - 1, y - 1, 0.4, x, y, 3);
                    g.addColorStop(0, s.look.peg[0]);
                    g.addColorStop(0.55, s.look.peg[1]);
                    g.addColorStop(1, s.look.peg[2]);
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }
}

function priceOf([, s]) { return s.chest ? 1e12 : RARITIES[s.rarity].price; }
