// Machine a sous : 3 rouleaux, arrets decales, suspense quand les 2 premiers matchent,
// ampoules qui clignotent, jackpot progressif affiche en haut.
import { el, fmt, signed, betBox, gameShell } from '../ui.js';

const SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];
const PAYS = [['7️⃣', '×2000 + jackpot'], ['💎', '×250'], ['🔔', '×50'], ['🍇', '×15'], ['🍋', '×8'], ['🍒', '×5'], ['paire', '½ mise']];
const SH = 84; // hauteur d'un symbole
const ease = (t) => 1 - (1 - t) ** 3;

export class SlotsView {
    constructor(view, app) {
        this.app = app;
        this.view = view;
        const { stage, console: c } = gameShell(view, 'Slots');
        this.stage = stage;
        stage.classList.add('sl-stage');
        this.jp = el('div.sl-jackpot', {}, el('small', { text: 'JACKPOT' }), el('b', { text: '…' }));
        this.reels = [0, 1, 2].map(() => {
            const strip = el('div.sl-strip');
            const win = el('div.sl-reel', {}, strip);
            return { win, strip };
        });
        this.bulbs = el('div.sl-bulbs', {}, ...Array.from({ length: 22 }, () => el('i')));
        this.machine = el('div.sl-machine', {}, this.bulbs, el('div.sl-reels', {}, ...this.reels.map((r) => r.win)), el('div.sl-line'));
        this.result = el('div.sl-result', { text: 'Tire le levier !' });
        stage.append(this.jp, this.machine, this.result);
        for (const r of this.reels) this.setStrip(r, [this.rand(), this.rand(), this.rand()], 0);

        this.bet = betBox(() => app.balance(), app.minBet);
        this.btn = el('button.drop.sl-spin', { type: 'button', onclick: () => this.spin(), text: 'SPIN' });
        c.append(this.bet.node, this.btn,
            el('p.hint', { text: 'Mise 100+ pour pouvoir rafler le jackpot sur 777.' }),
            el('div.sl-pays', {}, ...PAYS.map(([s, p]) => el('div', {}, el('span', { text: s === 'paire' ? '🍒🍒·' : `${s}${s}${s}` }), el('b', { text: p })))));
    }

    rand() { return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]; }

    setStrip(r, syms, y) {
        r.strip.replaceChildren(...syms.map((s) => el('div.sl-sym', { text: s })));
        r.strip.style.transform = `translateY(${-y}px)`;
    }

    async show() {
        const r = await this.app.req('slots.jackpot');
        if (r.jackpot) this.jp.lastChild.textContent = fmt(r.jackpot);
    }

    async spin() {
        if (this.busy) return;
        const bet = this.bet.get();
        if (!(bet >= this.app.minBet)) return this.app.toast(`Mise minimum : ${this.app.minBet}`, true);
        if (bet > this.app.balance()) return this.app.toast('Pas assez de Rokbux.', true);
        this.busy = true;
        this.btn.disabled = true;
        this.app.sound.unlock();
        this.app.sound.lever();
        this.machine.classList.remove('win', 'jackpot', 'lose');
        this.machine.classList.add('spinning');
        this.result.textContent = '';
        this.result.className = 'sl-result';
        const r = await this.app.req('slots', { bet });
        if (r.error) {
            this.busy = false;
            this.btn.disabled = false;
            this.machine.classList.remove('spinning');
            return this.app.toast(r.error, true);
        }
        this.app.setBalance(r.balance - (bet + r.net));
        // chaque rouleau : une bande de symboles au hasard qui finit sur le bon
        const stops = [900, 1500, 2100];
        const suspense = r.reels[0] === r.reels[1];
        if (suspense) stops[2] += 900;
        const runs = this.reels.map((reel, i) => {
            const n = 18 + i * 8 + (i === 2 && suspense ? 10 : 0);
            const syms = Array.from({ length: n }, () => this.rand());
            syms.push(this.rand(), r.reels[i], this.rand());
            this.setStrip(reel, syms, 0);
            const endY = (syms.length - 3) * SH;
            return this.roll(reel, endY, stops[i], i, suspense && i === 2);
        });
        await Promise.all(runs);
        this.machine.classList.remove('spinning');
        this.end(r, bet);
    }

    roll(reel, endY, dur, i, suspense) {
        return new Promise((resolve) => {
            const t0 = performance.now();
            let last = -1;
            if (suspense) {
                setTimeout(() => {
                    this.app.fx.dim(true);
                    this.view.classList.add('spotlight');
                    this.app.sound.heartbeat();
                }, 1500);
            }
            const step = (now) => {
                const t = Math.min(1, (now - t0) / dur);
                const y = endY * ease(t);
                reel.strip.style.transform = `translateY(${-y}px)`;
                const k = Math.floor(y / SH);
                if (k !== last) {
                    last = k;
                    if (t < 0.92) this.app.sound.spinTick(t * 0.5);
                }
                if (t < 1) requestAnimationFrame(step);
                else {
                    reel.win.classList.remove('stop');
                    void reel.win.offsetWidth;
                    reel.win.classList.add('stop');
                    this.app.sound.reelStop(i);
                    resolve();
                }
            };
            requestAnimationFrame(step);
        });
    }

    end(r, bet) {
        this.app.fx.dim(false);
        this.view.classList.remove('spotlight');
        this.busy = false;
        this.btn.disabled = false;
        if (r.jackpot) this.jp.lastChild.textContent = fmt(r.jackpot);
        const box = this.machine.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        this.result.className = `sl-result ${r.net > 0 ? 'win' : r.kind === 'pair' ? 'meh' : 'lose'}`;
        if (r.kind === 'jackpot') {
            this.machine.classList.add('jackpot');
            this.result.textContent = `777 !!! ${signed(r.net)}`;
            this.app.fx.flash('#fff6d8', 0.7);
            this.app.fx.confetti(160);
            this.app.fx.coins(cx, cy, 120);
            this.app.showBigWin(Math.max(200, r.mult), r.net, bet);
        } else if (r.kind === 'triple') {
            this.machine.classList.add('win');
            this.result.textContent = `Triple ${r.reels[0]} ! ${signed(r.net)}`;
            this.app.fx.flash('#ffd76a', 0.45);
            this.app.fx.coins(cx, cy, 20 + Math.min(80, r.mult * 2));
            this.app.sound.win(r.mult >= 50 ? 3 : 2);
            if (r.mult >= 10) this.app.showBigWin(r.mult, r.net, bet);
        } else if (r.kind === 'pair') {
            this.result.textContent = `Paire, tu récupères la moitié (${signed(r.net)})`;
            this.app.sound.land(0.5);
        } else {
            this.machine.classList.add('lose');
            this.result.textContent = `Rien… ${signed(r.net)}`;
            this.app.fx.shake(this.machine, 0.5);
            this.app.sound.lose(Math.abs(r.net));
        }
        this.app.afterGame(r);
        this.app.setBalance(r.balance, r.net > 0);
    }
}
