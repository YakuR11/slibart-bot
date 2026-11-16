// Limbo : tu vises un multiplicateur, le compteur doit monter au moins jusque-la.
import { el, fmt, betBox, gameShell, bigButton, historyStrip, autoBox, checkBet } from '../ui.js';

const RTP = 98;
const QUICK = [1.5, 2, 5, 10, 100];

export class LimboView {
    constructor(view, app) {
        this.app = app;
        const { stage, console: c } = gameShell(view, 'Limbo');
        this.stage = stage;
        stage.classList.add('lm-stage');
        this.hist = historyStrip();
        this.big = el('div.lm-mult', { text: '1.00×' });
        this.sub = el('div.lm-sub', { text: 'Choisis ta cible et lance' });
        stage.append(this.hist.node, el('div.lm-core', {}, this.big, this.sub));

        this.bet = betBox(() => app.balance(), app.minBet);
        this.target = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: '2.00', 'aria-label': 'Multiplicateur visé' });
        const quick = el('div.bet-row.quick', {}, ...QUICK.map((q) => el('button.chip', { type: 'button', text: `×${q}`, onclick: () => { this.target.value = q.toFixed(2); this.paint(); } })));
        this.info = el('p.hint.gain');
        this.btn = bigButton('Lancer', () => this.play());
        this.auto = autoBox((fast) => this.play(fast));
        c.append(this.bet.node,
            el('div.field', {}, el('span.field-label', { text: 'Multiplicateur visé' }), el('div.bet-row', {}, this.target), quick),
            this.btn, this.info, this.auto.node);
        this.target.addEventListener('input', () => this.paint());
        this.target.addEventListener('blur', () => { this.target.value = this.t().toFixed(2); });
        this.bet.input.addEventListener('input', () => this.paint());
        this.paint();
    }

    show() {}
    key() { this.play(); }

    t() {
        const v = parseFloat(String(this.target.value).replace(',', '.').replace(/[×x]/gi, ''));
        return Math.min(1000, Math.max(1.01, Math.floor((v || 2) * 100) / 100));
    }

    paint() {
        const t = this.t();
        const bet = this.bet.get();
        const gain = bet >= this.app.minBet ? ` · gain +${fmt(Math.floor(bet * t) - bet)} RB` : '';
        this.info.textContent = `Chance : ${(RTP / t).toFixed(2)} %${gain}`;
    }

    async play(fast = false) {
        if (this.busy) return false;
        const bet = checkBet(this.app, this.bet);
        if (!bet) return false;
        const target = this.t();
        this.busy = true;
        this.btn.disabled = true;
        this.app.sound.unlock();
        this.app.sound.chip(true);
        const r = await this.app.req('limbo', { bet, target });
        if (r.error) {
            this.busy = false;
            this.btn.disabled = false;
            this.app.toast(r.error, true);
            return false;
        }
        this.app.setBalance(r.balance - (bet + r.net));
        this.big.className = 'lm-mult run';
        this.sub.textContent = `Cible ×${r.target.toFixed(2)}`;
        await this.count(r.result, fast ? 260 : 620);
        this.big.className = `lm-mult ${r.won ? 'win' : 'lose'}`;
        this.sub.textContent = r.won ? `Cible ×${r.target.toFixed(2)} atteinte · +${fmt(r.net)} RB` : `Cible ×${r.target.toFixed(2)} ratée`;
        this.hist.add(`${r.result.toFixed(2)}×`, r.won);
        if (r.won) {
            this.app.sound.win(r.target >= 10 ? 3 : r.target >= 3 ? 2 : 1);
            const box = this.big.getBoundingClientRect();
            this.app.fx.coins(box.left + box.width / 2, box.top + box.height / 2, Math.min(70, 8 + r.target * 3));
            if (r.target >= 10) this.app.showBigWin(r.target, r.net, bet);
        } else {
            this.app.fx.shake(this.big, 0.5);
            this.app.sound.lose(Math.abs(r.net));
        }
        this.app.afterGame(r);
        this.app.setBalance(r.balance, r.won);
        this.busy = false;
        this.btn.disabled = false;
        return true;
    }

    /** le compteur grimpe jusqu'au resultat (echelle log : les gros chiffres ne prennent pas plus longtemps) */
    count(to, dur) {
        return new Promise((resolve) => {
            const t0 = performance.now();
            const lg = Math.log(Math.max(1.0001, to));
            let lastTick = 0;
            const step = (now) => {
                const t = Math.min(1, (now - t0) / dur);
                const v = Math.exp(lg * (1 - (1 - t) ** 2));
                this.big.textContent = `${(t < 1 ? v : to).toFixed(2)}×`;
                if (now - lastTick > 55) { lastTick = now; this.app.sound.spinTick(t); }
                if (t < 1) requestAnimationFrame(step);
                else resolve();
            };
            requestAnimationFrame(step);
        });
    }
}
