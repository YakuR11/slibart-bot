// Boutique : cadres d'avatar a 500 RB (drapeaux, decorations, anneaux) + GIF perso de victoire (1000 RB).
import { el, fmt } from '../ui.js';
import { SKINS, PRICE, GIF_PRICE, avatarEl } from '../avatar.js';

const GROUPS = [
    { key: 'deco', label: 'Décorations', test: (s) => s.look.kind === 'deco' },
    { key: 'flag', label: 'Drapeaux', test: (s) => s.look.kind === 'flag' },
    { key: 'ring', label: 'Anneaux', test: (s) => ['none', 'ring', 'glow', 'fire', 'rainbow'].includes(s.look.kind) },
    { key: 'gif', label: 'GIF de victoire', test: () => false },
];

export class ShopView {
    constructor(page, app) {
        this.app = app;
        this.page = page;
        this.group = 'deco';
        this.owned = new Set();
        this.equipped = {};
        this.confirm = null;
        this.tabs = el('div.seg.shop-slots');
        this.grid = el('div.shop-grid');
        this.sub = el('p', { text: '' });
        page.append(
            el('div.shop-head', {}, el('div', {}, el('h2', { text: 'Boutique' }), this.sub), this.tabs),
            this.grid,
            el('p.shop-note', { text: `Tous les cadres sont à ${PRICE} RB. Certains ne s'achètent pas : ils tombent des coffres du bot (=ouvrir) 🎁` }),
        );
        this.tabs.replaceChildren(...GROUPS.map((g) => el('button', {
            type: 'button', role: 'tab', 'aria-checked': String(g.key === this.group), text: g.label,
            onclick: (e) => {
                this.group = g.key;
                for (const b of this.tabs.children) b.setAttribute('aria-checked', String(b === e.currentTarget));
                this.render();
            },
        })));
        this.grid.addEventListener('click', (e) => this.onClick(e));
    }

    async show(on) {
        if (!on) return;
        const r = await this.app.api('api/shop');
        if (!r.ok) return this.app.toast(r.data.error || 'Boutique indisponible', true);
        this.owned = new Set(r.data.owned);
        this.equipped = r.data.equipped;
        this.app.setBalance(r.data.balance);
        this.gif = await this.app.req('gif.get');
        this.render();
    }

    render() {
        if (this.group === 'gif') return this.renderGif();
        this.sub.textContent = 'Ton cadre est visible par tout le monde : vocal, centre des paris, carte, profils.';
        const me = this.app.me();
        const items = Object.entries(SKINS).filter(([, s]) => GROUPS.find((g) => g.key === this.group).test(s))
            .sort((a, b) => (a[1].default ? -1 : b[1].default ? 1 : (a[1].chest ? 1 : 0) - (b[1].chest ? 1 : 0)));
        this.grid.replaceChildren(...items.map(([id, s]) => {
            const card = el('article.skin', { dataset: { id } });
            if (this.equipped.frame === id) card.classList.add('on');
            const prev = el('div.skin-prev', {}, avatarEl({ ...me, skins: { frame: id } }, 76));
            const btn = el('button.skin-btn', { type: 'button' });
            this.setButton(btn, id, s);
            card.append(prev, el('div.skin-meta', {}, el('b', { text: s.name }), s.chest ? el('span.rar', { text: 'coffre' }) : null), btn);
            return card;
        }));
    }

    setButton(btn, id, s) {
        btn.className = 'skin-btn';
        btn.disabled = false;
        if (this.equipped.frame === id) {
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
            btn.textContent = this.confirm === id ? `Confirmer ${PRICE} ?` : `${PRICE} RB`;
            if (this.confirm === id) btn.classList.add('confirm');
            if (PRICE > this.app.balance()) btn.classList.add('poor');
        }
    }

    async onClick(e) {
        const btn = e.target.closest('.skin-btn');
        if (!btn || btn.disabled) return;
        const id = btn.closest('.skin').dataset.id;
        this.app.sound.unlock();
        if (this.owned.has(id)) return this.equip(id);
        if (this.confirm !== id) {
            if (PRICE > this.app.balance()) {
                this.app.sound.error();
                return this.app.toast('Pas assez de Rokbux.', true);
            }
            this.confirm = id;
            clearTimeout(this.confirmT);
            this.confirmT = setTimeout(() => { this.confirm = null; this.render(); }, 3500);
            return this.render();
        }
        this.confirm = null;
        btn.disabled = true;
        const r = await this.app.api('api/shop/buy', { id });
        if (!r.ok) {
            this.app.sound.error();
            this.app.toast(r.data.error || 'Achat impossible', true);
            return this.render();
        }
        this.owned = new Set(r.data.owned);
        this.app.setBalance(r.data.balance);
        this.app.sound.purchase();
        this.app.toast(`🖼️ ${SKINS[id].name} est à toi !`);
        await this.equip(id, true);
    }

    async equip(id, quiet = false) {
        const r = await this.app.api('api/shop/equip', { id });
        if (!r.ok) return this.app.toast(r.data.error || 'Impossible d\'équiper', true);
        this.equipped = r.data.equipped;
        this.app.onSkins(this.equipped);
        if (!quiet) this.app.sound.equip();
        this.render();
    }

    // -----------------------------------------------------------------------
    renderGif() {
        this.sub.textContent = 'Quand tu gagnes gros (mise ≥ 2000 ou tapis), TON GIF s\'affiche chez tout le monde et dans #bot.';
        const g = this.gif || {};
        if (!g.owned) {
            this.grid.replaceChildren(el('article.gif-card', {},
                el('div.gif-prev.empty', { text: '🎬' }),
                el('b', { text: 'GIF de victoire perso' }),
                el('p', { text: 'Achète-le une fois, change de GIF quand tu veux.' }),
                el('button.skin-btn', { type: 'button', text: this.confirm === 'gif' ? `Confirmer ${fmt(GIF_PRICE)} ?` : `${fmt(GIF_PRICE)} RB`, onclick: () => this.buyGif() })));
            return;
        }
        const input = el('input.gif-input', { type: 'url', placeholder: 'https://media.tenor.com/… .gif', value: g.url || '' });
        const prev = el('div.gif-prev', {}, g.url ? el('img', { src: `gifp?u=${encodeURIComponent(g.url)}`, alt: '' }) : el('span', { text: 'Pas encore de GIF' }));
        this.grid.replaceChildren(el('article.gif-card.owned', {},
            prev,
            el('b', { text: 'Ton GIF de victoire' }),
            el('p', { text: 'Dans Discord : clic droit sur un GIF → Copier le lien, puis colle-le ici (Tenor ou Giphy).' }),
            input,
            el('div.gif-actions', {},
                el('button.skin-btn.own', { type: 'button', text: 'Enregistrer', onclick: () => this.saveGif(input.value) }),
                g.url ? el('button.skin-btn.chest', { type: 'button', text: 'Retirer', onclick: () => this.saveGif('') }) : null)));
    }

    async buyGif() {
        if (this.confirm !== 'gif') {
            if (GIF_PRICE > this.app.balance()) return this.app.toast('Pas assez de Rokbux.', true);
            this.confirm = 'gif';
            setTimeout(() => { this.confirm = null; if (this.group === 'gif') this.render(); }, 3500);
            return this.render();
        }
        this.confirm = null;
        const r = await this.app.api('api/shop/buy', { id: 'perk:gif' });
        if (!r.ok) return this.app.toast(r.data.error || 'Achat impossible', true);
        this.app.setBalance(r.data.balance);
        this.app.sound.purchase();
        this.gif = await this.app.req('gif.get');
        this.render();
    }

    async saveGif(url) {
        const r = await this.app.req('gif.set', { url });
        if (r.error) return this.app.toast(r.error, true);
        this.gif = await this.app.req('gif.get');
        this.app.sound.equip();
        this.app.toast(r.url ? '🎬 GIF enregistré !' : 'GIF retiré.');
        this.render();
    }
}
