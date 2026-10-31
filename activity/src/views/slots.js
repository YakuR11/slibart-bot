// Slots facon "video slot" : grille 6 x 5, gains en paquets (8 symboles ou plus n'importe ou),
// cascades, bombes multiplicatrices, tours gratuits, achat du bonus.
// Le serveur tire tout (1 a 100 tours d'un coup), on rejoue juste l'animation :
// - Normal / Turbo / Éclair pour la vitesse, clic sur la grille = passer l'animation du tour
// - "Lancer ×10/25/50/100" : rafale, avec Stop qui saute directement au bilan
// - anticipation quand 3 slips sont deja tombes, multiplicateur qui grimpe pendant le bonus
import { el, fmt, signed, betBox, gameShell } from '../ui.js';

const COLS = 6;
const ROWS = 5;
const SYM = { a: '🍒', b: '🍋', c: '🍇', d: '🍉', e: '🔔', f: '💎', g: '👑', h: '7️⃣', s: '🩲' };
const TINT = { a: '#ff5d73', b: '#ffe066', c: '#b07cff', d: '#5fe08a', e: '#ffc14d', f: '#5ad7ff', g: '#ffd24a', h: '#ff4d4d', s: '#e07cff' };
// gains en jeu normal (x la mise) pour 8-9, 10-11, 12+ : memes chiffres que le serveur (slotmath.js x 0,47)
const PAYTABLE = [
    ['h', [3.76, 9.4, 18.8]], ['g', [0.94, 2.35, 7.05]], ['f', [0.7, 0.94, 5.64]], ['e', [0.47, 0.7, 4.7]],
    ['d', [0.38, 0.56, 3.76]], ['c', [0.24, 0.47, 2.35]], ['b', [0.19, 0.42, 1.88]], ['a', [0.12, 0.35, 0.94]],
];
const SPEEDS = { normal: 1, turbo: 0.38, eclair: 0 };
const BATCH = [10, 25, 50, 100];
const BUY_PRICE = 100;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const xfmt = (v) => (v >= 100 ? fmt(v) : String(Math.round(v * 100) / 100).replace('.', ','));
const randSym = () => 'abcdefgh'[Math.floor(Math.random() * 8)];

export class SlotsView {
    constructor(view, app) {
        this.app = app;
        this.view = view;
        this.busy = false;
        try { this.speed = localStorage.getItem('slots-speed') || 'normal'; } catch { this.speed = 'normal'; }
        if (!(this.speed in SPEEDS)) this.speed = 'normal';

        const { stage, console: c } = gameShell(view, 'Slots');
        this.stage = stage;
        stage.classList.add('sx-stage');

        // --- haut : jackpot, bonus, multiplicateur
        this.jp = el('div.sx-pill.jp', {}, el('small', { text: 'Jackpot' }), el('b', { text: '…' }));
        this.fsPill = el('div.sx-pill.fs', { hidden: true }, el('small', { text: 'Tours gratuits' }), el('b', { text: '' }));
        this.multPill = el('div.sx-pill.mult', { hidden: true }, el('small', { text: 'Multi bonus' }), el('b', { text: '×0' }));
        this.top = el('div.sx-top', {}, this.jp, this.fsPill, this.multPill);

        // --- grille
        this.cols = Array.from({ length: COLS }, () => el('div.sx-col'));
        this.grid = el('div.sx-grid', { role: 'img', 'aria-label': 'Grille des slots', onclick: () => { if (this.busy) this.skip = true; } }, ...this.cols);
        this.bubble = el('div.sx-bubble', { hidden: true });
        this.banner = el('div.sx-banner', { hidden: true });
        this.frame = el('div.sx-frame', {}, this.grid, this.bubble, this.banner);

        // --- bas : gain du tour, progression de la rafale
        this.winLine = el('div.sx-win', {}, el('small', { text: 'Gain' }), el('b', { text: '0' }));
        this.progress = el('div.sx-prog', { hidden: true });
        this.stopBtn = el('button.chip.sx-stop', { type: 'button', text: 'Stop', hidden: true, onclick: () => { this.stopReq = true; this.skip = true; } });
        this.bottom = el('div.sx-bottom', {}, this.winLine, this.progress, this.stopBtn);
        stage.append(this.top, this.frame, this.bottom);
        this.render(this.randomGrid(), true);

        // --- console
        this.bet = betBox(() => app.balance(), app.minBet);
        this.spinBtn = el('button.drop.sx-spin', { type: 'button', text: 'SPIN', onclick: () => this.run(1) });
        this.batchRow = el('div.sx-batch', {}, ...BATCH.map((n) => el('button.chip', { type: 'button', text: `×${n}`, 'aria-label': `Lancer ${n} tours d'un coup`, onclick: () => this.run(n) })));
        this.speedSeg = el('div.seg', { role: 'radiogroup', 'aria-label': 'Vitesse' }, ...Object.entries({ normal: 'Normal', turbo: 'Turbo', eclair: 'Éclair' }).map(([k, label]) => el('button', {
            type: 'button', role: 'radio', 'aria-checked': String(k === this.speed), text: label,
            onclick: (e) => this.setSpeed(k, e.currentTarget),
        })));
        this.buyBtn = el('button.sx-buy', { type: 'button', onclick: () => this.buy() });
        this.summary = el('div.sx-summary', { hidden: true });
        this.bet.input.addEventListener('input', () => this.paintBuy());
        c.append(
            this.bet.node,
            this.spinBtn,
            el('div.field', {}, el('span.field-label', { text: 'Lancer plein de tours d\'un coup' }), this.batchRow),
            el('div.field', {}, el('span.field-label', { text: 'Vitesse' }), this.speedSeg),
            this.buyBtn,
            this.summary,
            el('details.sx-pays', {},
                el('summary', { text: 'Table des gains' }),
                el('p.hint', { text: '8 symboles identiques ou plus n\'importe où. Ils explosent, d\'autres tombent : ça peut regagner. 4 🩲 = 10 tours gratuits où les bombes 💣 s\'additionnent jusqu\'à la fin.' }),
                el('div.sx-pay-row.head', {}, el('span'), el('span', { text: '8+' }), el('span', { text: '10+' }), el('span', { text: '12+' })),
                ...PAYTABLE.map(([s, p]) => el('div.sx-pay-row', {}, el('span', { text: SYM[s] }), ...p.map((v) => el('b', { text: `×${xfmt(v)}` })))),
                el('div.sx-pay-row.scat', {}, el('span', { text: SYM.s }), el('b', { text: '4 : ×3' }), el('b', { text: '5 : ×5' }), el('b', { text: '6 : ×100' })),
                el('p.hint', { text: 'Mise 100+ : 6 slips en jeu normal raflent aussi le jackpot.' })),
        );
        this.paintBuy();
    }

    setSpeed(k, btn) {
        this.speed = k;
        try { localStorage.setItem('slots-speed', k); } catch { /* rien */ }
        for (const b of this.speedSeg.children) b.setAttribute('aria-checked', String(b === btn));
    }

    paintBuy() {
        const bet = this.bet.get() || 0;
        const price = bet * BUY_PRICE;
        this.buyBtn.replaceChildren(el('b', { text: this.confirmBuy ? 'Confirmer l\'achat ?' : 'Acheter le bonus' }), el('small', { text: `${fmt(price)} RB · 10 tours gratuits direct` }));
        // le solde n'est pas encore connu au lancement : on verifie au clic plutot que de griser
        this.buyBtn.disabled = this.busy || !(bet >= this.app.minBet);
        this.buyBtn.classList.toggle('poor', price > this.app.balance());
    }

    async show() {
        // au lancement la connexion temps reel peut ne pas etre prete : on reessaie un peu
        let r = await this.app.req('slots.jackpot');
        for (let k = 0; k < 10 && r.error; k++) {
            await wait(800);
            r = await this.app.req('slots.jackpot');
        }
        if (r.jackpot) this.jp.lastChild.textContent = fmt(r.jackpot);
        this.paintBuy();
        // le bouton bonus suit le solde (il arrive apres l'ouverture)
        clearInterval(this.buyTimer);
        this.buyTimer = setInterval(() => { if (!this.view.hidden && !this.busy) this.paintBuy(); }, 1500);
    }

    // -----------------------------------------------------------------------
    // grille
    // -----------------------------------------------------------------------
    randomGrid() {
        return Array.from({ length: COLS }, () => Array.from({ length: ROWS }, randSym));
    }

    cell(c) {
        if (c[0] === 'x') return el('div.sx-cell.bomb', {}, el('span', { text: '💣' }), el('b', { text: `×${c.slice(1)}` }));
        return el(`div.sx-cell${c === 's' ? '.scatter' : ''}`, { style: { '--tint': TINT[c] || '#fff' } }, el('span', { text: SYM[c] || '?' }));
    }

    render(grid, instant = false, k = 1) {
        this.cells = grid.map((col, x) => {
            const nodes = col.map((c) => this.cell(c));
            this.cols[x].replaceChildren(...nodes);
            if (!instant) {
                nodes.forEach((n) => {
                    n.style.transform = `translateY(-${ROWS * 110}%)`;
                    n.style.transition = 'none';
                });
            }
            return nodes;
        });
    }

    /** chute colonne par colonne, avec suspense si 3 slips sont deja la */
    async dropIn(grid, k) {
        this.render(grid, k === 0, k);
        if (k === 0) return;
        let scat = 0;
        for (let x = 0; x < COLS; x++) {
            const tease = scat >= 3;
            if (tease && !this.skip) {
                this.cols[x].classList.add('tease');
                this.app.sound.heartbeat?.();
            }
            const dur = (tease && !this.skip ? 900 : 260) * k;
            this.cells[x].forEach((n, y) => {
                n.style.transition = `transform ${this.skip ? 0 : dur}ms cubic-bezier(.2,.9,.3,1.15) ${this.skip ? 0 : (ROWS - y) * 18 * k}ms`;
                requestAnimationFrame(() => { n.style.transform = 'translateY(0)'; });
            });
            if (!this.skip) await wait(Math.max(40, (tease ? 700 : 90) * k));
            this.cols[x].classList.remove('tease');
            scat += grid[x].filter((c) => c === 's').length;
            this.app.sound.reelStop?.(x % 3);
            if (grid[x].includes('s')) this.app.sound.gem?.(Math.min(6, scat));
        }
        await wait(this.skip ? 0 : 280 * k);
    }

    /** cascade : les gagnants explosent, le reste tombe, de nouveaux arrivent */
    async cascade(step, next, k, spinBet) {
        const gone = new Set(step.wins.flatMap((w) => w.cells.map(([x, y]) => `${x}:${y}`)));
        for (const key of gone) {
            const [x, y] = key.split(':').map(Number);
            this.cells[x][y].classList.add('win');
        }
        const pay = step.wins.reduce((a, w) => a + w.pay, 0);
        this.spinWin += pay;
        this.showWin(this.spinWin * spinBet);
        const top = step.wins.slice().sort((a, b) => b.pay - a.pay)[0];
        this.pop(`${SYM[top.sym]} ×${top.count}  +${fmt(pay * spinBet)}`);
        this.app.sound.win?.(pay >= 5 ? 3 : pay >= 1 ? 2 : 1);
        if (k === 0 || this.skip) return this.render(next, true);
        await wait(520 * k);
        for (const key of gone) {
            const [x, y] = key.split(':').map(Number);
            this.cells[x][y].classList.add('boom');
        }
        await wait(240 * k);
        // nouvelle grille : chaque survivant glisse de son ancienne ligne a la nouvelle
        const nodes = next.map((col, x) => {
            const keptRows = step.grid[x].map((_, y) => y).filter((y) => !gone.has(`${x}:${y}`));
            const fresh = ROWS - keptRows.length;
            const list = col.map((c, y) => {
                const n = this.cell(c);
                const from = y < fresh ? -(fresh + 1) * 110 : (keptRows[y - fresh] - y) * 110;
                n.style.transition = 'none';
                n.style.transform = `translateY(${from}%)`;
                return n;
            });
            this.cols[x].replaceChildren(...list);
            return list;
        });
        this.cells = nodes;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            for (const col of nodes) for (const n of col) {
                n.style.transition = `transform ${300 * k}ms cubic-bezier(.3,.9,.3,1.1)`;
                n.style.transform = 'translateY(0)';
            }
        }));
        await wait(340 * k);
    }

    async playSpin(spin, k, spinBet, fsAcc = null) {
        this.spinWin = 0;
        this.showWin(0);
        await this.dropIn(spin.steps[0].grid, this.skip ? 0 : k);
        for (let i = 0; i < spin.steps.length; i++) {
            const st = spin.steps[i];
            if (!st.wins.length) break;
            await this.cascade(st, spin.steps[i + 1].grid, this.skip ? 0 : k, spinBet);
        }
        // bombes : elles multiplient le gain du tour (ou nourrissent le multi du bonus)
        if (spin.base > 0 && spin.bombs > 0) {
            const bombs = this.grid.querySelectorAll('.sx-cell.bomb');
            bombs.forEach((b) => b.classList.add('hot'));
            this.app.sound.gem?.(6);
            if (fsAcc !== null) {
                this.multPill.hidden = false;
                this.multPill.lastChild.textContent = `×${fsAcc}`;
                this.multPill.classList.remove('bump');
                void this.multPill.offsetWidth;
                this.multPill.classList.add('bump');
                this.pop(`+×${spin.bombs} au multi`);
            } else {
                this.pop(`${xfmt(spin.base)} × ${spin.bombs}`);
            }
            if (k && !this.skip) await wait(700 * k);
        }
    }

    showWin(v) {
        this.winLine.lastChild.textContent = fmt(v);
        this.winLine.classList.toggle('on', v > 0);
    }

    pop(text) {
        this.bubble.textContent = text;
        this.bubble.hidden = false;
        this.bubble.classList.remove('go');
        void this.bubble.offsetWidth;
        this.bubble.classList.add('go');
    }

    async announce(text, sub, k, cls = '') {
        this.banner.className = `sx-banner ${cls}`;
        this.banner.replaceChildren(el('b', { text }), sub ? el('small', { text: sub }) : null);
        this.banner.hidden = false;
        await wait(this.skip || !k ? 350 : 1600 * Math.max(0.5, k));
        this.banner.hidden = true;
    }

    // -----------------------------------------------------------------------
    // un tour complet (jeu normal + bonus eventuel)
    // -----------------------------------------------------------------------
    async playOne(r, bet, k) {
        this.skip = this.stopReq || k === 0;
        this.view.classList.remove('sx-hit', 'sx-miss');
        await this.playSpin(r.spin, k, bet);
        let total = r.spin.win;
        if (r.scatterPay) {
            total += r.scatterPay;
            this.pop(`${r.spin.scatters} ${SYM.s} : +${fmt(r.scatterPay * bet)}`);
        }
        if (r.fs) {
            this.view.classList.add('sx-bonus');
            this.app.fx.flash('#e07cff', 0.5);
            this.app.sound.bigWin?.(1, 1);
            await this.announce('TOURS GRATUITS', `${r.fs.spins.length} tours · les bombes s'additionnent`, k, 'fs');
            this.fsPill.hidden = false;
            let left = 10;
            for (const fs of r.fs.spins) {
                if (this.stopReq) this.skip = true;
                left--;
                this.fsPill.lastChild.textContent = `${Math.max(0, left)} restants`;
                await this.playSpin(fs, k * 0.85, bet, fs.mult);
                total += fs.win;
                this.showWin(total * bet);
                if (fs.extra) {
                    left += fs.extra;
                    await this.announce(`+${fs.extra} TOURS`, null, k * 0.6, 'fs');
                }
            }
            this.fsPill.hidden = true;
            this.multPill.hidden = true;
            this.view.classList.remove('sx-bonus');
            await this.announce(`BONUS : ${fmt(r.fs.total * bet)} RB`, `×${xfmt(r.fs.total)} la mise`, k, 'fs');
        }
        if (r.jp) {
            this.app.fx.confetti(160);
            await this.announce('JACKPOT !!!', `+${fmt(r.jp)} RB`, k || 1, 'jp');
        }
        this.showWin(r.pay);
        this.view.classList.add(r.pay > 0 ? 'sx-hit' : 'sx-miss');
        return r.pay;
    }

    // -----------------------------------------------------------------------
    async run(n, buy = false) {
        if (this.busy) return;
        const bet = this.bet.get();
        if (!(bet >= this.app.minBet)) return this.app.toast(`Mise minimum : ${this.app.minBet}`, true);
        const unit = bet * (buy ? BUY_PRICE : 1);
        if (unit > this.app.balance()) return this.app.toast(buy ? `Il te faut ${fmt(unit)} RB pour le bonus.` : 'Pas assez de Rokbux.', true);
        this.busy = true;
        this.stopReq = false;
        this.setBusy(true);
        this.app.sound.unlock();
        this.app.sound.lever?.();
        this.summary.hidden = true;
        const startBal = this.app.balance();
        this.paintBuy();
        const r = await this.app.req('slots', { bet, n, buy });
        if (r.error) {
            this.busy = false;
            this.setBusy(false);
            return this.app.toast(r.error, true);
        }
        if (r.n < n) this.app.toast(`Solde limité : ${r.n} ${buy ? 'bonus' : 'tours'} lancés au lieu de ${n}.`);
        const k = SPEEDS[this.speed] * (r.n > 1 && this.speed === 'normal' ? 0.7 : 1);
        const batch = r.n > 1;
        this.progress.hidden = !batch;
        this.stopBtn.hidden = !batch;
        let got = 0;
        let i = 0;
        for (const s of r.spins) {
            i++;
            if (this.stopReq) break;
            this.app.setBalance(startBal - unit * i + got);
            const pay = await this.playOne(s, bet, k);
            got += pay;
            this.app.setBalance(startBal - unit * i + got, pay > 0);
            if (batch) this.progress.textContent = `${buy ? 'Bonus' : 'Tour'} ${i}/${r.n} · ${signed(got - unit * i)}`;
            // gros coup : on le compte par rapport a ce que le tour a coute (la mise, ou le prix du bonus)
            const x = pay / unit;
            if (!this.stopReq && (batch ? x >= 50 : x >= 10)) {
                this.app.showBigWin(Math.round(x * 10) / 10, pay, unit);
                if (batch && k) await wait(2600);
            } else if (pay > 0 && k) {
                const box = this.frame.getBoundingClientRect();
                this.app.fx.coins(box.left + box.width / 2, box.top + box.height / 2, Math.min(60, 8 + Math.round(x * 4)));
            }
            if (batch && k) await wait(this.skip ? 60 : 220 * k);
        }
        // fin : solde exact du serveur, bilan si rafale
        if (r.jackpot) this.jp.lastChild.textContent = fmt(r.jackpot);
        this.progress.hidden = true;
        this.stopBtn.hidden = true;
        this.app.afterGame(r);
        this.app.setBalance(r.balance, r.net > 0);
        if (batch || buy) this.showSummary(r, bet);
        else if (r.net < 0) this.app.sound.lose?.(Math.abs(r.net));
        if (batch && r.mult >= 2) this.app.showBigWin(r.mult, r.net, r.cost);
        this.busy = false;
        this.setBusy(false);
    }

    showSummary(r, bet) {
        const won = r.net > 0;
        this.summary.className = `sx-summary ${won ? 'won' : 'lost'}`;
        this.summary.replaceChildren(
            el('b', { text: `${r.buy ? `${r.n} bonus` : `${r.n} tours`} : ${signed(r.net)} RB` }),
            el('span', { text: `Misé ${fmt(r.cost)} · récupéré ${fmt(r.payout)}` }),
            el('span', { text: `Meilleur tour ×${xfmt(r.best)} (${fmt(r.best * bet)} RB)` }),
        );
        this.summary.hidden = false;
        if (!won) this.app.sound.lose?.(Math.abs(r.net));
    }

    setBusy(on) {
        this.spinBtn.disabled = on;
        for (const b of this.batchRow.children) b.disabled = on;
        this.spinBtn.textContent = on ? '…' : 'SPIN';
        this.paintBuy();
    }

    buy() {
        if (this.busy) return;
        const price = (this.bet.get() || 0) * BUY_PRICE;
        if (price > this.app.balance()) return this.app.toast(`Il te faut ${fmt(price)} RB pour le bonus.`, true);
        if (!this.confirmBuy) {
            this.confirmBuy = true;
            this.paintBuy();
            setTimeout(() => { this.confirmBuy = false; this.paintBuy(); }, 3500);
            return;
        }
        this.confirmBuy = false;
        this.run(1, true);
    }
}
