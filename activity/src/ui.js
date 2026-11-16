// Petites briques d'interface partagees par les jeux.
export const $ = (id) => document.getElementById(id);
export const fmt = (n) => Math.trunc(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ');
export const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

/** el('div.card.big', { onclick }, enfants...) */
export function el(spec, props = {}, ...kids) {
    const [tag, ...cls] = spec.split('.');
    const node = document.createElement(tag || 'div');
    if (cls.length) node.className = cls.join(' ');
    for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style') for (const [prop, val] of Object.entries(v)) (prop.startsWith('--') ? node.style.setProperty(prop, val) : (node.style[prop] = val));
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
    return node;
}

export function parseBet(raw) {
    const s = String(raw).trim().toLowerCase().replace(/\s/g, '').replace(',', '.');
    const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
    if (!m) return NaN;
    return Math.floor(parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1));
}

/**
 * Bloc "Mise" : un champ (la seule chose qu'on tape) + boutons ½ ×2 +100 +1k Max.
 * getMax() = solde dispo. Renvoie { node, get(), set(n) }.
 */
export function betBox(getMax, min = 10, initial = 100, label = 'Mise') {
    const input = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', value: String(initial) });
    const set = (n) => { input.value = String(Math.max(min, Math.floor(n) || min)); input.dispatchEvent(new Event('input')); };
    const get = () => parseBet(input.value);
    const chip = (text, fn) => el('button.chip', { type: 'button', onclick: () => set(fn(get() || min)) , text });
    const node = el('div.field', {},
        el('span.field-label', { text: label }),
        el('div.bet-row', {}, input,
            chip('½', (v) => v / 2),
            chip('×2', (v) => v * 2),
            chip('Max', () => getMax())),
        el('div.bet-row.quick', {},
            chip('+100', (v) => v + 100),
            chip('+1k', (v) => v + 1000),
            chip('+10k', (v) => v + 10000),
            chip('↺', () => min)),
    );
    return { node, input, get, set };
}

/** carte avec titre de jeu a gauche (zone d'animation) + console a droite */
export function gameShell(view, title) {
    const stage = el('section.board-wrap.game-stage', { 'aria-label': title });
    const consoleEl = el('aside.console');
    view.replaceChildren(el('div.stage', {}, stage), consoleEl);
    return { stage, console: consoleEl };
}

export function bigButton(text, onclick, cls = '') {
    return el(`button.drop${cls ? `.${cls}` : ''}`, { type: 'button', onclick, text });
}

/** bandeau des derniers resultats d'un jeu (pastilles vertes / grises) */
export function historyStrip(max = 14) {
    const node = el('div.gh');
    return {
        node,
        add(text, won) {
            node.prepend(el(`span.${won ? 'w' : 'l'}`, { text }));
            while (node.children.length > max) node.lastChild.remove();
        },
    };
}

/**
 * Bloc "En rafale" : 10 / 25 / 50 / ∞ parties d'affilee, bouton Stop.
 * play(fast) joue une partie et renvoie false s'il faut arreter (solde, erreur).
 */
export function autoBox(play, label = 'En rafale') {
    let left = 0;
    const stopBtn = el('button.chip.stop', { type: 'button', hidden: true, onclick: () => stop() });
    const chips = [10, 25, 50, Infinity].map((n) => el('button.chip', { type: 'button', text: n === Infinity ? '∞' : String(n), 'aria-label': n === Infinity ? 'Sans limite' : `${n} parties`, onclick: () => start(n) }));
    const node = el('div.auto', {}, el('span.field-label', { text: label }), el('div.auto-row', {}, ...chips, stopBtn));
    const paint = () => {
        stopBtn.hidden = left <= 0;
        stopBtn.textContent = left === Infinity ? 'Stop' : `Stop (${left})`;
        for (const c of chips) c.disabled = left > 0;
    };
    function stop() { left = 0; paint(); }
    async function start(n) {
        if (left > 0) return;
        left = n;
        paint();
        while (left > 0) {
            const ok = await play(true);
            if (ok === false) break;
            left--;
            paint();
            await new Promise((r) => setTimeout(r, 140));
        }
        stop();
    }
    return { node, stop, get running() { return left > 0; } };
}

/** verifie la mise avant d'appeler le serveur ; renvoie la mise ou null (message deja affiche) */
export function checkBet(app, box) {
    const bet = box.get();
    if (!(bet >= app.minBet)) { app.toast(`Mise minimum : ${app.minBet}`, true); app.sound.error(); return null; }
    if (bet > app.balance()) { app.toast('Pas assez de Rokbux.', true); app.sound.error(); return null; }
    return bet;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
