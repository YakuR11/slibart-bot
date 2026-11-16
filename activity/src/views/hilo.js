// HiLo : la prochaine carte est-elle plus haute ou plus basse ? Chaque bonne reponse fait
// grimper le multiplicateur, tu encaisses quand tu veux.
import { el, fmt, signed, betBox, gameShell, bigButton } from '../ui.js';
import { slip } from '../art.js';

const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const SUIT_COLORS = ['#1a2c38', '#e11d48', '#e11d48', '#1a2c38'];
const SUIT_BANDS = ['#2f4553', '#9f1239', '#9f1239', '#2f4553'];
const pct = (p) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)} %`;

function cardEl(card, cls = '') {
    const color = SUIT_COLORS[card.s];
    return el(`div.hl-card${cls ? `.${cls}` : ''}`, { style: { color } },
        el('b', { text: RANKS[card.r] }),
        el('span.hl-pip', { html: `<svg viewBox="0 0 48 40" aria-hidden="true">${slip(4, 3, 40, { fill: color, band: SUIT_BANDS[card.s] })}</svg>` }));
}

export class HiloView {
    constructor(view, app) {
        this.app = app;
        const { stage, console: c } = gameShell(view, 'HiLo');
        this.stage = stage;
        stage.classList.add('hl-stage');
        this.info = el('div.hl-info', { text: 'Plus haut ou plus bas ?' });
        this.trail = el('div.hl-trail');
        this.slot = el('div.hl-slot', {}, cardEl({ r: 7, s: 1 }, 'ghost'));
        this.hi = el('button.hl-btn.hi', { type: 'button', disabled: true, onclick: () => this.guess('hi') }, el('b'), el('span'));
        this.lo = el('button.hl-btn.lo', { type: 'button', disabled: true, onclick: () => this.guess('lo') }, el('b'), el('span'));
        this.skip = el('button.chip', { type: 'button', text: 'Changer de carte', hidden: true, onclick: () => this.skipCard() });
        stage.append(this.info, el('div.hl-table', {}, this.lo, this.slot, this.hi), this.skip, this.trail);

        this.bet = betBox(() => app.balance(), app.minBet);
        this.start = bigButton('Distribuer', () => this.begin());
        this.cash = bigButton('Encaisser', () => this.cashout(), 'cash-out');
        this.cash.hidden = true;
        c.append(this.bet.node, this.start, this.cash, el('p.hint', { text: 'As = 1, Roi = 13. Une carte égale compte comme gagnée, sauf sur l\'As et le Roi.' }));
        this.labels({ r: 7 });
    }

    show() {
        if (!this.playing && !this.busy) this.app.req('hilo', { action: 'state' }).then((r) => { if (r.resume) this.resume(r); });
    }

    key() { if (this.playing) this.cashout(); else this.begin(); }

    labels(card, r = null) {
        const hiTxt = card.r === 13 ? 'Encore un Roi' : card.r === 1 ? 'Plus haute' : 'Plus haute ou égale';
        const loTxt = card.r === 1 ? 'Encore un As' : card.r === 13 ? 'Plus basse' : 'Plus basse ou égale';
        this.hi.firstChild.textContent = `▲ ${hiTxt}`;
        this.lo.firstChild.textContent = `▼ ${loTxt}`;
        this.hi.lastChild.textContent = r ? `${pct(r.hi.chance)} · ×${r.hi.mult}` : '';
        this.lo.lastChild.textContent = r ? `${pct(r.lo.chance)} · ×${r.lo.mult}` : '';
    }

    paint(r, anim = true) {
        this.slot.replaceChildren(cardEl(r.card, anim ? 'deal' : ''));
        this.labels(r.card, r);
        this.hi.disabled = this.lo.disabled = false;
        this.skip.hidden = false;
        this.cash.disabled = !r.steps;
        this.cash.textContent = r.steps ? `Encaisser ${fmt(Math.floor(r.bet * r.mult))} (×${r.mult})` : 'Encaisser';
        this.info.textContent = r.steps ? `${r.steps} bonne${r.steps > 1 ? 's' : ''} réponse${r.steps > 1 ? 's' : ''} · ×${r.mult}` : 'Plus haut ou plus bas ?';
        this.paintTrail(r.history);
    }

    paintTrail(history = []) {
        this.trail.replaceChildren(...history.slice(-10).map((c) => {
            const node = cardEl(c, 'mini');
            if (c.ok === true) node.classList.add('ok');
            if (c.ok === false) node.classList.add('ko');
            if (c.skip) node.classList.add('skip');
            return node;
        }));
    }

    resume(r) {
        this.playing = true;
        this.betNow = r.bet;
        this.start.hidden = true;
        this.cash.hidden = false;
        this.stage.classList.remove('won', 'boom');
        this.paint(r, false);
    }

    async begin() {
        if (this.playing || this.busy) return;
        const bet = this.bet.get();
        if (!(bet >= this.app.minBet)) return this.app.toast(`Mise minimum : ${this.app.minBet}`, true);
        if (bet > this.app.balance()) return this.app.toast('Pas assez de Rokbux.', true);
        this.busy = true;
        this.app.sound.unlock();
        const r = await this.app.req('hilo', { action: 'start', bet });
        this.busy = false;
        if (r.error) return this.app.toast(r.error, true);
        if (r.resume) return this.resume(r);
        this.app.sound.card();
        this.app.setBalance(r.balance);
        this.resume(r);
        this.paint(r);
    }

    async guess(g) {
        if (!this.playing || this.busy) return;
        this.busy = true;
        this.hi.disabled = this.lo.disabled = true;
        const r = await this.app.req('hilo', { action: 'guess', guess: g });
        this.busy = false;
        if (r.error) { this.hi.disabled = this.lo.disabled = false; return this.app.toast(r.error, true); }
        this.app.sound.flip();
        if (r.done) return this.finish(r);
        this.app.sound.gem(r.steps);
        this.paint(r);
    }

    async skipCard() {
        if (!this.playing || this.busy) return;
        this.busy = true;
        const r = await this.app.req('hilo', { action: 'skip' });
        this.busy = false;
        if (r.error) return this.app.toast(r.error, true);
        this.app.sound.card();
        this.paint(r);
    }

    async cashout() {
        if (!this.playing || this.busy || this.cash.disabled) return;
        this.busy = true;
        const r = await this.app.req('hilo', { action: 'cashout' });
        this.busy = false;
        if (r.error) return this.app.toast(r.error, true);
        this.finish(r);
    }

    finish(r) {
        this.playing = false;
        this.slot.replaceChildren(cardEl(r.card, r.cashed ? '' : 'deal'));
        this.paintTrail(r.history);
        this.hi.disabled = this.lo.disabled = true;
        this.skip.hidden = true;
        this.start.hidden = false;
        this.cash.hidden = true;
        if (r.cashed) {
            this.stage.classList.add('won');
            this.info.textContent = `Encaissé ×${r.mult} · ${signed(r.net)}`;
            const box = this.slot.getBoundingClientRect();
            this.app.fx.coins(box.left + box.width / 2, box.top + box.height / 2, 18 + Math.min(80, r.mult * 4));
            this.app.sound.cashout(r.mult);
            if (r.mult >= 10) this.app.showBigWin(r.mult, r.net, this.betNow);
        } else {
            this.stage.classList.add('boom');
            this.info.textContent = `Raté · ${signed(r.net)}`;
            this.app.fx.shake(this.slot, 0.9);
            this.app.sound.lose(Math.abs(r.net));
        }
        this.app.afterGame(r);
        this.app.setBalance(r.balance, r.net > 0);
    }
}
