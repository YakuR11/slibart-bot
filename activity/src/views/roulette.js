// Roulette : une bande de cases rouges / noires / vertes qui defile 3 s et s'arrete sous le curseur.
import { el, fmt, signed, betBox, gameShell } from '../ui.js';

const TW = 74; // largeur d'une case
const DUR = 3000;
const ease = (t) => 1 - (1 - t) ** 4;
const LABEL = { red: 'Rouge', black: 'Noir', green: 'Vert' };

export class RouletteView {
    constructor(view, app) {
        this.app = app;
        this.view = view;
        const { stage, console: c } = gameShell(view, 'Roulette');
        this.stage = stage;
        stage.classList.add('rl-stage');
        this.hist = el('div.rl-hist');
        this.strip = el('div.rl-strip');
        this.win = el('div.rl-window', {}, this.strip, el('div.rl-cursor'));
        this.result = el('div.rl-result', { text: 'Choisis ta couleur →' });
        stage.append(this.hist, el('div.rl-title', { text: 'Roulette' }), this.win, this.result);

        this.bet = betBox(() => app.balance(), app.minBet);
        this.btns = ['red', 'black', 'green'].map((color) => el(`button.rl-btn.${color}`, {
            type: 'button',
            onclick: () => this.play(color),
        }, el('b', { text: LABEL[color] }), el('span', { text: color === 'green' ? '×14' : '×2' })));
        c.append(this.bet.node, el('span.field-label', { text: 'Mise sur…' }), el('div.rl-btns', {}, ...this.btns),
            el('p.hint', { text: 'Rouge ou noir : ×2. Vert : ×14 (1 chance sur 15).' }));
        this.wheel = ['red', 'black', 'red', 'black', 'red', 'black', 'red', 'green', 'black', 'red', 'black', 'red', 'black', 'red', 'black'];
        this.fill(0);
        this.offset = 0;
    }

    fill(around) {
        // 7 tours de roue : assez pour defiler 3 s
        const cells = [];
        for (let k = 0; k < 7; k++) for (const c of this.wheel) cells.push(c);
        this.cells = cells;
        this.strip.replaceChildren(...cells.map((c) => el(`div.rl-cell.${c}`)));
        this.strip.style.transform = `translateX(${-around}px)`;
    }

    show() {}

    async play(color) {
        if (this.busy) return;
        const bet = this.bet.get();
        if (!(bet >= this.app.minBet)) return this.app.toast(`Mise minimum : ${this.app.minBet}`, true);
        if (bet > this.app.balance()) return this.app.toast('Pas assez de Rokbux.', true);
        this.busy = true;
        this.btns.forEach((b) => { b.disabled = true; });
        this.app.sound.unlock();
        this.app.sound.chip(true);
        this.result.textContent = '…';
        this.result.className = 'rl-result';
        const r = await this.app.req('roulette', { color, bet });
        if (r.error) {
            this.busy = false;
            this.btns.forEach((b) => { b.disabled = false; });
            this.result.textContent = r.error;
            return this.app.toast(r.error, true);
        }
        // pendant l'animation on montre le solde apres la mise, sans spoiler le resultat
        this.app.setBalance(r.balance - (bet + r.net));
        r.bet = bet;
        if (r.wheel) this.wheel = r.wheel;
        // on part de la position actuelle (case 0 du 1er tour), on s'arrete au 6e tour sur la case tiree
        const W = this.win.clientWidth;
        const target = this.wheel.length * 5 + r.cell;
        const jitter = (Math.random() - 0.5) * TW * 0.6;
        const startX = 0;
        const endX = target * TW + TW / 2 - W / 2 + jitter;
        this.fill(startX);
        this.app.fx.dim(true);
        this.view.classList.add('spotlight');
        await this.animate(startX, endX);
        this.app.fx.dim(false);
        this.view.classList.remove('spotlight');
        this.reveal(r, color, target);
        this.busy = false;
        this.btns.forEach((b) => { b.disabled = false; });
    }

    animate(from, to) {
        return new Promise((resolve) => {
            const t0 = performance.now();
            let lastCell = -1;
            const W = this.win.clientWidth;
            const step = (now) => {
                const t = Math.min(1, (now - t0) / DUR);
                const x = from + (to - from) * ease(t);
                this.strip.style.transform = `translateX(${-x}px)`;
                const cell = Math.floor((x + W / 2) / TW);
                if (cell !== lastCell) {
                    lastCell = cell;
                    this.app.sound.spinTick(t);
                }
                if (t < 1) requestAnimationFrame(step);
                else resolve();
            };
            requestAnimationFrame(step);
        });
    }

    reveal(r, color, target) {
        const cellEl = this.strip.children[target];
        cellEl?.classList.add('hit');
        const won = r.net > 0;
        this.result.className = `rl-result ${won ? 'win' : 'lose'}`;
        this.result.textContent = won ? `${LABEL[r.outcome]} ! ${signed(r.net)}` : `${LABEL[r.outcome]}… ${signed(r.net)}`;
        const chip = el(`span.${r.outcome}`);
        this.hist.prepend(chip);
        while (this.hist.children.length > 16) this.hist.lastChild.remove();
        const box = this.stage.getBoundingClientRect();
        if (won) {
            this.app.fx.flash(r.outcome === 'green' ? '#8cff6b' : '#8fe3a1', 0.35);
            this.app.fx.coins(box.left + box.width / 2, box.top + box.height / 2, r.outcome === 'green' ? 60 : 24);
            this.app.sound.win(r.outcome === 'green' ? 3 : 1);
            if (r.outcome === 'green') this.app.showBigWin(14, r.net, r.bet);
        } else {
            this.app.fx.flash('#ff5a4e', 0.25);
            this.app.fx.shake(this.stage, 0.7);
            this.app.sound.lose(Math.abs(r.net));
        }
        this.app.afterGame(r);
        this.app.setBalance(r.balance, won);
    }
}
