// Lobby du casino : bandeau (evenement en cours ou reprise du dernier jeu), quetes du jour,
// puis la grille des "Slip Originals". Les compteurs "en train de jouer" sont les vrais joueurs
// vus dans le centre des paris sur les 5 dernieres minutes, rien d'invente.
import { el, fmt } from '../ui.js';
import { GAMES, gameArt, heroArt } from '../art.js';

const ACTIVE_MS = 5 * 60_000;

function left(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h >= 1) return `${h} h ${String(m).padStart(2, '0')}`;
    return `${m} min ${String(s % 60).padStart(2, '0')} s`;
}

export class LobbyView {
    constructor(view, app) {
        this.app = app;
        this.view = view;
        this.seen = new Map(); // jeu -> Map(joueur -> derniere mise)
        this.event = null;
        this.last = null;
        try { this.last = localStorage.getItem('casino-last'); } catch { /* rien */ }

        this.heroTitle = el('h2');
        this.heroSub = el('p');
        this.heroCta = el('button.drop.lb-cta', { type: 'button', onclick: () => this.cta() });
        this.heroAlt = el('button.chip.lb-alt', { type: 'button', text: 'Voir mon empire', onclick: () => app.goPage('empire') });
        this.hero = el('section.lb-hero', {},
            el('div.lb-hero-txt', {}, el('span.lb-kicker', { text: 'Slibart Puant · Casino' }), this.heroTitle, this.heroSub, el('div.lb-hero-btns', {}, this.heroCta, this.heroAlt)),
            el('div.lb-hero-art', { html: heroArt() }));

        this.quests = el('section.lb-quests', { hidden: true });

        this.cards = new Map();
        this.grid = el('div.lb-grid', {}, ...GAMES.map((g, i) => {
            const count = el('span.lb-count');
            const card = el('button.lb-card', {
                type: 'button',
                'aria-label': `Jouer à ${g.name}`,
                style: { '--g1': g.g[0], '--g2': g.g[1], '--i': String(i) },
                onclick: () => app.goGame(g.id),
            },
            el('span.lb-tag', { text: g.tag }),
            el('span.lb-art', { html: gameArt(g.id) }),
            el('b.lb-name', { text: g.name }),
            el('span.lb-sub', { text: 'Slip Originals' }));
            this.cards.set(g.id, { card, count, tag: card.querySelector('.lb-tag'), g });
            return el('div.lb-item', {}, card, count);
        }));

        view.replaceChildren(
            this.hero,
            this.quests,
            el('div.lb-head', {}, el('h3', { text: 'Slip Originals' }), el('span', { text: `${GAMES.length} jeux · le serveur tire tout, impossible de tricher` })),
            this.grid,
        );
        this.paintHero();
        this.paintCounts();
        setInterval(() => { if (!this.view.hidden) { this.paintHero(); this.paintCounts(); } }, 1000);
    }

    show() {
        this.paintHero();
        this.paintCounts();
    }

    /** dernier jeu ouvert : sert au bouton "Reprendre" */
    setLast(game) {
        if (!GAMES.some((g) => g.id === game)) return;
        this.last = game;
        try { localStorage.setItem('casino-last', game); } catch { /* rien */ }
        this.paintHero();
    }

    setEvent(ev) {
        this.event = ev && ev.end > Date.now() ? ev : null;
        this.paintHero();
    }

    cta() {
        if (this.event) return this.app.goPage('empire');
        this.app.goGame(this.last || 'mines');
    }

    paintHero() {
        const ev = this.event && this.event.end > Date.now() ? this.event : null;
        this.hero.classList.toggle('event', !!ev);
        if (ev) {
            this.heroTitle.textContent = `${ev.name} : gains ×${ev.mult}`;
            this.heroSub.textContent = `Work, gw, daily, mine, contremaître et toute l'XP sont multipliés par ${ev.mult}. Fin dans ${left(ev.end - Date.now())}.`;
            this.heroCta.textContent = 'Ramasser mes gains';
            this.heroAlt.textContent = this.last ? `Reprendre ${this.name(this.last)}` : 'Jouer aux Mines';
            this.heroAlt.onclick = () => this.app.goGame(this.last || 'mines');
        } else {
            const g = this.last ? this.name(this.last) : null;
            this.heroTitle.textContent = g ? 'Le slip t\'attendait' : 'Bienvenue au casino du slip';
            this.heroSub.textContent = g ? `Ta dernière table : ${g}. Elle est encore chaude.` : '12 jeux, tes potes en direct à gauche, et un slip qui sent très fort.';
            this.heroCta.textContent = g ? `Reprendre ${g}` : 'Jouer aux Mines';
            this.heroAlt.textContent = 'Voir mon empire';
            this.heroAlt.onclick = () => this.app.goPage('empire');
        }
    }

    name(id) { return GAMES.find((g) => g.id === id)?.name || id; }

    /** une mise vue dans le centre des paris */
    track(entry) {
        if (!entry?.game || !entry.player) return;
        if (!this.seen.has(entry.game)) this.seen.set(entry.game, new Map());
        this.seen.get(entry.game).set(entry.player.id, Number(entry.at) || Date.now());
        if (!this.view.hidden) this.paintCounts();
    }

    paintCounts() {
        const now = Date.now();
        const counts = new Map();
        for (const [game, players] of this.seen) {
            for (const [id, at] of players) if (now - at > ACTIVE_MS) players.delete(id);
            counts.set(game, players.size);
        }
        for (const [id, c] of this.cards) {
            const n = counts.get(id) || 0;
            c.count.textContent = n ? `${n} en train de jouer` : 'Table libre';
            c.count.classList.toggle('on', n > 0);
            c.card.classList.toggle('hot', n > 0);
        }
    }

    /** quetes du jour (meme etat que la page Empire) */
    setTycoon(st) {
        const qs = st?.quests || [];
        this.quests.hidden = !qs.length;
        if (!qs.length) return;
        const done = qs.filter((q) => q.done).length;
        this.quests.replaceChildren(
            el('div.lb-q-head', {}, el('b', { text: 'Quêtes du jour' }), el('span', { text: done === qs.length ? 'Tout est fait, coffre rare gagné' : `${done}/${qs.length} · coffre rare au bout` })),
            el('div.lb-q-list', {}, ...qs.map((q) => el(`div.lb-q${q.done ? '.done' : ''}`, {},
                el('span.lb-q-label', { text: q.label }),
                el('span.lb-q-bar', {}, el('i', { style: { transform: `scaleX(${Math.min(1, q.progress / Math.max(1, q.target))})` } })),
                el('span.lb-q-val', { text: q.done ? 'Fait' : `${fmt(q.progress)}/${fmt(q.target)} · +${fmt(q.reward)} RB` })))),
        );
    }
}
