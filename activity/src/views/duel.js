// Duel pierre-feuille-ciseaux entre deux joueurs de l'app, mise sequestree.
import { el, fmt, betBox, gameShell } from '../ui.js';
import { avatarEl } from '../avatar.js';

const MOVES = { pierre: '🪨', feuille: '🍂', ciseaux: '✂️' };

export class DuelView {
    constructor(view, app) {
        this.app = app;
        this.view = view;
        const { stage, console: c } = gameShell(view, 'Duel');
        this.stage = stage;
        stage.classList.add('du-stage');
        this.arena = el('div.du-arena');
        stage.append(this.arena);
        this.bet = betBox(() => app.balance(), 0, 100, 'Mise de chacun');
        this.list = el('ol.du-list');
        c.append(this.bet.node, el('span.field-label', { text: 'Défier quelqu\'un qui a l\'app ouverte' }), this.list,
            el('p.hint', { text: 'Pierre bat ciseaux, ciseaux bat feuille, feuille bat pierre. 15 s pour jouer, 3 manches max en cas d\'égalité.' }));
        this.idle();
    }

    async show() {
        const r = await this.app.req('duel.online');
        const players = r.players || [];
        this.list.replaceChildren(...(players.length ? players.map((p) => el('li', {},
            avatarEl(p, 30, { onClick: (id) => this.app.openProfile(id) }),
            el('b', { text: p.name }),
            el('button.chip.du-go', { type: 'button', text: '⚔️ Défier', onclick: () => this.challenge(p) }))) : [el('li.empty', { text: 'Personne d\'autre n\'a l\'app ouverte pour l\'instant.' })]));
    }

    idle(text = 'Choisis un adversaire à droite →') {
        this.duel = null;
        this.roundKey = null;
        this.slots = null;
        clearInterval(this.cd);
        this.arena.replaceChildren(el('div.du-idle', {}, el('div.du-big', { text: '⚔️' }), el('p', { text })));
    }

    async challenge(p) {
        const amount = this.bet.get() || 0;
        if (amount > this.app.balance()) return this.app.toast('Pas assez de Rokbux.', true);
        const r = await this.app.req('duel.challenge', { to: p.id, amount });
        if (r.error) return this.app.toast(r.error, true);
        this.app.sound.chip(true);
    }

    /** messages duel:* du serveur */
    onMessage(m) {
        const d = m.duel;
        const me = this.app.me()?.id;
        if (m.type === 'duel:invite') return this.app.duelInvite(d);
        if (d.state === 'cancelled') {
            this.app.toast(m.text || 'Duel annulé.');
            return this.idle(m.text);
        }
        if (d.state === 'invite') return this.waiting(d, m.text);
        if (m.type === 'duel:update' && d.state === 'play') {
            if (this.roundKey !== `${d.id}:${d.round}`) this.round(d, m.text);
            else if (m.ready) this.status.textContent = m.text;
            return;
        }
        if (m.type === 'duel:reveal') this.reveal(d, m, me);
    }

    waiting(d, text) {
        this.duel = d;
        this.arena.replaceChildren(el('div.du-idle', {}, el('div.du-big.pulse', { text: '⏳' }), el('p', { text: text || 'En attente…' })));
    }

    round(d, text) {
        this.duel = d;
        this.roundKey = `${d.id}:${d.round}`;
        this.app.goGame('duel');
        const me = this.app.me()?.id;
        const opp = d.from.id === me ? d.to : d.from;
        this.status = el('div.du-status', { text: text || 'Choisis ton coup !' });
        this.timer = el('div.du-timer');
        this.slots = { [me]: el('div.du-hand', { text: '❔' }), [opp.id]: el('div.du-hand', { text: '❔' }) };
        const side = (p, mine) => el(`div.du-side${mine ? '.me' : ''}`, {}, avatarEl(p, 74), el('b', { text: p.name }), this.slots[p.id]);
        this.btns = Object.entries(MOVES).map(([k, e]) => el('button.du-move', { type: 'button', onclick: () => this.play(k) }, el('span', { text: e }), el('small', { text: k })));
        this.arena.replaceChildren(
            el('div.du-pot', { text: d.amount ? `Pot : ${fmt(d.amount * 2)} RB` : 'Pour l\'honneur' }),
            el('div.du-vs', {}, side(this.app.me(), true), el('div.du-x', { text: 'VS' }), side(opp, false)),
            this.status, this.timer, el('div.du-moves', {}, ...this.btns),
        );
        let left = 15;
        clearInterval(this.cd);
        this.timer.textContent = `${left}s`;
        this.cd = setInterval(() => {
            left--;
            this.timer.textContent = `${Math.max(0, left)}s`;
            if (left <= 3 && left > 0) this.app.sound.countdown(left);
            if (left <= 0) clearInterval(this.cd);
        }, 1000);
        this.app.sound.duelStart();
    }

    async play(move) {
        if (!this.duel) return;
        this.btns.forEach((b) => { b.disabled = true; });
        const r = await this.app.req('duel.play', { id: this.duel.id, move });
        if (r.error) {
            this.btns.forEach((b) => { b.disabled = false; });
            return this.app.toast(r.error, true);
        }
        this.slots[this.app.me().id].textContent = MOVES[move];
        this.slots[this.app.me().id].classList.add('set');
        this.status.textContent = 'En attente de l\'adversaire…';
        this.app.sound.chip(true);
    }

    reveal(d, m, me) {
        clearInterval(this.cd);
        if (!this.slots) this.round(d);
        // les deux mains tremblent puis se revelent
        for (const [id, slot] of Object.entries(this.slots)) {
            slot.classList.add('shake');
            slot.textContent = '✊';
            setTimeout(() => {
                slot.classList.remove('shake');
                slot.textContent = MOVES[m.moves[id]] || '💤';
                slot.classList.add('revealed');
            }, 900);
        }
        this.app.sound.drum();
        setTimeout(() => {
            if (!m.final) {
                this.status.textContent = 'Égalité ! On rejoue…';
                return;
            }
            const won = m.winner === me;
            this.status.textContent = m.text;
            this.status.className = `du-status ${m.winner ? (won ? 'win' : 'lose') : ''}`;
            if (m.winner) this.slots[m.winner]?.parentElement.classList.add('winner');
            if (won) {
                this.app.fx.flash('#8fe3a1', 0.4);
                this.app.fx.confetti(70);
                this.app.sound.win(2);
            } else if (m.winner) {
                this.app.fx.flash('#ff5a4e', 0.3);
                this.app.sound.lose(d.amount);
            }
            if (m.balance !== undefined) this.app.setBalance(m.balance, won);
            setTimeout(() => { if (this.duel?.id === d.id) this.idle('Encore un ? Choisis un adversaire →'); }, 5000);
        }, 1100);
    }
}
