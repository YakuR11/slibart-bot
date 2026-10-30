// Loterie : pot geant, compte a rebours jusqu'a 21h, achat de tickets en un clic, participants.
import { el, fmt, gameShell } from '../ui.js';
import { avatarEl } from '../avatar.js';

export class LotoView {
    constructor(view, app) {
        this.app = app;
        const { stage, console: c } = gameShell(view, 'Loto');
        this.stage = stage;
        stage.classList.add('lt-stage');
        this.pot = el('div.lt-pot', { text: '…' });
        this.count = el('div.lt-count', { text: '' });
        this.mine = el('div.lt-mine', { text: '' });
        this.list = el('ol.lt-list');
        stage.append(el('div.lt-title', { text: '🎟️ Tirage du jour' }), this.pot, this.count, this.mine, this.list);
        this.btns = [1, 5, 10, 25, 'max'].map((n) => el('button.lt-btn', {
            type: 'button', onclick: () => this.buy(n),
        }, el('b', { text: n === 'max' ? 'MAX' : `+${n}` }), el('span', { text: n === 'max' ? 'tout ce que tu peux' : `${fmt(n * 100)} RB` })));
        c.append(el('span.field-label', { text: 'Acheter des tickets (100 RB)' }), el('div.lt-btns', {}, ...this.btns),
            el('p.hint', { text: 'Tirage tous les jours à 21h. Plus tu as de tickets, plus tu as de chances. Max 100 par tirage.' }));
        this.timer = setInterval(() => this.tick(), 1000);
    }

    async show() {
        const r = await this.app.req('loto.state');
        if (r.error) return;
        this.state = r;
        this.render();
    }

    tick() {
        if (!this.state) return;
        const left = Math.max(0, this.state.next - Date.now());
        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        const s = Math.floor((left % 60000) / 1000);
        this.count.textContent = `Tirage dans ${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }

    render() {
        const st = this.state;
        this.pot.textContent = `${fmt(st.pot)} RB`;
        const pct = st.total ? ((st.mine / st.total) * 100).toFixed(1) : 0;
        this.mine.textContent = st.mine ? `Tu as ${st.mine} ticket${st.mine > 1 ? 's' : ''} · ${pct} % de chances` : 'Tu n\'as pas encore de ticket';
        this.list.replaceChildren(...(st.top.length ? st.top.map((p) => el('li', {},
            avatarEl(p, 28, { onClick: (id) => this.app.openProfile(id) }),
            el('b', { text: p.name }),
            el('div.lt-bar', {}, el('i', { style: { width: `${(p.tickets / Math.max(1, st.total)) * 100}%` } })),
            el('span', { text: `${p.tickets} 🎟️` }))) : [el('li.empty', { text: 'Personne… le premier a toutes les chances !' })]));
        this.tick();
    }

    async buy(n) {
        if (this.busy) return;
        this.busy = true;
        this.app.sound.unlock();
        const r = await this.app.req('loto.buy', { n });
        this.busy = false;
        if (r.error) return this.app.toast(r.error, true);
        this.app.setBalance(r.balance);
        this.app.sound.chip(true);
        const box = this.pot.getBoundingClientRect();
        this.app.fx.emojis('🎟️', box.left + box.width / 2, box.top + box.height, Math.min(12, r.n), 0.6);
        this.pot.classList.remove('bump');
        void this.pot.offsetWidth;
        this.pot.classList.add('bump');
        this.app.toast(`🎟️ ${r.n} ticket${r.n > 1 ? 's' : ''} acheté${r.n > 1 ? 's' : ''} (${r.have} au total)`);
        this.show();
    }
}
