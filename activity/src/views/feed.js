// Centre des paris (colonne de gauche) : tout le monde voit tous les paris, en deux temps.
// Petite mise = petite ligne. Grosse mise = grosse carte. All-in > 1000 = taille max + ecran qui s'illumine.
// Le resultat rayonne en vert (gagne) ou rouge (perdu), d'autant plus fort que la somme est grosse.
import { el, fmt, signed } from '../ui.js';
import { avatarEl } from '../avatar.js';

const GAMES = {
    plinko: ['🎯', 'Plinko'], crash: ['🚀', 'Crash'], roulette: ['🎡', 'Roulette'], slots: ['🎰', 'Slots'],
    blackjack: ['🃏', 'Blackjack'], mines: ['💣', 'Mines'], loto: ['🎟️', 'Loto'], duel: ['⚔️', 'Duel'],
};

export class FeedView {
    constructor(app) {
        this.app = app;
        this.list = document.getElementById('live-feed');
        this.cards = new Map();
    }

    init(entries) {
        this.list.replaceChildren();
        this.cards.clear();
        for (const e of entries) this.upsert(e, true);
        if (!entries.length) this.list.append(el('li.lf-empty', { text: 'Aucun pari pour l\'instant… lance-toi !' }));
    }

    onMessage(m) {
        if (m.type === 'feed:init') return this.init(m.entries || []);
        if (m.type === 'feed:bet') return this.upsert(m.entry);
        if (m.type === 'feed:result') return this.result(m.entry);
        if (m.type === 'feed:cancel') {
            const c = this.cards.get(m.id);
            c?.classList.add('gone');
            setTimeout(() => c?.remove(), 300);
            this.cards.delete(m.id);
        }
    }

    upsert(e, quiet = false) {
        this.list.querySelector('.lf-empty')?.remove();
        let card = this.cards.get(e.id);
        const fresh = !card;
        if (!card) {
            card = el('li.lf');
            this.cards.set(e.id, card);
            this.list.prepend(card);
            while (this.list.children.length > 30) {
                const last = this.list.lastChild;
                for (const [k, v] of this.cards) if (v === last) this.cards.delete(k);
                last.remove();
            }
        }
        this.fill(card, e);
        if (fresh && !quiet) {
            card.classList.add('enter');
            if (e.tier >= 4) this.app.sound.betBig(e.tier);
        }
        if (e.state === 'done') this.paint(card, e);
    }

    fill(card, e) {
        const [emoji, label] = GAMES[e.game] || ['🎲', e.game];
        card.className = `lf t${e.tier}${e.allin ? ' allin' : ''}${e.state === 'live' ? ' live' : ''}${card.classList.contains('enter') ? ' enter' : ''}`;
        const who = el('div.lf-who', {}, avatarEl(e.player, e.tier >= 4 ? 34 : e.tier >= 3 ? 28 : 22, { onClick: (id) => this.app.openProfile(id) }));
        if (e.vs) who.append(el('span.lf-vs', { text: 'vs' }), avatarEl(e.vs, e.tier >= 3 ? 28 : 22, { onClick: (id) => this.app.openProfile(id) }));
        const name = e.vs ? `${e.player.name} vs ${e.vs.name}` : e.player.name;
        const verb = e.allin ? 'fait TAPIS' : e.game === 'loto' ? 'achète' : e.game === 'duel' ? 'duel pour' : 'mise';
        const what = e.game === 'loto' && e.text && e.state === 'live' ? e.text : `${fmt(e.bet)}`;
        card.replaceChildren(
            who,
            el('div.lf-body', {},
                el('div.lf-line', {}, el('b', { text: name })),
                el('div.lf-sub', {}, `${verb} `, el('strong', { text: e.game === 'loto' && e.state === 'live' ? what : `${what} RB` }), ` · ${emoji} ${label}${e.text && e.state !== 'live' && e.game !== 'loto' ? ` · ${e.text}` : ''}`)),
            el('div.lf-res', {}, e.state === 'live' ? el('span.lf-dots', {}, el('i'), el('i'), el('i')) : ''),
        );
    }

    /** couleur + intensite du halo */
    paint(card, e) {
        const res = card.querySelector('.lf-res');
        const won = e.net > 0;
        const even = e.net === 0;
        card.classList.remove('live');
        card.classList.add(even ? 'even' : won ? 'won' : 'lost');
        card.style.setProperty('--gl', String(e.glow ?? 0.3));
        if (e.game === 'loto' && even) {
            res.replaceChildren(el('span.lf-amt', { text: '🎟️' }));
            return;
        }
        if (e.game === 'duel' && e.winner) {
            const w = e.winner === e.player.id ? e.player : e.vs;
            res.replaceChildren(el('span.lf-amt', { text: `🏆 ${w.name.split(' ')[0]}` }));
            return;
        }
        res.replaceChildren(el('span.lf-amt', { text: even ? '±0' : signed(e.net) }));
    }

    result(e) {
        this.upsert(e, true);
        const card = this.cards.get(e.id);
        if (!card) return;
        card.classList.remove('lf-hit');
        void card.offsetWidth;
        card.classList.add('lf-hit');
        const mine = e.player.id === this.app.me()?.id || e.vs?.id === this.app.me()?.id;
        const won = e.net > 0;
        const bigLoss = !won && (e.allin || Math.abs(e.net) >= 2000);
        const box = card.getBoundingClientRect();
        if (bigLoss) {
            // on rigole bien fort
            card.append(el('span.lf-lol', { text: '🤣' }));
            this.app.fx.emojis('🤣', box.left + box.width / 2, box.top + box.height / 2, e.allin ? 14 : 6, e.allin ? 1.2 : 0.7);
            if (!mine) this.app.sound.laugh();
        } else if (won && e.tier >= 3 && !mine) this.app.sound.friendCash();

        // all-in : tout l'ecran s'illumine chez tout le monde
        if (e.allin) {
            this.app.fx.glow(won ? '#3dff8a' : '#ff3b3b', 1, 3200);
            this.app.hype(e);
        } else if (e.hype) {
            // mise >= 2000 gagnee : tout le monde est notifie (+ GIF perso)
            this.app.fx.glow('#3dff8a', 0.6, 2400);
            this.app.hype(e);
        } else if (Math.abs(e.net) >= 1000 && !mine) {
            this.app.fx.glow(won ? '#3dff8a' : '#ff3b3b', e.glow * 0.5, 1400);
        }
    }
}
