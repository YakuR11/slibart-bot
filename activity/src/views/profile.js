// Fiche profil (comme =profile) : s'ouvre en cliquant sur la pp de n'importe qui.
import { el, fmt } from '../ui.js';
import { avatarEl } from '../avatar.js';

const GAMES = { plinko: 'Plinko', crash: 'Crash', roulette: 'Roulette', slots: 'Slots', blackjack: 'Blackjack', mines: 'Mines', loto: 'Loto', duel: 'Duel' };

export async function openProfile(app, id) {
    const modal = document.getElementById('modal');
    const close = () => { modal.hidden = true; modal.replaceChildren(); };
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.replaceChildren(el('div.pf-card.loading', {}, el('p', { text: 'Chargement…' })));
    modal.hidden = false;
    const p = await app.req('profile', { id });
    if (p.error) {
        close();
        return app.toast(p.error, true);
    }
    const s = p.stats;
    const stat = (icon, label, value) => el('div.pf-stat', {}, el('span', { text: icon }), el('small', { text: label }), el('b', { text: value }));
    const net = s.won - s.lost;
    const card = el('div.pf-card', {},
        el('button.pf-close', { type: 'button', text: '✕', onclick: close, 'aria-label': 'Fermer' }),
        el('div.pf-banner', { style: { backgroundImage: `url("${p.image}")` } }),
        el('div.pf-top', {},
            avatarEl(p, 96),
            el('div.pf-id', {},
                el('h3', { text: p.title || p.name }),
                p.title ? el('small', { text: p.name }) : null,
                el('div.pf-lvl', {}, el('b', { text: `Niveau ${p.level}` }), el('div.pf-bar', {}, el('i', { style: { width: `${(p.xp / Math.max(1, p.xpNeed)) * 100}%` } })), el('small', { text: `${fmt(p.xp)} / ${fmt(p.xpNeed)} XP` })))),
        el('p.pf-bio', { text: p.bio || 'Aucune bio. (=set bio …)' }),
        el('div.pf-money', {}, el('div', {}, el('small', { text: 'Capital' }), el('b', { text: `${fmt(p.rb)} RB` })), el('div', {}, el('small', { text: 'Rang' }), el('b', { text: `#${p.rank}` })), el('div', {}, el('small', { text: 'Succès' }), el('b', { text: `${p.achievements}/${p.achievementsTotal}` }))),
        p.badges.length ? el('div.pf-badges', {}, ...p.badges.map((b) => el('span', { text: b }))) : null,
        el('div.pf-stats', {},
            stat('🎰', 'Parties', fmt(s.games)),
            stat(net >= 0 ? '📈' : '📉', 'Bilan casino', `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}`),
            stat('💥', 'Plus gros gain', fmt(s.maxwin)),
            stat('🏠', 'Caves', fmt(s.caves)),
            stat('⛓️', 'Esclaves', fmt(s.slaves)),
            stat('🛡️', 'Champions', fmt(s.champions)),
            stat('⛏️', 'Miné', fmt(s.mined)),
            stat('⚔️', 'Duels gagnés', fmt(s.duels)),
            stat('🔥', 'Streak daily', `${s.streak} j`),
            stat('🎎', 'Rolls', fmt(s.rolls)),
            stat('🤬', 'Insultes', fmt(s.insults)),
            stat('🏦', 'Dette', s.debt ? fmt(s.debt) : 'aucune')),
        el('div.pf-foot', {},
            p.street ? el('span', { text: `🏡 ${p.street}` }) : null,
            p.bestApp && p.bestApp.net > 0 ? el('span', { text: `🏆 Record app : +${fmt(p.bestApp.net)} au ${GAMES[p.bestApp.game] || p.bestApp.game}` }) : null),
    );
    modal.replaceChildren(card);
}
