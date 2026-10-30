// Page Empire (modele "dashboard") : le cote tycoon du bot.
// Ce que tu gagnes par =work, ce que tu peux acheter (les boutons brillent quand c'est abordable),
// ce qui est pret dans le chat, tes quetes, le classement et le prestige.
// Le work reste dans le chat (=w =gw =m) : ici on montre, on achete, on ne clique pas pour farmer.
import { el, fmt } from '../ui.js';
import { avatarEl } from '../avatar.js';
import { icon } from '../icons.js';

const html = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };
const clock = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const pct = (a, b) => Math.max(0, Math.min(100, b > 0 ? (a / b) * 100 : 100));

/** prochain objectif d'achat : ce qui fait vraiment avancer (esclave, sinon cave, sinon prestige) */
export function goalOf(st) {
    if (!st) return null;
    if (st.prestige.ready) return { key: 'prestige', label: `Prestige ${st.prestige.level + 1}`, price: st.prestige.need.rb };
    if (st.items.slave.room > 0) return { key: 'slave', label: `Esclave n°${st.slaves + 1}`, price: st.items.slave.price };
    return { key: 'cave', label: `Cave n°${st.caves + 1}`, price: st.items.cave.price };
}

export class EmpireView {
    constructor(page, app) {
        this.app = app;
        this.page = page;
        this.st = null;
        this.topData = null;
        this.confirm = null;
        page.classList.add('em');

        this.kpis = el('section.em-kpis', { 'aria-label': 'Résumé' });
        this.upgrades = el('div.em-cards');
        this.prestigeBox = el('div.em-prestige');
        this.tasks = el('ul.em-tasks');
        this.quests = el('ul.em-quests');
        this.board = el('ol.em-top');

        const box = (title, sub, ...kids) => el('section.em-box', {}, el('header', {}, el('h3', { text: title }), sub ? el('span', { text: sub }) : null), ...kids);
        this.questSub = el('span');
        page.append(
            el('header.pg-head', {}, el('div', {},
                el('h2', { text: 'Ton empire' }),
                el('p', { text: 'Achète des esclaves et des caves : ton salaire =work monte. Le work se fait dans le chat.' }))),
            this.kpis,
            el('div.em-body', {},
                el('div.em-col', {},
                    box('Améliorations', 'brillent quand tu peux payer', this.upgrades),
                    box('Prestige', 'repars de zéro, gagne plus pour toujours', this.prestigeBox)),
                el('div.em-col', {},
                    box('À faire dans le chat', null, this.tasks),
                    el('section.em-box', {}, el('header', {}, el('h3', { text: 'Quêtes du jour' }), this.questSub), this.quests),
                    box('Classement', 'les plus riches', this.board))),
        );
    }

    // -----------------------------------------------------------------------
    async show(on) {
        this.visible = on;
        clearInterval(this.timer);
        if (!on) return;
        await Promise.all([this.refresh(), this.refreshTop()]);
        this.app.markSeen?.(this.st);
        this.timer = setInterval(() => { if (this.visible) this.renderTimes(); }, 1000);
    }

    /** tries : au lancement la connexion temps reel n'est pas encore ouverte, on reessaie un peu */
    async refresh(tries = 1) {
        for (let k = 0; k < tries; k++) {
            const st = await this.app.req('tycoon.state');
            if (!st.error) { this.set(st); return st; }
            await new Promise((r) => setTimeout(r, 800));
        }
        return null;
    }

    set(st) {
        this.st = st;
        this.app.onTycoon?.(st);
        if (this.visible) this.render();
    }

    async refreshTop(tries = 1) {
        let t = await this.app.req('tycoon.top');
        for (let k = 1; k < tries && t.error; k++) {
            await new Promise((r) => setTimeout(r, 800));
            t = await this.app.req('tycoon.top');
        }
        if (t.error) return null;
        this.topData = t;
        if (this.visible) this.renderTop();
        return t;
    }

    // -----------------------------------------------------------------------
    render() {
        const st = this.st;
        if (!st) return;
        const pm = st.prestige.mult;
        const kpi = (ic, label, value, sub) => el('div.em-kpi', {}, html(icon(ic, 18)), el('span.em-kpi-l', { text: label }), el('b.em-kpi-v', { text: value }), sub ? el('small', { text: sub }) : null);
        this.kpis.replaceChildren(
            kpi('briefcase', 'Salaire =work', `${fmt(st.income.work)} RB`, `toutes les 30 min${st.foreman ? ' · contremaître' : ''}${st.happy ? ' · happy hour x2' : ''}`),
            kpi('users', 'Esclaves', `${st.slaves} / ${st.caves * st.items.cave.places}`, `+${fmt(st.income.perSlave)} RB par =work chacun`),
            kpi('home', 'Entretien', st.income.upkeep ? `−${fmt(st.income.upkeep)} RB` : '0 RB', st.income.tax ? `par jour · caves ${fmt(st.income.caveFee)} + taxe ${fmt(st.income.tax)}` : 'par jour (caves)'),
            kpi('star', 'Prestige', st.prestige.level ? `${st.prestige.level} · x${pm.toFixed(1)}` : 'aucun', st.prestige.level ? 'sur work, gw, mine, daily' : `x${st.prestige.nextMult.toFixed(1)} au premier`),
        );
        this.renderUpgrades();
        this.renderPrestige();
        this.renderTasks();
        this.renderQuests();
        this.renderTop();
    }

    card({ key, ic, title, text, price, can, why, buttons, done }) {
        const bal = this.app.balance();
        return el(`article.em-card${can ? '.can' : ''}${done ? '.done' : ''}`, { dataset: { key } },
            el('div.em-ic', {}, html(icon(ic, 22))),
            el('div.em-main', {}, el('h4', { text: title }), el('p', { text: text })),
            el('div.em-buy', {}, ...buttons),
            done ? null : el('div.em-info', {},
                el('div.em-line', {}, el('span', { text: price != null ? `${fmt(price)} RB` : '' }), el('span', { text: why || (can ? 'Achetable' : `encore ${fmt(Math.max(0, price - bal))} RB`) })),
                el('div.em-bar', {}, el('i', { style: { transform: `scaleX(${pct(bal, price) / 100})` } }))));
    }

    btn(text, onclick, { primary = true, disabled = false, label } = {}) {
        return el(`button.em-btn${primary ? '' : '.ghost'}`, { type: 'button', text, disabled, onclick, 'aria-label': label || text });
    }

    renderUpgrades() {
        const st = this.st;
        const bal = this.app.balance();
        const it = st.items;
        const caveCd = it.cave.cdUntil > Date.now();
        const slaveCan = it.slave.room > 0 && bal >= it.slave.price;
        const cards = [
            this.card({
                key: 'slave', ic: 'users', title: 'Esclave',
                text: it.slave.room > 0 ? `+${fmt(st.income.perSlave)} RB à chaque =work · ${it.slave.room} place${it.slave.room > 1 ? 's' : ''} libre${it.slave.room > 1 ? 's' : ''}` : 'Plus de place : achète une cave',
                price: it.slave.price, can: slaveCan,
                why: it.slave.room <= 0 ? 'il faut une cave' : null,
                buttons: [
                    this.btn('Acheter', () => this.buy('slave', 1), { disabled: !slaveCan, label: 'Acheter 1 esclave' }),
                    this.btn('×5', () => this.buy('slave', 5), { primary: false, disabled: it.slave.room < 5 || bal < it.slave.price5, label: `Acheter 5 esclaves pour ${fmt(it.slave.price5)} RB` }),
                    this.btn('Max', () => this.buy('slave', 'max'), { primary: false, disabled: !slaveCan, label: 'Acheter le maximum d\'esclaves' }),
                ],
            }),
            this.card({
                key: 'cave', ic: 'home', title: 'Cave',
                text: `+${it.cave.places} places d'esclaves · entretien qui monte avec le nombre de caves`,
                price: it.cave.price, can: !caveCd && bal >= it.cave.price,
                why: caveCd ? `dispo à ${clock(it.cave.cdUntil)}` : null,
                buttons: [this.btn('Acheter', () => this.buy('cave'), { disabled: caveCd || bal < it.cave.price, label: 'Acheter une cave' })],
            }),
            it.foreman.owned
                ? this.card({ key: 'foreman', ic: 'timer', title: 'Contremaître', text: `En poste : il ramasse ton =work tout seul (${fmt(st.income.work)} RB / 30 min)`, done: true, buttons: [el('span.em-owned', {}, html(icon('check', 16)), el('span', { text: 'Acheté' }))] })
                : this.card({
                    key: 'foreman', ic: 'timer', title: 'Contremaître',
                    text: `Ramasse ton =work tout seul, même si t'es pas là · ${fmt(it.foreman.before)} → ${fmt(it.foreman.after)} RB / 30 min`,
                    price: it.foreman.price, can: bal >= it.foreman.price,
                    buttons: [this.btn(this.confirm === 'foreman' ? 'Confirmer ?' : 'Acheter', () => this.buyConfirm('foreman'), { disabled: bal < it.foreman.price, label: 'Acheter le contremaître' })],
                }),
            this.card({
                key: 'cadenas', ic: 'lock', title: 'Cadenas',
                text: `Bloque une tentative de =rob contre toi · tu en as ${it.cadenas.have}/${it.cadenas.max}`,
                price: it.cadenas.price, can: false,
                why: it.cadenas.have >= it.cadenas.max ? 'maximum atteint' : bal >= it.cadenas.price ? 'achetable' : null,
                buttons: [this.btn('Acheter', () => this.buy('cadenas', 1), { primary: false, disabled: it.cadenas.have >= it.cadenas.max || bal < it.cadenas.price, label: 'Acheter un cadenas' })],
            }),
        ];
        this.upgrades.replaceChildren(...cards);
    }

    renderPrestige() {
        const ps = this.st.prestige;
        if (ps.maxed) {
            this.prestigeBox.replaceChildren(el('p.em-note', { text: `Prestige ${ps.level} : le maximum. Tes revenus sont x${ps.mult.toFixed(1)} pour toujours.` }));
            return;
        }
        const bal = this.app.balance();
        const row = (label, have, need) => el('div.em-req', {},
            el('div.em-line', {}, el('span', { text: label }), el('span', { text: `${fmt(have)} / ${fmt(need)}` })),
            el('div.em-bar', {}, el('i', { style: { transform: `scaleX(${pct(have, need) / 100})` } })));
        const confirming = this.confirm === 'prestige';
        this.prestigeBox.replaceChildren(...[
            el('p.em-note', { text: `Tu perds tes RB, esclaves et caves. Tu gardes le contremaître, ton niveau, tes objets et tes cadres. Work, gw, mine et daily passent à x${ps.nextMult.toFixed(1)} pour toujours.` }),
            row('RB en poche', bal, ps.need.rb),
            row('Esclaves', this.st.slaves, ps.need.slaves),
            ps.debt > 0 ? el('p.em-warn', { text: 'Rembourse ton crédit avant (=rembourser).' }) : null,
            el('div.em-buy', {},
                this.btn(confirming ? `Oui, je brûle ${fmt(bal)} RB` : `Passer prestige ${ps.level + 1}`, () => this.rebirth(), { disabled: !ps.ready, label: `Passer prestige ${ps.level + 1}` }),
                confirming ? this.btn('Annuler', () => { this.confirm = null; this.renderPrestige(); }, { primary: false }) : null),
        ].filter(Boolean));
        this.prestigeBox.classList.toggle('can', ps.ready);
    }

    renderTasks() {
        const st = this.st;
        const t = st.tasks;
        const P = st.prefix;
        const row = (cmd, label, ready, next, extra) => el(`li${ready ? '.ready' : ''}`, {},
            el('code', { text: `${P}${cmd}` }),
            el('span', { text: label }),
            el('b', { dataset: { next: ready ? '' : String(next || '') }, text: ready ? 'prêt' : next ? `à ${clock(next)}` : '…' }),
            extra ? el('small', { text: extra }) : null);
        this.tasks.replaceChildren(
            t.work.auto
                ? el('li.ready', {}, el('code', { text: `${P}w` }), el('span', { text: 'Salaire' }), el('b', { text: 'contremaître' }), el('small', { text: 'ramassé automatiquement' }))
                : row('w', `Salaire · ${fmt(t.work.left || st.income.work)} RB`, t.work.ready, t.work.next),
            row('gw', `Gamblework · ~${fmt(st.income.gw)} RB`, t.gw.ready, t.gw.next),
            row('m', `Mine · ~${String(st.income.mine).replace('.', ',')} RB`, t.mine.ready, t.mine.next),
            row('d', `Daily · streak ${t.daily.streak}`, t.daily.ready, t.daily.next),
        );
    }

    renderTimes() {
        // les "à 14:32" deviennent "prêt" sans recharger
        let changed = false;
        for (const b of this.tasks.querySelectorAll('b[data-next]')) {
            const n = Number(b.dataset.next);
            if (n && n <= Date.now()) changed = true;
        }
        if (changed) this.refresh();
    }

    renderQuests() {
        const qs = this.st.quests;
        const done = qs.filter((q) => q.done).length;
        this.questSub.textContent = this.st.questBonus.done ? 'bonus récupéré' : `${done}/${qs.length} · bonus ${fmt(this.st.questBonus.reward)} RB à 3/3`;
        if (!qs.length) {
            this.quests.replaceChildren(el('li.em-empty', { text: 'Pas de quête aujourd\'hui.' }));
            return;
        }
        this.quests.replaceChildren(...qs.map((q) => el(`li${q.done ? '.done' : ''}`, {},
            el('div.em-line', {}, el('span', { text: q.label }), el('b', { text: q.done ? 'payée' : `+${fmt(q.reward)} RB` })),
            el('div.em-bar', {}, el('i', { style: { transform: `scaleX(${pct(q.progress, q.target) / 100})` } })),
            el('small', { text: `${fmt(q.progress)} / ${fmt(q.target)}` }))));
    }

    renderTop() {
        const t = this.topData;
        if (!t) return;
        const meId = this.app.me()?.id;
        const rows = t.top.map((p, i) => el(`li${p.id === meId ? '.me' : ''}`, {},
            el('span.em-rank', { text: String(i + 1) }),
            avatarEl(p, 28, { onClick: (id) => this.app.openProfile(id) }),
            el('span.em-name', { text: p.name }),
            p.prestige ? el('span.em-star', { text: `★${p.prestige}`, title: `Prestige ${p.prestige}` }) : null,
            el('b', { text: fmt(p.rb) })));
        if (!t.top.some((p) => p.id === meId)) {
            rows.push(el('li.me.sep', {}, el('span.em-rank', { text: String(t.me.rank) }), el('span.em-name', { text: 'Toi' }), el('b', { text: fmt(t.me.rb) })));
        }
        if (t.above && t.above.id !== meId) {
            rows.push(el('li.em-next', {}, el('span', { text: `${fmt(t.above.rb - t.me.rb + 1)} RB pour passer ${t.above.name}` })));
        }
        this.board.replaceChildren(...rows);
    }

    // -----------------------------------------------------------------------
    buyConfirm(item) {
        if (this.confirm !== item) {
            this.confirm = item;
            this.renderUpgrades();
            setTimeout(() => { if (this.confirm === item) { this.confirm = null; if (this.visible) this.renderUpgrades(); } }, 4000);
            return;
        }
        this.confirm = null;
        this.buy(item);
    }

    async buy(item, qty) {
        const r = await this.app.req('tycoon.buy', { item, qty });
        if (r.error) return this.app.toast(r.error, true);
        if (r.err) return this.app.toast(BUY_ERR[r.err]?.(r) || 'Achat impossible.', true);
        this.app.setBalance(r.balance);
        this.app.sound.purchase?.();
        const card = this.upgrades.querySelector(`[data-key="${item}"]`);
        const box = card?.getBoundingClientRect();
        if (box) this.app.fx.coins(box.left + box.width / 2, box.top + 20, 16);
        this.app.toast(BUY_OK[item](r));
        this.set(r.state);
        this.app.markSeen?.(r.state);
    }

    async rebirth() {
        if (!this.st?.prestige.ready) return;
        if (this.confirm !== 'prestige') {
            this.confirm = 'prestige';
            this.renderPrestige();
            return;
        }
        this.confirm = null;
        const r = await this.app.req('tycoon.rebirth');
        if (r.error) return this.app.toast(r.error, true);
        if (r.err) return this.app.toast(r.err === 'debt' ? 'Rembourse ton crédit avant.' : 'Pas encore les conditions.', true);
        this.app.setBalance(r.balance);
        this.app.fx.confetti(140, ['#b48cff', '#ffd24a', '#ffffff']);
        this.app.fx.glow('#b48cff', 1, 3000);
        this.app.sound.bigWin?.(3, 2);
        this.app.toast(`Prestige ${r.level} ! Tes revenus sont x${r.mult.toFixed(1)} pour toujours.`);
        this.set(r.state);
    }
}

const BUY_OK = {
    slave: (r) => `+${r.qty} esclave${r.qty > 1 ? 's' : ''} pour ${fmt(r.cost)} RB. Total : ${r.total}.`,
    cave: (r) => `Cave n°${r.total} achetée pour ${fmt(r.price)} RB.`,
    foreman: () => 'Contremaître en poste : il ramasse ton =work tout seul.',
    cadenas: (r) => `Cadenas acheté. Tu en as ${r.have}.`,
};
const BUY_ERR = {
    room: () => 'Plus de place : achète une cave.',
    roomfor: (r) => `Place pour ${r.room} esclave(s) seulement.`,
    broke: (r) => `Il te faut ${fmt(r.need)} RB.`,
    cd: (r) => `Prochaine cave à ${clock(r.until)}.`,
    owned: () => 'Déjà en poste.',
    max: () => 'Maximum atteint.',
    bulk: () => '50 max par achat.',
};
