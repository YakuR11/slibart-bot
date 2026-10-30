// Blackjack : cartes qui glissent depuis le sabot et se retournent, croupier qui revele sa carte.
import { el, fmt, signed, betBox, gameShell } from '../ui.js';

const RED = new Set(['♥', '♦']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BlackjackView {
    constructor(view, app) {
        this.app = app;
        this.view = view;
        const { stage, console: c } = gameShell(view, 'Blackjack');
        this.stage = stage;
        stage.classList.add('bj-stage');
        this.dealerRow = el('div.bj-hand');
        this.playerRow = el('div.bj-hand');
        this.dv = el('span.bj-val', { text: '' });
        this.pv = el('span.bj-val', { text: '' });
        this.msg = el('div.bj-msg', { text: 'Mise et distribue !' });
        stage.append(
            el('div.bj-side', {}, el('span.bj-who', { text: 'Croupier' }), this.dv), this.dealerRow,
            this.msg,
            this.playerRow, el('div.bj-side', {}, el('span.bj-who', { text: 'Toi' }), this.pv),
            el('div.bj-rules', { text: 'BLACKJACK PAYE ×2,5 · LE CROUPIER TIRE JUSQU\'À 17' }),
        );
        this.bet = betBox(() => app.balance(), app.minBet);
        this.deal = el('button.drop', { type: 'button', text: 'Distribuer', onclick: () => this.act('deal') });
        this.hit = el('button.bj-btn.hit', { type: 'button', text: '🃏 Tirer', onclick: () => this.act('hit') });
        this.stand = el('button.bj-btn.stand', { type: 'button', text: '✋ Rester', onclick: () => this.act('stand') });
        this.double = el('button.bj-btn.double', { type: 'button', text: '⏫ Doubler', onclick: () => this.act('double') });
        this.actions = el('div.bj-actions', {}, this.hit, this.stand, this.double);
        c.append(this.bet.node, this.deal, this.actions, el('p.hint', { text: 'Fais 21 ou plus que le croupier sans dépasser.' }));
        this.setMode('idle');
        this.shown = { player: 0, dealer: 0 };
    }

    show() {}

    setMode(mode, canDouble = false) {
        this.mode = mode;
        this.deal.hidden = mode === 'play';
        this.actions.hidden = mode !== 'play';
        this.deal.disabled = mode === 'busy';
        for (const b of [this.hit, this.stand, this.double]) b.disabled = mode !== 'play';
        this.double.disabled = mode !== 'play' || !canDouble;
    }

    cardEl(c) {
        const card = el('div.card');
        const inner = el('div.card-in');
        const front = el(`div.card-front${c && RED.has(c.s) ? '.red' : ''}`, {},
            el('span.tl', { text: c ? `${c.r}${c.s}` : '' }), el('span.mid', { text: c ? c.s : '' }), el('span.br', { text: c ? `${c.r}${c.s}` : '' }));
        inner.append(front, el('div.card-back'));
        card.append(inner);
        if (!c) card.classList.add('down');
        return card;
    }

    /** ajoute les cartes manquantes une par une (glisse + retourne) */
    async sync(row, cards, key) {
        const have = row.children.length;
        for (let i = 0; i < cards.length; i++) {
            const c = cards[i];
            if (i < have) {
                // la carte cachee du croupier se retourne
                const old = row.children[i];
                if (old.classList.contains('down') && c) {
                    const fresh = this.cardEl(c);
                    fresh.classList.add('flip-in');
                    old.replaceWith(fresh);
                    this.app.sound.flip();
                    await sleep(380);
                }
                continue;
            }
            const card = this.cardEl(c);
            card.classList.add('deal-in');
            row.append(card);
            this.app.sound.card();
            await sleep(260);
        }
        this.shown[key] = cards.length;
    }

    async act(action) {
        if (this.busy) return;
        const args = { action };
        if (action === 'deal') {
            const bet = this.bet.get();
            if (!(bet >= this.app.minBet)) return this.app.toast(`Mise minimum : ${this.app.minBet}`, true);
            if (bet > this.app.balance()) return this.app.toast('Pas assez de Rokbux.', true);
            args.bet = bet;
            this.dealerRow.replaceChildren();
            this.playerRow.replaceChildren();
            this.msg.className = 'bj-msg';
            this.msg.textContent = '';
            this.dv.textContent = '';
            this.pv.textContent = '';
            this.stage.classList.remove('won', 'lost');
        }
        this.busy = true;
        this.setMode('busy');
        this.app.sound.unlock();
        const r = await this.app.req('blackjack', args);
        if (r.error) {
            this.busy = false;
            this.setMode(this.dealerRow.children.length && !r.done ? 'play' : 'idle');
            return this.app.toast(r.error, true);
        }
        if (action === 'deal' || action === 'double') this.app.setBalance(r.done ? r.balance - (r.bet + r.net) : this.app.balance() - (action === 'double' ? r.bet / 2 : r.bet));
        // la main du joueur d'abord, puis le croupier
        if (action === 'deal') {
            await this.sync(this.playerRow, r.player.slice(0, 1), 'player');
            await this.sync(this.dealerRow, r.dealer.slice(0, 1), 'dealer');
            await this.sync(this.playerRow, r.player.slice(0, 2), 'player');
            await this.sync(this.dealerRow, r.done ? [r.dealer[0], null] : r.dealer, 'dealer');
        }
        await this.sync(this.playerRow, r.player, 'player');
        this.pv.textContent = r.pv;
        if (r.done) {
            this.app.fx.dim(true);
            this.view.classList.add('spotlight');
            await sleep(250);
            await this.sync(this.dealerRow, r.dealer.slice(0, 2), 'dealer');
            for (let i = 2; i < r.dealer.length; i++) {
                await sleep(380);
                await this.sync(this.dealerRow, r.dealer.slice(0, i + 1), 'dealer');
            }
            this.dv.textContent = r.dv;
            this.app.fx.dim(false);
            this.view.classList.remove('spotlight');
            this.finish(r);
        } else {
            this.dv.textContent = `${r.dv} + ?`;
            this.busy = false;
            this.setMode('play', r.canDouble);
        }
    }

    finish(r) {
        this.busy = false;
        this.setMode('idle');
        const won = r.net > 0;
        const text = {
            blackjack: `🂡 BLACKJACK ! ${signed(r.net)}`,
            win: `${r.dv > 21 ? `Le croupier saute (${r.dv}) !` : `${r.pv} contre ${r.dv}, gagné !`} ${signed(r.net)}`,
            push: `${r.pv} partout, mise rendue.`,
            lose: `${r.dv} contre ${r.pv}… ${signed(r.net)}`,
            bust: `Tu sautes avec ${r.pv} 💥 ${signed(r.net)}`,
        }[r.outcome];
        this.msg.textContent = text;
        this.msg.className = `bj-msg show ${won ? 'win' : r.outcome === 'push' ? 'push' : 'lose'}`;
        const box = this.stage.getBoundingClientRect();
        if (won) {
            this.stage.classList.add('won');
            this.app.fx.flash(r.outcome === 'blackjack' ? '#ffd76a' : '#8fe3a1', 0.35);
            this.app.fx.coins(box.left + box.width / 2, box.top + box.height / 2, r.outcome === 'blackjack' ? 50 : 22);
            this.app.sound.win(r.outcome === 'blackjack' ? 2 : 1);
        } else if (r.outcome !== 'push') {
            this.stage.classList.add('lost');
            this.app.fx.shake(this.stage, 0.6);
            this.app.sound.lose(Math.abs(r.net));
        }
        this.app.afterGame(r);
        this.app.setBalance(r.balance, won);
    }
}
