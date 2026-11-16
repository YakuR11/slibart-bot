// Dice : un tirage de 0 a 100. Tu regles ta chance de gagner au curseur, le multiplicateur suit.
import { el, fmt, signed, betBox, gameShell, bigButton, historyStrip, autoBox, checkBet, wait } from '../ui.js';

const RTP = 98;
const multOf = (chance) => Math.floor((RTP / chance) * 10000 + 1e-6) / 10000;

export class DiceView {
    constructor(view, app) {
        this.app = app;
        const { stage, console: c } = gameShell(view, 'Dice');
        this.stage = stage;
        stage.classList.add('dc-stage');
        this.chance = 49.5;
        this.over = true;

        this.hist = historyStrip();
        this.big = el('div.dc-roll', { text: '50.00' });
        this.marker = el('div.dc-marker', {}, el('b', { text: '50.00' }));
        this.fill = el('i.dc-fill');
        this.range = el('input.dc-range', { type: 'range', min: '1', max: '99', step: '0.5', value: '50.5', 'aria-label': 'Seuil à battre', oninput: () => this.onRange() });
        this.track = el('div.dc-track', {}, this.fill, this.range, this.marker,
            el('div.dc-ticks', {}, ...[0, 25, 50, 75, 100].map((n) => el('span', { text: String(n) }))));
        this.sMult = el('b');
        this.sLine = el('b');
        this.sChance = el('b');
        this.flip = el('button.dc-stat.click', { type: 'button', title: 'Inverser : au-dessus / en dessous', onclick: () => this.toggle() }, el('span'), this.sLine);
        const stats = el('div.dc-stats', {},
            el('div.dc-stat', {}, el('span', { text: 'Multiplicateur' }), this.sMult),
            this.flip,
            el('div.dc-stat', {}, el('span', { text: 'Chance de gagner' }), this.sChance));
        stage.append(this.hist.node, this.big, this.track, stats);

        this.bet = betBox(() => app.balance(), app.minBet);
        this.gain = el('p.hint.gain');
        this.btn = bigButton('Lancer le dé', () => this.play());
        this.auto = autoBox((fast) => this.play(fast));
        c.append(this.bet.node, this.btn, this.gain, this.auto.node, el('p.hint', { text: 'Glisse le curseur ou clique sur le seuil pour inverser. Espace pour relancer.' }));
        this.bet.input.addEventListener('input', () => this.paint());
        this.paint();
    }

    show() {}
    key() { this.play(); }

    toggle() {
        this.over = !this.over;
        this.range.value = String(100 - Number(this.range.value));
        this.onRange();
    }

    onRange() {
        const v = Number(this.range.value);
        const chance = this.over ? 100 - v : v;
        this.chance = Math.min(95, Math.max(1, Math.round(chance * 100) / 100));
        // le curseur ne sort pas de la zone jouable
        const line = this.over ? 100 - this.chance : this.chance;
        if (Math.abs(line - v) > 0.001) this.range.value = String(line);
        this.app.sound.spinTick(0.2);
        this.paint();
    }

    paint() {
        const line = this.over ? 100 - this.chance : this.chance;
        const m = multOf(this.chance);
        this.sMult.textContent = `×${m.toFixed(m >= 10 ? 2 : 4)}`;
        this.flip.firstChild.textContent = this.over ? 'Au-dessus de ⇄' : 'En dessous de ⇄';
        this.sLine.textContent = line.toFixed(2);
        this.sChance.textContent = `${this.chance.toFixed(2)} %`;
        this.fill.style.left = this.over ? `${line}%` : '0%';
        this.fill.style.width = `${this.chance}%`;
        const bet = this.bet.get();
        this.gain.textContent = bet >= this.app.minBet ? `Si ça passe : +${fmt(Math.floor(bet * m) - bet)} RB` : '';
    }

    async play(fast = false) {
        if (this.busy) return false;
        const bet = checkBet(this.app, this.bet);
        if (!bet) return false;
        this.busy = true;
        this.btn.disabled = true;
        this.app.sound.unlock();
        this.app.sound.chip(true);
        const r = await this.app.req('dice', { bet, chance: this.chance, over: this.over });
        if (r.error) {
            this.busy = false;
            this.btn.disabled = false;
            this.app.toast(r.error, true);
            return false;
        }
        this.app.setBalance(r.balance - (bet + r.net));
        this.marker.className = 'dc-marker go';
        this.marker.style.left = `${r.roll}%`;
        this.marker.firstChild.textContent = r.roll.toFixed(2);
        await wait(fast ? 230 : 430);
        this.marker.classList.add(r.won ? 'win' : 'lose');
        this.big.textContent = r.roll.toFixed(2);
        this.big.className = `dc-roll ${r.won ? 'win' : 'lose'}`;
        this.hist.add(r.roll.toFixed(2), r.won);
        if (r.won) {
            this.app.sound.win(r.mult >= 10 ? 3 : r.mult >= 3 ? 2 : 1);
            const box = this.marker.getBoundingClientRect();
            this.app.fx.coins(box.left + box.width / 2, box.top, Math.min(60, 8 + r.mult * 3));
            if (r.mult >= 10) this.app.showBigWin(Math.round(r.mult * 100) / 100, r.net, bet);
        } else {
            this.app.sound.lose(Math.abs(r.net));
        }
        this.app.afterGame(r);
        this.app.setBalance(r.balance, r.won);
        this.busy = false;
        this.btn.disabled = false;
        return true;
    }
}
