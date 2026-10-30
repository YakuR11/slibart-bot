// Mines : 20 cases (4 x 5), choisis le nombre de bombes, retourne des diamants, encaisse avant de sauter.
import { el, fmt, signed, betBox, gameShell } from '../ui.js';

const COUNTS = [1, 3, 5, 8, 12, 15];

export class MinesView {
    constructor(view, app) {
        this.app = app;
        this.view = view;
        const { stage, console: c } = gameShell(view, 'Mines');
        this.stage = stage;
        stage.classList.add('mn-stage');
        this.grid = el('div.mn-grid');
        this.tiles = Array.from({ length: 20 }, (_, i) => {
            const t = el('button.mn-tile', { type: 'button', onclick: () => this.pick(i) }, el('span'));
            this.grid.append(t);
            return t;
        });
        this.info = el('div.mn-info', { text: 'Choisis tes bombes et lance la partie' });
        stage.append(this.info, this.grid);

        this.mines = 3;
        this.bet = betBox(() => app.balance(), app.minBet);
        this.countSeg = el('div.seg', {}, ...COUNTS.map((n) => el('button', {
            type: 'button', role: 'radio', 'aria-checked': String(n === this.mines), text: `${n} 💣`,
            onclick: (e) => {
                if (this.playing) return;
                this.mines = n;
                for (const b of this.countSeg.children) b.setAttribute('aria-checked', String(b === e.currentTarget));
            },
        })));
        this.start = el('button.drop', { type: 'button', text: 'Jouer', onclick: () => this.begin() });
        this.cash = el('button.drop.cash-out', { type: 'button', text: 'Encaisser', onclick: () => this.cashout(), hidden: true });
        this.next = el('p.hint', { text: 'Plus de bombes = plus gros multiplicateurs.' });
        c.append(this.bet.node, el('div.field', {}, el('span.field-label', { text: 'Bombes' }), this.countSeg), this.start, this.cash, this.next);
        this.reset();
    }

    show() {}

    reset() {
        this.playing = false;
        for (const t of this.tiles) {
            t.className = 'mn-tile';
            t.disabled = true;
            t.firstChild.textContent = '';
        }
    }

    async begin() {
        if (this.busy) return;
        const bet = this.bet.get();
        if (!(bet >= this.app.minBet)) return this.app.toast(`Mise minimum : ${this.app.minBet}`, true);
        if (bet > this.app.balance()) return this.app.toast('Pas assez de Rokbux.', true);
        this.busy = true;
        this.app.sound.unlock();
        const r = await this.app.req('mines', { action: 'start', bet, mines: this.mines });
        this.busy = false;
        if (r.error) return this.app.toast(r.error, true);
        this.app.setBalance(this.app.balance() - bet);
        this.betNow = bet;
        this.reset();
        this.playing = true;
        this.stage.classList.remove('boom', 'won');
        this.tiles.forEach((t, i) => {
            t.disabled = false;
            t.style.animationDelay = `${i * 18}ms`;
            t.classList.add('live');
        });
        this.app.sound.chip(true);
        this.start.hidden = true;
        this.cash.hidden = false;
        this.cash.disabled = true;
        this.cash.textContent = 'Retourne une case';
        this.info.textContent = `${20 - r.mines} diamants · ${r.mines} bombes · prochain ×${r.next}`;
        this.next.textContent = `Prochaine case : ×${r.next}`;
    }

    async pick(i) {
        if (!this.playing || this.busy || this.tiles[i].classList.contains('gem')) return;
        this.busy = true;
        const t = this.tiles[i];
        t.classList.add('press');
        const r = await this.app.req('mines', { action: 'pick', cell: i });
        this.busy = false;
        t.classList.remove('press');
        if (r.error) return this.app.toast(r.error, true);
        if (r.boom !== undefined) return this.explode(r, i);
        t.classList.add('gem');
        t.firstChild.textContent = '💎';
        const k = r.picked.length;
        this.app.sound.gem(k);
        const box = t.getBoundingClientRect();
        this.app.fx.emojis('✨', box.left + box.width / 2, box.top + box.height / 2, 4, 0.5);
        if (r.done) return this.finish(r);
        this.cash.disabled = false;
        this.cash.textContent = `Encaisser ${fmt(r.gain)} (×${r.mult})`;
        this.info.textContent = `${k} 💎 · ×${r.mult} · prochain ×${r.next}`;
        this.next.textContent = `Prochaine case : ×${r.next}`;
        this.stage.style.setProperty('--heat', Math.min(1, k / 8));
    }

    async cashout() {
        if (!this.playing || this.busy) return;
        this.busy = true;
        const r = await this.app.req('mines', { action: 'cashout' });
        this.busy = false;
        if (r.error) return this.app.toast(r.error, true);
        this.finish(r);
    }

    explode(r, i) {
        this.playing = false; // plus de clic pendant l'explosion
        this.tiles.forEach((x) => { x.disabled = true; });
        const t = this.tiles[i];
        t.classList.add('bomb', 'hit');
        t.firstChild.textContent = '💣';
        this.app.sound.bomb();
        this.app.fx.flash('#ff5a4e', 0.5);
        this.app.fx.shake(this.stage, 1.6);
        this.stage.classList.add('boom');
        setTimeout(() => this.finish(r), 600);
    }

    finish(r) {
        this.playing = false;
        const bombs = new Set(r.bombs);
        this.tiles.forEach((t, i) => {
            t.disabled = true;
            t.classList.remove('live');
            if (bombs.has(i) && !t.classList.contains('bomb')) {
                t.classList.add('bomb', 'reveal');
                t.firstChild.textContent = '💣';
            } else if (!bombs.has(i) && !t.classList.contains('gem')) {
                t.classList.add('reveal');
                t.firstChild.textContent = '💎';
            }
        });
        this.start.hidden = false;
        this.cash.hidden = true;
        this.stage.style.setProperty('--heat', 0);
        if (r.cashed) {
            this.stage.classList.add('won');
            this.info.textContent = `Encaissé ×${r.mult} · ${signed(r.net)}`;
            const box = this.stage.getBoundingClientRect();
            this.app.fx.coins(box.left + box.width / 2, box.top + box.height / 2, 18 + Math.min(80, r.mult * 4));
            this.app.sound.cashout(r.mult);
            if (r.mult >= 10) this.app.showBigWin(r.mult, r.net, this.betNow);
        } else {
            this.info.textContent = `💥 BOUM · ${signed(r.net)}`;
            this.app.sound.lose(Math.abs(r.net));
        }
        this.next.textContent = 'Plus de bombes = plus gros multiplicateurs.';
        this.app.afterGame(r);
        this.app.setBalance(r.balance, r.net > 0);
    }
}
