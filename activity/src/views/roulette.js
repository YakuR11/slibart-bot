// Roulette europeenne : un vrai tapis (pleins, chevaux, carres, transversales, sixains, douzaines,
// colonnes, chances simples), des jetons qu'on empile, une roue qui tourne et une bille qui tombe.
// Les paris et les gains viennent du meme fichier que le serveur : src/lib/roulette-math.js.
import rl from '../../../src/lib/roulette-math.js';
import { el, fmt, signed, gameShell, bigButton } from '../ui.js';
import { slip } from '../art.js';
import { reduceMotion } from '../fx.js';

const CHIPS = [10, 100, 1000, 10_000, 100_000];
const CHIP_COLORS = { 10: '#e6ecf5', 100: '#ff4f6a', 1000: '#3d7bff', 10000: '#2ee62b', 100000: '#ffd23f' };
const MAX_TOTAL = 1_000_000;
const STEP = 360 / 37;
const SPIN_MS = 4200;
const NS = 'http://www.w3.org/2000/svg';
const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n));
const chipColor = (amount) => CHIP_COLORS[[...CHIPS].reverse().find((c) => amount >= c) || 10];
const polar = (r, deg) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
const svg = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
};

export class RouletteView {
    constructor(view, app) {
        this.app = app;
        this.view = view;
        const { stage, console: c } = gameShell(view, 'Roulette');
        this.stage = stage;
        stage.classList.add('rt-stage');
        this.bets = new Map(); // id du pari -> montant
        this.undo = []; // pile des jetons poses
        this.chip = 100;
        this.wheelDeg = 0;
        this.ball = { deg: 0, r: 108 };
        this.last = null; // dernier numero sorti (la bille reste dans sa case)

        // ---- roue ----
        this.hist = el('div.rt-hist', { 'aria-label': 'Derniers numéros' });
        this.info = el('div.rt-info', { text: 'Pose tes jetons' });
        this.sub = el('div.rt-sub', { text: 'Clic : poser · clic droit : retirer' });
        this.buildWheel();
        stage.append(el('div.rt-top', {}, this.wheelBox, el('div.rt-side', {}, this.info, this.sub, this.hist)));

        // ---- tapis ----
        this.cells = new Map(); // id -> element qui porte le jeton
        this.table = this.buildTable();
        stage.append(this.table);
        this.table.addEventListener('click', (e) => { const t = e.target.closest('[data-id]'); if (t) this.add(t.dataset.id, this.chip); });
        this.table.addEventListener('contextmenu', (e) => { const t = e.target.closest('[data-id]'); if (t) { e.preventDefault(); this.remove(t.dataset.id, this.chip); } });
        this.table.addEventListener('pointerover', (e) => this.hover(e.target.closest('[data-id]')?.dataset.id));
        this.table.addEventListener('pointerleave', () => this.hover(null));
        this.table.addEventListener('focusin', (e) => this.hover(e.target.closest('[data-id]')?.dataset.id));

        // ---- console ----
        this.chipRow = el('div.rt-chips', { role: 'radiogroup', 'aria-label': 'Valeur du jeton' }, ...CHIPS.map((v) => el('button.rt-pick', {
            type: 'button', role: 'radio', 'aria-checked': String(v === this.chip), 'aria-label': `Jeton de ${fmt(v)}`, text: short(v),
            style: { '--chip': CHIP_COLORS[v] }, dataset: { v: String(v) }, onclick: () => this.setChip(v),
        })));
        this.total = el('div.rt-total', {}, el('span', { text: 'Sur le tapis' }), el('b', { text: '0 RB' }));
        this.btn = bigButton('Lancer la bille', () => this.play());
        this.gain = el('p.hint.gain');
        const tool = (text, fn, label) => el('button.chip.wide', { type: 'button', text, 'aria-label': label || text, onclick: fn });
        this.tools = el('div.bet-row.rt-tools', {},
            tool('Annuler', () => this.undoLast(), 'Annuler le dernier jeton'),
            tool('Effacer', () => this.clear(), 'Retirer tous les jetons'),
            tool('½', () => this.scale(0.5), 'Diviser toutes les mises par deux'),
            tool('×2', () => this.scale(2), 'Doubler toutes les mises'));
        c.append(el('div.field', {}, el('span.field-label', { text: 'Jeton' }), this.chipRow), this.total, this.btn, this.gain, this.tools,
            el('p.hint', { text: 'Tes jetons restent sur le tapis : Espace relance la bille. Vise les lignes entre les numéros pour un cheval, les coins pour un carré, le bas d\'une colonne pour une transversale.' }),
            el('details.rt-pays', {}, el('summary', { text: 'Ce que paie chaque pari' }), el('ul', {},
                ...[['Plein (1 numéro)', '×36'], ['Cheval (2)', '×18'], ['Transversale (3)', '×12'], ['Carré (4)', '×9'], ['Sixain (6)', '×6'], ['Douzaine, colonne', '×3'], ['Rouge, pair, 1-18…', '×2']].map(([a, b]) => el('li', {}, el('span', { text: a }), el('b', { text: b }))))));
        this.paint();
        this.loop = this.loop.bind(this);
    }

    // -----------------------------------------------------------------------
    // construction
    // -----------------------------------------------------------------------
    buildWheel() {
        const root = svg('svg', { viewBox: '-125 -125 250 250', class: 'rt-wheel', role: 'img', 'aria-label': 'Roue de la roulette' });
        root.append(svg('circle', { r: 123, fill: '#0b1a24' }), svg('circle', { r: 118, fill: '#2f4553' }), svg('circle', { r: 112, fill: '#132a38' }));
        this.wheelG = svg('g');
        rl.WHEEL.forEach((n, i) => {
            const a0 = i * STEP - STEP / 2;
            const [x0, y0] = polar(98, a0);
            const [x1, y1] = polar(98, a0 + STEP);
            const [x2, y2] = polar(60, a0 + STEP);
            const [x3, y3] = polar(60, a0);
            const fill = { red: '#e11d48', black: '#1a2c38', green: '#1fb81d' }[rl.color(n)];
            this.wheelG.append(svg('path', { d: `M${x0} ${y0}A98 98 0 0 1 ${x1} ${y1}L${x2} ${y2}A60 60 0 0 0 ${x3} ${y3}Z`, fill, stroke: '#0b1a24', 'stroke-width': 0.8 }));
            const [tx, ty] = polar(86, i * STEP);
            const t = svg('text', { x: tx, y: ty, transform: `rotate(${i * STEP} ${tx} ${ty})`, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 9.5, 'font-weight': 800, fill: '#fff' });
            t.textContent = String(n);
            this.wheelG.append(t);
        });
        this.wheelG.append(svg('circle', { r: 60, fill: '#213743', stroke: '#0b1a24' }), svg('circle', { r: 46, fill: '#132a38' }));
        for (let k = 0; k < 4; k++) { const [x, y] = polar(54, k * 90 + 45); this.wheelG.append(svg('circle', { cx: x, cy: y, r: 3.4, fill: '#ffd23f' })); }
        const hub = svg('g');
        hub.innerHTML = slip(-22, -15, 44, { fill: '#fff', band: '#2ee62b' });
        this.wheelG.append(hub);
        this.ballEl = svg('circle', { r: 5.2, fill: '#fff', stroke: '#c9d2e0', 'stroke-width': 0.8, class: 'rt-ball' });
        root.append(this.wheelG, this.ballEl);
        this.resultEl = el('div.rt-result', { hidden: true });
        this.wheelBox = el('div.rt-wheel-box', {}, root, this.resultEl);
        this.draw();
    }

    buildTable() {
        const spot = (id, x, y) => {
            const s = el('button.rt-spot', { type: 'button', tabindex: '-1', 'aria-label': `${rl.BETS.get(id).kind} ${rl.BETS.get(id).label}`, dataset: { id }, style: { left: `${x * 100}%`, top: `${y * 100}%` } });
            this.cells.set(id, s);
            return s;
        };
        const cell = (id, cls, text, label) => {
            const b = el(`button.rt-cell${cls}`, { type: 'button', 'aria-label': label || text, dataset: { id } }, el('span', { text }));
            this.cells.set(id, b);
            return b;
        };
        const nums = el('div.rt-nums');
        this.numEls = new Map();
        for (let r = 0; r < 3; r++) {
            for (let col = 0; col < 12; col++) {
                const n = 3 * col + 3 - r;
                const b = cell(`n${n}`, `.${rl.color(n)}`, String(n), `Numéro ${n}`);
                b.style.gridArea = `${r + 1} / ${col + 1}`;
                this.numEls.set(n, b);
                nums.append(b);
            }
        }
        // points de pari entre les numeros : chevaux, carres, transversales, sixains
        for (let n = 1; n <= 36; n++) {
            const col = Math.floor((n - 1) / 3);
            const r = 3 - (n - 3 * col);
            if (n % 3 !== 0) nums.append(spot(`s${n}-${n + 1}`, (col + 0.5) / 12, r / 3));
            if (n + 3 <= 36) nums.append(spot(`s${n}-${n + 3}`, (col + 1) / 12, (r + 0.5) / 3));
            if (n % 3 !== 0 && n + 4 <= 36) nums.append(spot(`c${n}`, (col + 1) / 12, r / 3));
        }
        for (let col = 0; col < 12; col++) {
            nums.append(spot(`t${3 * col + 1}`, (col + 0.5) / 12, 1));
            if (col < 11) nums.append(spot(`l${3 * col + 1}`, (col + 1) / 12, 1));
        }
        nums.append(spot('s0-3', 0, 0.5 / 3), spot('s0-2', 0, 1.5 / 3), spot('s0-1', 0, 2.5 / 3), spot('t0b', 0, 1 / 3), spot('t0a', 0, 2 / 3), spot('c0', 0, 1));

        const zero = cell('n0', '.green.zero', '0', 'Numéro 0');
        this.numEls.set(0, zero);
        const cols = el('div.rt-cols', {}, ...[3, 2, 1].map((k) => cell(`k${k}`, '.out', '2:1', `Colonne ${k}`)));
        const doz = el('div.rt-row3', {}, cell('d1', '.out', '1 à 12', 'Première douzaine'), cell('d2', '.out', '13 à 24', 'Deuxième douzaine'), cell('d3', '.out', '25 à 36', 'Troisième douzaine'));
        const out = el('div.rt-row6', {},
            cell('low', '.out', '1-18'), cell('even', '.out', 'Pair'), cell('red', '.out.red', 'Rouge'),
            cell('black', '.out.black', 'Noir'), cell('odd', '.out', 'Impair'), cell('high', '.out', '19-36'));
        return el('div.rt-table', {}, zero, nums, cols, el('i'), doz, el('i'), el('i'), out, el('i'));
    }

    // -----------------------------------------------------------------------
    // jetons
    // -----------------------------------------------------------------------
    sum() { let t = 0; for (const v of this.bets.values()) t += v; return t; }

    setChip(v) {
        this.chip = v;
        for (const b of this.chipRow.children) b.setAttribute('aria-checked', String(Number(b.dataset.v) === v));
        this.app.sound.chip(true);
    }

    add(id, amount) {
        if (this.busy || !rl.BETS.has(id)) return;
        if (!this.bets.has(id) && this.bets.size >= rl.MAX_BETS) return this.app.toast(`${rl.MAX_BETS} paris différents maximum.`, true);
        if (this.sum() + amount > MAX_TOTAL) return this.app.toast(`Maximum ${fmt(MAX_TOTAL)} RB sur le tapis.`, true);
        if (this.sum() + amount > this.app.balance()) { this.app.sound.error(); return this.app.toast('Pas assez de Rokbux pour ce jeton.', true); }
        this.clearResult();
        this.bets.set(id, (this.bets.get(id) || 0) + amount);
        this.undo.push({ id, amount });
        this.app.sound.unlock();
        this.app.sound.chip(true);
        this.paint(id);
    }

    remove(id, amount) {
        if (this.busy || !this.bets.has(id)) return;
        this.clearResult();
        const left = this.bets.get(id) - amount;
        if (left > 0) this.bets.set(id, left); else this.bets.delete(id);
        this.app.sound.chip(false);
        this.paint();
    }

    undoLast() {
        if (this.busy) return;
        const last = this.undo.pop();
        if (last) this.remove(last.id, last.amount);
    }

    clear() {
        if (this.busy) return;
        this.clearResult();
        this.bets.clear();
        this.undo = [];
        this.paint();
    }

    scale(k) {
        if (this.busy || !this.bets.size) return;
        const next = new Map([...this.bets].map(([id, v]) => [id, Math.max(1, Math.floor(v * k))]));
        let t = 0;
        for (const v of next.values()) t += v;
        if (t > MAX_TOTAL) return this.app.toast(`Maximum ${fmt(MAX_TOTAL)} RB sur le tapis.`, true);
        if (t > this.app.balance()) return this.app.toast('Pas assez de Rokbux pour doubler.', true);
        this.clearResult();
        this.bets = next;
        this.undo = [];
        this.app.sound.chip(true);
        this.paint();
    }

    paint(bumpId = null) {
        for (const [id, node] of this.cells) {
            const amount = this.bets.get(id);
            let chip = node.querySelector('.rt-chip');
            if (!amount) { chip?.remove(); continue; }
            if (!chip) { chip = el('i.rt-chip'); node.append(chip); }
            chip.textContent = short(amount);
            chip.style.setProperty('--chip', chipColor(amount));
            if (id === bumpId) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
        }
        const t = this.sum();
        this.total.lastChild.textContent = `${fmt(t)} RB${this.bets.size > 1 ? ` · ${this.bets.size} paris` : ''}`;
        this.btn.disabled = this.busy || !t;
        // le meilleur cas : la case qui rapporterait le plus
        let best = 0;
        if (t) for (let n = 0; n <= 36; n++) best = Math.max(best, rl.settle([...this.bets].map(([id, amount]) => ({ id, amount })), n).payout - t);
        this.gain.textContent = t ? `Meilleur numéro : ${best > 0 ? '+' : ''}${fmt(best)} RB` : '';
    }

    /** survol d'un pari : les numeros qu'il couvre s'eclairent */
    hover(id) {
        if (this.hl === id) return;
        this.hl = id;
        const nums = id ? new Set(rl.BETS.get(id)?.nums) : null;
        for (const [n, node] of this.numEls) node.classList.toggle('hl', !!nums && nums.has(n));
    }

    clearResult() {
        for (const node of this.cells.values()) node.classList.remove('win', 'won', 'lost');
        this.resultEl.hidden = true;
    }

    // -----------------------------------------------------------------------
    // roue
    // -----------------------------------------------------------------------
    draw() {
        this.wheelG.setAttribute('transform', `rotate(${this.wheelDeg})`);
        const [x, y] = polar(this.ball.r, this.ball.deg);
        this.ballEl.setAttribute('cx', x);
        this.ballEl.setAttribute('cy', y);
    }

    /** la roue tourne doucement au repos, la bille reste dans sa case */
    loop(now) {
        if (!this.visible) { this.raf = 0; return; }
        const dt = Math.min(50, now - (this.lastT || now));
        this.lastT = now;
        if (!this.spinning && !reduceMotion) {
            this.wheelDeg = (this.wheelDeg + dt * 0.012) % 360;
            if (this.last !== null) this.ball.deg = this.wheelDeg + rl.WHEEL.indexOf(this.last) * STEP;
            else this.ball.deg = (this.ball.deg - dt * 0.03) % 360;
            this.draw();
        }
        this.raf = requestAnimationFrame(this.loop);
    }

    show(on = true) {
        this.visible = on !== false && !this.view.hidden;
        if (this.visible && !this.raf) { this.lastT = 0; this.raf = requestAnimationFrame(this.loop); }
        this.paint();
    }

    key() { this.play(); }

    /** la roue ralentit dans un sens, la bille dans l'autre, puis elle tombe dans la case tiree */
    animate(n) {
        return new Promise((resolve) => {
            const dur = reduceMotion ? 300 : SPIN_MS;
            const w0 = this.wheelDeg;
            const w1 = w0 + 360 * 2 + Math.random() * 360;
            const b1 = w1 + rl.WHEEL.indexOf(n) * STEP; // la ou la bille doit finir
            const b0 = b1 + 360 * 5 + ((this.ball.deg - b1) % 360); // elle part d'ou elle est, 5 tours a l'envers
            const t0 = performance.now();
            let lastPocket = -1;
            this.spinning = true;
            const step = (now) => {
                const t = Math.min(1, (now - t0) / dur);
                const e = 1 - (1 - t) ** 3;
                this.wheelDeg = w0 + (w1 - w0) * e;
                this.ball.deg = b0 + (b1 - b0) * e;
                // la bille quitte la piste aux deux tiers, avec deux petits rebonds
                const d = Math.max(0, (t - 0.62) / 0.38);
                const drop = 1 - (1 - d) ** 2;
                this.ball.r = 108 - 29 * drop + (d > 0 && d < 1 ? Math.abs(Math.sin(d * Math.PI * 3)) * 5 * (1 - d) : 0);
                this.draw();
                const pocket = Math.floor(((this.ball.deg - this.wheelDeg) % 360 + 360) % 360 / STEP);
                if (pocket !== lastPocket) { lastPocket = pocket; this.app.sound.spinTick(t); }
                if (t < 1) requestAnimationFrame(step);
                else { this.wheelDeg %= 360; this.ball.deg = this.wheelDeg + rl.WHEEL.indexOf(n) * STEP; this.spinning = false; resolve(); }
            };
            requestAnimationFrame(step);
        });
    }

    async play() {
        if (this.busy) return false;
        const total = this.sum();
        if (!total) { this.app.toast('Pose au moins un jeton sur le tapis.', true); return false; }
        if (total < this.app.minBet) { this.app.toast(`Mise minimum : ${this.app.minBet}`, true); return false; }
        if (total > this.app.balance()) { this.app.sound.error(); this.app.toast('Pas assez de Rokbux pour ces jetons.', true); return false; }
        this.busy = true;
        this.clearResult();
        this.table.classList.add('locked');
        this.paint();
        this.app.sound.unlock();
        this.app.sound.lever();
        const bets = [...this.bets].map(([id, amount]) => ({ id, amount }));
        const r = await this.app.req('roulette', { bets });
        if (r.error) {
            this.busy = false;
            this.table.classList.remove('locked');
            this.paint();
            this.app.toast(r.error, true);
            return false;
        }
        this.app.setBalance(r.balance - (total + r.net));
        this.info.textContent = 'Rien ne va plus…';
        this.sub.textContent = `${fmt(total)} RB en jeu`;
        this.stage.classList.add('spin');
        await this.animate(r.n);
        this.stage.classList.remove('spin');
        this.last = r.n;
        this.reveal(r, total);
        this.busy = false;
        this.table.classList.remove('locked');
        this.paint();
        return true;
    }

    reveal(r, total) {
        const won = r.net > 0;
        const name = { red: 'rouge', black: 'noir', green: 'vert' }[r.color];
        this.resultEl.hidden = false;
        this.resultEl.className = `rt-result ${r.color}`;
        this.resultEl.textContent = String(r.n);
        this.numEls.get(r.n)?.classList.add('win');
        const winners = new Set(r.wins.map((w) => w.id));
        for (const id of this.bets.keys()) this.cells.get(id)?.classList.add(winners.has(id) ? 'won' : 'lost');
        this.info.textContent = `${r.n} ${name}${r.n ? ` · ${r.n % 2 ? 'impair' : 'pair'}` : ''}`;
        this.sub.textContent = won ? `${r.wins.length} pari${r.wins.length > 1 ? 's' : ''} gagnant${r.wins.length > 1 ? 's' : ''} · ${signed(r.net)} RB` : r.net === 0 ? 'Mise récupérée' : `${signed(r.net)} RB`;
        this.sub.className = `rt-sub ${won ? 'win' : r.net < 0 ? 'lose' : ''}`;
        this.hist.prepend(el(`span.${r.color}`, { text: String(r.n) }));
        while (this.hist.children.length > 12) this.hist.lastChild.remove();
        if (won) {
            const box = (this.numEls.get(r.n) || this.stage).getBoundingClientRect();
            this.app.fx.coins(box.left + box.width / 2, box.top + box.height / 2, Math.min(90, 14 + r.mult * 5));
            this.app.fx.flash('#2ee62b', 0.25);
            this.app.sound.win(r.mult >= 10 ? 3 : r.mult >= 3 ? 2 : 1);
            if (r.mult >= 10) this.app.showBigWin(r.mult, r.net, total);
        } else if (r.net < 0) {
            this.app.sound.lose(Math.abs(r.net));
        }
        this.app.afterGame(r);
        this.app.setBalance(r.balance, won);
    }
}
