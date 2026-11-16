// Keno : 40 numeros, tu en coches 1 a 10, le serveur en tire 10. Plus tu en as, plus ca paie.
import { el, fmt, betBox, gameShell, bigButton, historyStrip, autoBox, checkBet, wait } from '../ui.js';

const N = 40;
const RISKS = [['low', 'Doux'], ['medium', 'Normal'], ['high', 'Sale']];

export class KenoView {
    constructor(view, app) {
        this.app = app;
        const { stage, console: c } = gameShell(view, 'Keno');
        this.stage = stage;
        stage.classList.add('kn-stage');
        this.picks = new Set();
        this.risk = 'medium';
        this.tables = {}; // risque -> tables (une par nombre de numeros coches)

        this.hist = historyStrip();
        this.grid = el('div.kn-grid');
        this.tiles = Array.from({ length: N }, (_, i) => {
            const t = el('button.kn-tile', { type: 'button', text: String(i + 1), 'aria-pressed': 'false', onclick: () => this.toggle(i + 1) });
            this.grid.append(t);
            return t;
        });
        this.pay = el('div.kn-pay');
        this.info = el('div.kn-info', { text: 'Coche jusqu\'à 10 numéros' });
        stage.append(this.hist.node, this.info, this.grid, this.pay);

        this.bet = betBox(() => app.balance(), app.minBet);
        this.seg = el('div.seg', { role: 'radiogroup', 'aria-label': 'Risque' }, ...RISKS.map(([v, label]) => el('button', { type: 'button', role: 'radio', text: label, 'aria-checked': String(v === this.risk), dataset: { v }, onclick: () => this.setRisk(v) })));
        this.btn = bigButton('Tirer les numéros', () => this.play());
        this.auto = autoBox((fast) => this.play(fast));
        c.append(this.bet.node,
            el('div.field', {}, el('span.field-label', { text: 'Risque' }), this.seg),
            el('div.bet-row', {},
                el('button.chip.wide', { type: 'button', text: 'Au hasard', onclick: () => this.random() }),
                el('button.chip.wide', { type: 'button', text: 'Effacer', onclick: () => this.clear() })),
            this.btn, this.auto.node,
            el('p.hint', { text: 'Le tableau sous la grille montre ce que paie chaque nombre de bons numéros.' }));
        this.loadTables();
    }

    show() { this.loadTables(); }
    key() { this.play(); }

    async loadTables() {
        if (this.tables[this.risk]) return this.paintPay();
        const r = await this.app.req('keno.table', { risk: this.risk });
        if (r.tables) this.tables[r.risk] = r.tables;
        this.paintPay();
    }

    setRisk(v) {
        if (this.busy) return;
        this.risk = v;
        for (const b of this.seg.children) b.setAttribute('aria-checked', String(b.dataset.v === v));
        this.loadTables();
    }

    toggle(n) {
        if (this.busy) return;
        this.resetBoard();
        if (this.picks.has(n)) this.picks.delete(n);
        else if (this.picks.size >= 10) return this.app.toast('10 numéros maximum.', true);
        else this.picks.add(n);
        this.app.sound.chip(this.picks.has(n));
        this.paintPicks();
    }

    random() {
        if (this.busy) return;
        this.resetBoard();
        this.picks.clear();
        while (this.picks.size < 10) this.picks.add(1 + Math.floor(Math.random() * N));
        this.app.sound.chip(true);
        this.paintPicks();
    }

    clear() {
        if (this.busy) return;
        this.resetBoard();
        this.picks.clear();
        this.paintPicks();
    }

    resetBoard() {
        for (const t of this.tiles) t.classList.remove('hit', 'miss', 'drawn');
        for (const p of this.pay.children) p.classList.remove('on');
    }

    paintPicks() {
        this.tiles.forEach((t, i) => {
            const on = this.picks.has(i + 1);
            t.classList.toggle('pick', on);
            t.setAttribute('aria-pressed', String(on));
        });
        this.info.textContent = this.picks.size ? `${this.picks.size} numéro${this.picks.size > 1 ? 's' : ''} coché${this.picks.size > 1 ? 's' : ''}` : 'Coche jusqu\'à 10 numéros';
        this.paintPay();
    }

    paintPay() {
        const table = this.tables[this.risk]?.[this.picks.size - 1];
        if (!table) return this.pay.replaceChildren(el('span.kn-pay-empty', { text: this.picks.size ? '…' : 'Les gains s\'affichent ici' }));
        this.pay.replaceChildren(...table.map((m, k) => el(`div.kn-p${m ? '' : '.zero'}`, {}, el('b', { text: m ? `×${m}` : '—' }), el('span', { text: `${k} bon${k > 1 ? 's' : ''}` }))));
    }

    async play(fast = false) {
        if (this.busy) return false;
        if (!this.picks.size) { this.app.toast('Coche au moins un numéro.', true); return false; }
        const bet = checkBet(this.app, this.bet);
        if (!bet) return false;
        this.busy = true;
        this.btn.disabled = true;
        this.resetBoard();
        this.app.sound.unlock();
        this.app.sound.chip(true);
        const r = await this.app.req('keno', { bet, picks: [...this.picks], risk: this.risk });
        if (r.error) {
            this.busy = false;
            this.btn.disabled = false;
            this.app.toast(r.error, true);
            return false;
        }
        this.app.setBalance(r.balance - (bet + r.net));
        let hits = 0;
        for (const n of r.draw) {
            const t = this.tiles[n - 1];
            const hit = this.picks.has(n);
            t.classList.add('drawn', hit ? 'hit' : 'miss');
            if (hit) {
                hits++;
                this.app.sound.gem(hits);
                for (const p of this.pay.children) p.classList.remove('on');
                this.pay.children[hits]?.classList.add('on');
            } else this.app.sound.spinTick(0.6);
            await wait(fast ? 70 : 170);
        }
        const won = r.net > 0;
        this.info.textContent = `${r.hits.length}/${this.picks.size} bons · ${r.mult ? `×${r.mult}` : 'rien'}${r.net ? ` · ${r.net > 0 ? '+' : '−'}${fmt(Math.abs(r.net))} RB` : ''}`;
        this.hist.add(r.mult ? `×${r.mult}` : `${r.hits.length}/${this.picks.size}`, won);
        if (won) {
            const box = this.grid.getBoundingClientRect();
            this.app.fx.coins(box.left + box.width / 2, box.top + box.height / 2, Math.min(80, 10 + r.mult * 2));
            this.app.sound.win(r.mult >= 10 ? 3 : r.mult >= 3 ? 2 : 1);
            if (r.mult >= 10) this.app.showBigWin(r.mult, r.net, bet);
        } else if (r.net < 0) this.app.sound.lose(Math.abs(r.net));
        this.app.afterGame(r);
        this.app.setBalance(r.balance, won);
        this.busy = false;
        this.btn.disabled = false;
        return true;
    }
}
