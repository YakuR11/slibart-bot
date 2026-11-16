// Tour du Slip : 8 etages. A chaque etage, des cases propres et des cases qui puent.
// Monte tant que tu veux, encaisse avant de tomber sur un slip sale.
import { el, fmt, signed, betBox, gameShell, bigButton } from '../ui.js';
import { slip, stink } from '../art.js';

const DIFFS = [['easy', 'Facile', 4, 3], ['medium', 'Moyen', 3, 2], ['hard', 'Dur', 2, 1], ['expert', 'Expert', 3, 1]];
const LEVELS = 8;
const RTP = 0.98;
const CLEAN = `<svg viewBox="0 0 48 40" aria-hidden="true">${slip(4, 3, 40, { fill: '#fff', band: '#2ee62b' })}</svg>`;
const DIRTY = `<svg viewBox="0 0 48 40" aria-hidden="true">${stink(15, 13, 11, '#c8ff8a')}${slip(8, 12, 32, { fill: '#b98a4a', band: '#6b4a1e' })}</svg>`;
const multOf = (cols, safe, k) => Math.floor(RTP * (cols / safe) ** k * 100 + 1e-9) / 100;

export class TowerView {
    constructor(view, app) {
        this.app = app;
        const { stage, console: c } = gameShell(view, 'Tour du Slip');
        this.stage = stage;
        stage.classList.add('tw-stage');
        this.diff = 'medium';
        this.info = el('div.tw-info', { text: 'Choisis la difficulté et monte la tour' });
        this.rows = el('div.tw-rows');
        stage.append(this.info, this.rows);

        this.bet = betBox(() => app.balance(), app.minBet);
        this.seg = el('div.seg.four', { role: 'radiogroup', 'aria-label': 'Difficulté' }, ...DIFFS.map(([v, label]) => el('button', { type: 'button', role: 'radio', text: label, 'aria-checked': String(v === this.diff), dataset: { v }, onclick: () => this.setDiff(v) })));
        this.start = bigButton('Entrer dans la tour', () => this.begin());
        this.cash = bigButton('Encaisser', () => this.cashout(), 'cash-out');
        this.cash.hidden = true;
        this.next = el('p.hint');
        c.append(this.bet.node, el('div.field', {}, el('span.field-label', { text: 'Difficulté' }), this.seg), this.start, this.cash, this.next);
        this.build();
    }

    show() {
        // partie laissee en cours (changement d'onglet, reconnexion) : on la reprend
        if (!this.playing && !this.busy) this.app.req('tower', { action: 'state' }).then((r) => { if (r.resume) this.resume(r); });
    }

    key() { if (this.playing) this.cashout(); else this.begin(); }

    def() { return DIFFS.find((d) => d[0] === this.diff); }

    setDiff(v) {
        if (this.playing || this.busy) return;
        this.diff = v;
        for (const b of this.seg.children) b.setAttribute('aria-checked', String(b.dataset.v === v));
        this.build();
    }

    /** dessine la tour vide : etage 8 en haut, etage 1 en bas */
    build() {
        const [, , cols, safe] = this.def();
        this.tiles = [];
        this.rowEls = [];
        const rows = [];
        for (let lv = LEVELS - 1; lv >= 0; lv--) {
            const tiles = Array.from({ length: cols }, (_, col) => el('button.tw-tile', { type: 'button', disabled: true, 'aria-label': `Étage ${lv + 1}, case ${col + 1}`, onclick: () => this.pick(lv, col) }));
            this.tiles[lv] = tiles;
            const row = el('div.tw-row', { style: { '--cols': String(cols) } }, el('span.tw-mult', { text: `×${multOf(cols, safe, lv + 1)}` }), el('div.tw-tiles', {}, ...tiles));
            this.rowEls[lv] = row;
            rows.push(row);
        }
        this.rows.replaceChildren(...rows);
        this.next.textContent = `${safe} case${safe > 1 ? 's' : ''} propre${safe > 1 ? 's' : ''} sur ${cols} à chaque étage.`;
    }

    setLevel(level) {
        this.rowEls.forEach((row, lv) => {
            row.classList.toggle('cur', this.playing && lv === level);
            row.classList.toggle('done', lv < level);
            for (const t of this.tiles[lv]) t.disabled = !(this.playing && lv === level);
        });
        this.rowEls[level]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    resume(r) {
        this.diff = r.diff;
        for (const b of this.seg.children) b.setAttribute('aria-checked', String(b.dataset.v === r.diff));
        this.build();
        this.playing = true;
        this.betNow = r.bet;
        r.path.forEach((col, lv) => this.mark(lv, col, true));
        this.start.hidden = true;
        this.cash.hidden = false;
        this.paintCash(r);
        this.setLevel(r.level);
    }

    paintCash(r) {
        this.cash.disabled = !r.level;
        this.cash.textContent = r.level ? `Encaisser ${fmt(Math.floor(r.bet * r.mult))} (×${r.mult})` : 'Encaisser';
        this.info.textContent = r.level ? `Étage ${r.level} · ×${r.mult} · prochain ×${r.next}` : 'Choisis une case au premier étage';
    }

    mark(lv, col, clean) {
        const t = this.tiles[lv][col];
        t.classList.add(clean ? 'clean' : 'dirty');
        t.innerHTML = clean ? CLEAN : DIRTY;
    }

    async begin() {
        if (this.playing || this.busy) return;
        const bet = this.bet.get();
        if (!(bet >= this.app.minBet)) return this.app.toast(`Mise minimum : ${this.app.minBet}`, true);
        if (bet > this.app.balance()) return this.app.toast('Pas assez de Rokbux.', true);
        this.busy = true;
        this.app.sound.unlock();
        const r = await this.app.req('tower', { action: 'start', bet, diff: this.diff });
        this.busy = false;
        if (r.error) return this.app.toast(r.error, true);
        if (r.resume) return this.resume(r);
        this.app.sound.chip(true);
        this.build();
        this.stage.classList.remove('won', 'boom');
        this.playing = true;
        this.betNow = r.bet;
        this.app.setBalance(r.balance);
        this.start.hidden = true;
        this.cash.hidden = false;
        this.paintCash(r);
        this.setLevel(0);
    }

    async pick(lv, col) {
        if (!this.playing || this.busy) return;
        this.busy = true;
        const t = this.tiles[lv][col];
        t.classList.add('press');
        const r = await this.app.req('tower', { action: 'pick', col });
        this.busy = false;
        t.classList.remove('press');
        if (r.error) return this.app.toast(r.error, true);
        if (r.boom) return this.fall(r);
        this.mark(lv, col, true);
        this.app.sound.gem(r.level);
        const box = t.getBoundingClientRect();
        this.app.fx.emojis('✨', box.left + box.width / 2, box.top + box.height / 2, 4, 0.5);
        if (r.done) return this.finish(r);
        this.paintCash(r);
        this.setLevel(r.level);
    }

    async cashout() {
        if (!this.playing || this.busy || this.cash.disabled) return;
        this.busy = true;
        const r = await this.app.req('tower', { action: 'cashout' });
        this.busy = false;
        if (r.error) return this.app.toast(r.error, true);
        this.finish(r);
    }

    fall(r) {
        this.playing = false;
        this.mark(r.boom.level, r.boom.col, false);
        this.tiles[r.boom.level][r.boom.col].classList.add('hit');
        this.app.sound.bomb();
        this.app.fx.flash('#9dff5c', 0.35);
        this.app.fx.shake(this.stage, 1.4);
        this.stage.classList.add('boom');
        setTimeout(() => this.finish(r), 550);
    }

    finish(r) {
        this.playing = false;
        // on montre ou etaient les slips propres
        const [, , cols] = this.def();
        (r.layout || []).forEach((safe, lv) => {
            for (let col = 0; col < cols; col++) {
                const t = this.tiles[lv][col];
                if (t.classList.contains('clean') || t.classList.contains('dirty')) continue;
                this.mark(lv, col, safe.includes(col));
                t.classList.add('reveal');
            }
        });
        this.setLevel(-1);
        this.start.hidden = false;
        this.cash.hidden = true;
        if (r.cashed) {
            this.stage.classList.add('won');
            this.info.textContent = `Encaissé à l'étage ${r.level} · ×${r.mult} · ${signed(r.net)}`;
            const box = this.stage.getBoundingClientRect();
            this.app.fx.coins(box.left + box.width / 2, box.top + box.height / 2, 18 + Math.min(80, r.mult * 4));
            this.app.sound.cashout(r.mult);
            if (r.mult >= 10) this.app.showBigWin(r.mult, r.net, this.betNow);
        } else {
            this.info.textContent = `Slip sale à l'étage ${r.level + 1} · ${signed(r.net)}`;
            this.app.sound.lose(Math.abs(r.net));
        }
        this.app.afterGame(r);
        this.app.setBalance(r.balance, r.net > 0);
    }
}
