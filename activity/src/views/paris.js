// Paris foot et LoL, a cote du casino. Meme regles que =parier : avant le coup d'envoi, cote figee.
import { el, fmt, betBox } from '../ui.js';

const SIDE = { 1: '1', N: 'N', 2: '2' };

export class ParisView {
    constructor(page, app) {
        this.app = app;
        this.page = page;
        this.filter = 'all';
        this.stake = betBox(() => app.balance(), 10, 500, 'Mise');
        page.classList.add('pr');
        this.list = el('div.pr-list');
        this.mine = el('div.pr-mine');
        page.append(
            el('header.pg-head', {}, el('div', {},
                el('h2', { text: 'Paris' }),
                el('p', { text: 'Avant le coup d\'envoi seulement. La cote est figée sur le ticket.' }))),
            el('div.pr-bar', {},
                this.chip('all', 'Tout'),
                this.chip('foot', 'Foot'),
                this.chip('lol', 'LoL'),
                this.stake.node),
            this.list,
            el('section.pr-tickets', {}, el('h3', { text: 'Tes tickets' }), this.mine),
        );
    }

    chip(key, label) {
        const b = el('button.chip.pr-filter', { type: 'button', text: label, onclick: () => { this.filter = key; this.render(); } });
        b.dataset.f = key;
        return b;
    }

    async show(on) {
        this.visible = on;
        if (!on) return;
        // au lancement la connexion temps reel peut ne pas etre encore ouverte : on reessaie en silence
        let r = await this.app.req('sports.list');
        for (let k = 0; k < 12 && r.error && this.visible; k++) {
            await new Promise((ok) => setTimeout(ok, 800));
            r = await this.app.req('sports.list');
        }
        if (r.error) return this.app.toast(r.error, true);
        this.data = r;
        this.render();
    }

    render() {
        const rows = (this.data?.matches || []).filter((m) => this.filter === 'all' || m.source === this.filter);
        this.page.querySelectorAll('.pr-filter').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === this.filter)));
        if (!rows.length) {
            this.list.replaceChildren(el('p.pr-empty', { text: 'Aucun gros match en vue. Le calendrier se met à jour tout seul.' }));
        } else {
            this.list.replaceChildren(...rows.map((m) => this.card(m)));
        }
        const mine = this.data?.mine || [];
        this.mine.replaceChildren(...(mine.length ? mine.map((t) => {
            const side = t.pick === '1' ? t.home : t.pick === '2' ? t.away : 'Nul';
            const tag = { open: 'en cours', won: 'gagné', lost: 'perdu', void: 'remboursé' }[t.status] || t.status;
            return el('p', { text: `${t.home} – ${t.away} · ${side} @ ${Number(t.odds).toFixed(2)} · ${fmt(t.stake)} RB · ${tag}` });
        }) : [el('p.pr-empty', { text: 'Pas encore de ticket.' })]));
    }

    card(m) {
        const when = new Date(m.startAt).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
        const btn = (pick, label) => {
            const odd = m.odds[pick];
            if (!(odd > 1)) return null;
            return el('button.pr-odd', {
                type: 'button',
                disabled: !m.open,
                onclick: () => this.place(m, pick),
            }, el('b', { text: label }), el('span', { text: odd.toFixed(2) }));
        };
        return el('article.pr-card', {},
            el('div.pr-meta', {}, el('span', { text: `${m.source === 'lol' ? 'LoL' : 'Foot'} · ${m.competition}${m.detail ? ` · ${m.detail}` : ''}` }), el('span', { text: m.status === 'live' ? 'en cours' : when })),
            el('h3', { text: `${m.home}  –  ${m.away}` }),
            el('div.pr-odds', {}, btn('1', m.home), btn('N', 'Nul'), btn('2', m.away)),
            m.open ? null : el('p.pr-closed', { text: 'Mises fermées.' }));
    }

    async place(m, pick) {
        const amount = this.stake.get();
        if (!amount) return this.app.toast('Mise invalide.', true);
        this.app.sound.unlock();
        const r = await this.app.req('sports.bet', { matchId: m.id, pick: SIDE[pick], amount: String(amount) });
        if (r.error) return this.app.toast(r.error, true);
        this.app.setBalance(r.balance);
        this.app.toast(`${r.side} à ${Number(r.odds).toFixed(2)} · mise ${fmt(r.stake)} · si ça passe ${fmt(r.win)}`);
        this.show(true);
    }
}
