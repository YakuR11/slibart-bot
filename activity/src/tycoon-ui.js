// Petits morceaux "tycoon" autour de l'app : barre d'objectif dans l'en-tete, "!" sur l'onglet Empire,
// pieces qui volent jusqu'au solde, "X vient de te passer devant", retour d'absence, tuto du premier lancement.
import { el, fmt } from './ui.js';
import { goalOf } from './views/empire.js';
import { reduceMotion } from './fx.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// barre d'objectif + "!" quand un achat devient abordable
// ---------------------------------------------------------------------------
export class Goal {
    constructor(app, goPage) {
        this.app = app;
        this.st = null;
        this.btn = $('goal');
        this.btn.addEventListener('click', () => goPage('empire'));
        try { this.seen = new Set(JSON.parse(localStorage.getItem('empire-seen') || '[]')); } catch { this.seen = new Set(); }
    }

    set(st) {
        this.st = st;
        this.paint(this.app.balance());
    }

    /** cle de ce qui est abordable maintenant (ex. "slave:12") : le "!" s'allume quand une nouvelle cle apparait */
    affordable(bal) {
        const st = this.st;
        if (!st) return [];
        const out = [];
        if (st.items.slave.room > 0 && bal >= st.items.slave.price) out.push(`slave:${st.slaves + 1}`);
        if (!(st.items.cave.cdUntil > Date.now()) && bal >= st.items.cave.price) out.push(`cave:${st.caves + 1}`);
        if (!st.items.foreman.owned && bal >= st.items.foreman.price) out.push('foreman');
        if (st.prestige.ready) out.push(`prestige:${st.prestige.level + 1}`);
        return out;
    }

    markSeen(st) {
        if (st) this.st = st;
        for (const k of this.affordable(this.app.balance())) this.seen.add(k);
        try { localStorage.setItem('empire-seen', JSON.stringify([...this.seen].slice(-60))); } catch { /* rien */ }
        $('empire-bang').hidden = true;
    }

    paint(bal) {
        const g = goalOf(this.st);
        if (!g) return;
        this.btn.hidden = false;
        const ok = bal >= g.price;
        $('goal-t').textContent = ok ? `${g.label} : achetable !` : `${g.label} · ${fmt(bal)} / ${fmt(g.price)}`;
        $('goal-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, bal / Math.max(1, g.price)))})`;
        this.btn.classList.toggle('ready', ok);
        this.btn.setAttribute('aria-label', `Prochain objectif : ${$('goal-t').textContent}. Ouvrir l'Empire.`);
        const fresh = this.affordable(bal).some((k) => !this.seen.has(k));
        if (this.app.page() !== 'empire') $('empire-bang').hidden = !fresh;
    }
}

// ---------------------------------------------------------------------------
// pieces qui volent du dernier clic jusqu'au solde
// ---------------------------------------------------------------------------
let tap = { x: innerWidth / 2, y: innerHeight / 2, at: 0 };
addEventListener('pointerdown', (e) => { tap = { x: e.clientX, y: e.clientY, at: Date.now() }; }, true);

export function flyCoins(amount) {
    if (reduceMotion || amount <= 0) return;
    const target = $('balance').getBoundingClientRect();
    const from = Date.now() - tap.at < 6000 ? tap : { x: innerWidth / 2, y: innerHeight / 2 };
    const n = Math.min(14, 3 + Math.round(Math.log10(amount + 1) * 3));
    for (let i = 0; i < n; i++) {
        const c = document.createElement('i');
        c.className = 'fly-coin';
        const sx = from.x + (Math.random() - 0.5) * 60;
        const sy = from.y + (Math.random() - 0.5) * 40;
        c.style.transform = `translate(${sx}px, ${sy}px) scale(0.6)`;
        document.body.append(c);
        const delay = i * 45;
        setTimeout(() => {
            c.style.transition = `transform 650ms cubic-bezier(.5,-0.3,.6,1), opacity 650ms ease-in`;
            c.style.transform = `translate(${target.left + target.width / 2 - 8}px, ${target.top + target.height / 2 - 8}px) scale(1)`;
            c.style.opacity = '0.4';
        }, 20 + delay);
        setTimeout(() => {
            c.remove();
            if (i === n - 1) {
                const b = $('balance');
                b.classList.remove('hit');
                void b.offsetWidth;
                b.classList.add('hit');
            }
        }, 700 + delay);
    }
}

// ---------------------------------------------------------------------------
// "X vient de te passer devant"
// ---------------------------------------------------------------------------
export function watchRank(prev, next, app) {
    if (!prev || !next) return;
    if (next.me.rank > prev.me.rank && next.above && next.above.id !== prev.above?.id && next.above.id !== app.me()?.id) {
        app.toast(`${next.above.name} vient de te passer devant 😤 (#${next.me.rank})`);
        app.sound.sad?.();
    } else if (next.me.rank < prev.me.rank) {
        app.toast(`Tu passes #${next.me.rank} du classement !`);
    }
}

// ---------------------------------------------------------------------------
// retour d'absence : ce qui s'est passe, et ce qui t'attend dans le chat
// ---------------------------------------------------------------------------
export async function awayReport(app, st) {
    const a = await app.req('tycoon.away');
    if (a.error || !a.since) return;
    const gone = Date.now() - a.since;
    if (gone < 30 * 60 * 1000) return;
    const h = gone / 3600000;
    const span = h >= 48 ? `${Math.round(h / 24)} jours` : h >= 1 ? `${Math.round(h)} h` : `${Math.round(gone / 60000)} min`;
    const P = st?.prefix || '=';
    const lines = [];
    if (a.foreman) lines.push(['+', `${fmt(a.foreman)} RB ramassés par ton contremaître`, 'pos']);
    if (a.upkeep) lines.push(['−', `${fmt(a.upkeep)} RB d'entretien (caves et taxe)`, 'neg']);
    const ready = [];
    if (st && !st.tasks.work.auto && st.tasks.work.ready) ready.push(`${P}w`);
    if (st?.tasks.gw.ready) ready.push(`${P}gw`);
    if (st?.tasks.daily.ready) ready.push(`${P}d`);
    if (!lines.length && !ready.length) return;
    const modal = $('modal');
    const close = () => { modal.hidden = true; modal.replaceChildren(); };
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.replaceChildren(el('div.away-card', { role: 'dialog', 'aria-labelledby': 'away-h' },
        el('h3', { id: 'away-h', text: `Pendant ton absence (${span})` }),
        lines.length ? el('ul.away-list', {}, ...lines.map(([s, t, c]) => el(`li.${c}`, {}, el('b', { text: s }), el('span', { text: t })))) : null,
        ready.length ? el('p.away-ready', {}, 'Prêt dans le chat : ', ...ready.flatMap((r, i) => [i ? ' ' : '', el('code', { text: r })])) : null,
        el('button.em-btn', { type: 'button', text: 'Retourner au jeu', onclick: close })));
    modal.hidden = false;
    modal.querySelector('button')?.focus();
}

// ---------------------------------------------------------------------------
// tuto du premier lancement : 4 bulles, passable a tout moment
// ---------------------------------------------------------------------------
const STEPS = [
    { sel: '#games', title: 'Choisis un jeu', text: 'Tu tapes juste ta mise, le reste c\'est des boutons.' },
    { sel: '#live-feed, .feed-col', title: 'Les paris en direct', text: 'Tout le monde voit les paris de tout le monde. Les gros tapis illuminent l\'écran.' },
    { sel: '#tabs [data-page="empire"]', title: 'Ton empire', text: 'Achète des esclaves et des caves : ton salaire =w monte. Un « ! » s\'allume quand tu peux acheter.' },
    { sel: '#goal', title: 'Ton prochain objectif', text: 'Clique dessus pour aller l\'acheter.' },
];

export function tutorial(force = false) {
    try { if (!force && localStorage.getItem('tuto-v1')) return; } catch { /* rien */ }
    const box = $('tuto');
    let i = 0;
    const done = () => {
        box.hidden = true;
        box.replaceChildren();
        document.querySelector('.tuto-on')?.classList.remove('tuto-on');
        try { localStorage.setItem('tuto-v1', '1'); } catch { /* rien */ }
    };
    const show = () => {
        document.querySelector('.tuto-on')?.classList.remove('tuto-on');
        const step = STEPS[i];
        const target = [...document.querySelectorAll(step.sel)].find((n) => n.offsetParent !== null);
        if (!target) { i++; return i < STEPS.length ? show() : done(); }
        target.classList.add('tuto-on');
        target.scrollIntoView({ block: 'nearest' });
        const r = target.getBoundingClientRect();
        const below = r.bottom + 180 < innerHeight;
        const left = Math.max(12, Math.min(innerWidth - 312, r.left));
        const last = i === STEPS.length - 1;
        box.replaceChildren(el('div.tuto-bubble', {
            role: 'dialog', 'aria-live': 'polite',
            style: { left: `${left}px`, top: below ? `${r.bottom + 12}px` : 'auto', bottom: below ? 'auto' : `${innerHeight - r.top + 12}px` },
        },
        el('small', { text: `${i + 1} / ${STEPS.length}` }),
        el('b', { text: step.title }),
        el('p', { text: step.text }),
        el('div.tuto-actions', {},
            el('button.em-btn.ghost', { type: 'button', text: 'Passer le tuto', onclick: done }),
            el('button.em-btn', { type: 'button', text: last ? 'C\'est parti' : 'Suivant', onclick: () => { i++; if (i < STEPS.length) show(); else done(); } }))));
        box.hidden = false;
        box.querySelector('.tuto-actions .em-btn:not(.ghost)')?.focus();
    };
    show();
}
