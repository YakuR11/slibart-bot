import { DiscordSDK } from '@discord/embedded-app-sdk';
import { Board, bucketColor, multLabel } from './board.js';
import { sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.trunc(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ');

const state = {
    cfg: null,
    session: null,
    me: null,
    room: 'lobby',
    risk: 'medium',
    rows: 12,
    server: 0, // solde confirme par le serveur
    pending: 0, // gains des billes encore en l'air
    inflight: 0, // mises envoyees, reponse pas encore recue
    auto: 0,
    autoTimer: null,
};

const board = new Board($('board'), $('pops'));

// ---------------------------------------------------------------------------
// affichage
// ---------------------------------------------------------------------------
function shown() { return state.server - state.pending - state.inflight; }

function renderBalance(bump = false) {
    $('balance').textContent = fmt(shown());
    if (bump) {
        $('balance').classList.add('bump');
        setTimeout(() => $('balance').classList.remove('bump'), 160);
    }
}

function renderLevel() {
    if (state.me) $('level').textContent = `niv. ${state.me.level}`;
}

function toast(text, err = false) {
    const el = document.createElement('div');
    el.className = `toast${err ? ' err' : ''}`;
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 4600);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
}

function gate(msg) {
    $('gate-msg').textContent = msg;
    $('gate').hidden = !msg;
}

function playerColor(id) {
    let h = 0;
    for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h}, 75%, 62%)`;
}

function addHistory(mult, rows) {
    const el = document.createElement('span');
    el.textContent = multLabel(mult);
    const k = state.cfg.tables[rows][state.risk].indexOf(mult);
    el.style.background = bucketColor(k < 0 ? rows / 2 : k, rows);
    $('history').prepend(el);
    while ($('history').children.length > 14) $('history').lastChild.remove();
}

function addFeed(player, mult, net) {
    const feed = $('feed');
    feed.querySelector('.empty')?.remove();
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = player.avatar;
    img.alt = '';
    const name = document.createElement('b');
    name.textContent = player.name;
    const res = document.createElement('span');
    res.className = net > 0 ? 'w' : 'l';
    res.textContent = net > 0 ? `${multLabel(mult)} · +${fmt(net)}` : multLabel(mult);
    li.append(img, name, res);
    feed.prepend(li);
    while (feed.children.length > 8) feed.lastChild.remove();
}

function renderPlayers(list) {
    const ul = $('players');
    ul.replaceChildren(...list.slice(0, 8).map((p) => {
        const li = document.createElement('li');
        li.style.backgroundImage = `url("${p.avatar}")`;
        li.title = p.name;
        return li;
    }));
}

// ---------------------------------------------------------------------------
// controles
// ---------------------------------------------------------------------------
function parseBet(raw) {
    const s = String(raw).trim().toLowerCase().replace(/\s/g, '').replace(',', '.');
    const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
    if (!m) return NaN;
    return Math.floor(parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1));
}

function setBet(n) {
    const v = Math.max(state.cfg.minBet, Math.min(state.cfg.maxBet, Math.floor(n) || state.cfg.minBet));
    $('bet').value = String(v);
}

function seg(id, key, onChange) {
    const el = $(id);
    el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        for (const x of el.children) x.setAttribute('aria-checked', String(x === b));
        state[key] = key === 'rows' ? Number(b.dataset.v) : b.dataset.v;
        onChange?.();
    });
}

function applyLayout() {
    board.setLayout(state.rows, state.cfg.tables[state.rows][state.risk]);
}

// ---------------------------------------------------------------------------
// jouer
// ---------------------------------------------------------------------------
async function api(path, body) {
    const res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(state.session ? { Authorization: `Bearer ${state.session}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

async function drop() {
    sound.unlock();
    const bet = parseBet($('bet').value);
    if (!Number.isFinite(bet) || bet < state.cfg.minBet) {
        toast(`Mise minimum : ${fmt(state.cfg.minBet)}`, true);
        stopAuto();
        return;
    }
    if (bet > shown()) {
        toast(`Pas assez de Rokbux pour miser ${fmt(bet)}`, true);
        stopAuto();
        return;
    }
    const rows = state.rows;
    const risk = state.risk;
    state.inflight += bet;
    renderBalance();
    const { ok, status, data } = await api('api/plinko/drop', { bet, risk, rows, room: state.room });
    state.inflight -= bet;
    if (!ok) {
        renderBalance();
        if (status !== 429) {
            toast(data.error || 'Erreur, réessaie', true);
            stopAuto();
        }
        if (status === 401) gate('Session expirée : ferme et relance l\'activité.');
        return;
    }
    state.server = data.balance;
    state.pending += data.payout;
    renderBalance();
    // si on a change de lignes pendant la requete, on ne peut pas animer sur ce plateau
    if (rows !== state.rows) return land(data, rows, null);
    board.addBall({
        path: data.path,
        color: '#ffd76a',
        mine: true,
        onPeg: (r) => sound.peg(r, true),
        onLand: (k, pos) => land(data, rows, pos),
    });
}

function land(data, rows, pos) {
    state.pending -= data.payout;
    renderBalance(true);
    sound.land(data.mult);
    addHistory(data.mult, rows);
    if (pos) {
        const big = data.mult >= 10;
        board.pop(data.net > 0 ? `+${fmt(data.net)}` : multLabel(data.mult), pos.x, big ? 'big' : data.net > 0 ? 'win' : 'loss');
    }
    if (data.mult >= 5 && state.me) addFeed(state.me, data.mult, data.net);
    for (const n of data.notices || []) toast(n);
}

function startAuto(n) {
    stopAuto();
    state.auto = n;
    $('stop').hidden = false;
    $('stop').textContent = `Stop (${n})`;
    const next = async () => {
        if (state.auto <= 0) return stopAuto();
        state.auto--;
        $('stop').textContent = `Stop (${state.auto})`;
        await drop();
        if (state.auto > 0) state.autoTimer = setTimeout(next, 280);
        else stopAuto();
    };
    next();
}

function stopAuto() {
    state.auto = 0;
    clearTimeout(state.autoTimer);
    $('stop').hidden = true;
}

// ---------------------------------------------------------------------------
// salle en direct
// ---------------------------------------------------------------------------
function connectRoom(attempt = 0) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = location.pathname.startsWith('/.proxy') ? '/.proxy' : '';
    const ws = new WebSocket(`${proto}://${location.host}${base}/ws?session=${encodeURIComponent(state.session)}&room=${encodeURIComponent(state.room)}`);
    ws.onopen = () => { attempt = 0; };
    ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'players') renderPlayers(msg.players);
        if (msg.type === 'drop' && msg.player.id !== state.me?.id) {
            if (msg.rows === state.rows) {
                board.addBall({
                    path: msg.path,
                    color: playerColor(msg.player.id),
                    label: msg.player.name.split(' ')[0].slice(0, 12),
                    onPeg: (r) => sound.peg(r, false),
                    onLand: () => { if (msg.mult >= 2) addFeed(msg.player, msg.mult, msg.net); },
                });
            } else if (msg.mult >= 2) addFeed(msg.player, msg.mult, msg.net);
        }
    };
    ws.onclose = (e) => {
        if (e.code === 4001) return;
        setTimeout(() => connectRoom(attempt + 1), Math.min(15000, 1000 * 2 ** attempt));
    };
}

// ---------------------------------------------------------------------------
// connexion
// ---------------------------------------------------------------------------
async function login() {
    const params = new URLSearchParams(location.search);
    if (params.has('frame_id')) {
        const sdk = new DiscordSDK(state.cfg.clientId);
        await sdk.ready();
        const { code } = await sdk.commands.authorize({
            client_id: state.cfg.clientId,
            response_type: 'code',
            state: '',
            prompt: 'none',
            scope: ['identify'],
        });
        const { ok, data } = await api('api/token', { code });
        if (!ok) throw new Error(data.error || 'connexion refusée');
        await sdk.commands.authenticate({ access_token: data.access_token });
        state.room = sdk.instanceId || sdk.channelId || 'lobby';
        return data;
    }
    if (state.cfg.dev) {
        const { ok, data } = await api('api/dev-login', { id: params.get('id') || undefined, name: params.get('name') || undefined });
        if (!ok) throw new Error(data.error);
        state.room = 'dev';
        return data;
    }
    throw new Error('Ouvre le Plinko depuis Discord : rejoins un vocal, clique sur la fusée 🚀 puis choisis le bot.');
}

async function boot() {
    gate('Connexion à Discord…');
    try {
        state.cfg = (await api('api/config')).data;
        const data = await login();
        state.session = data.session;
        state.me = data.me;
        state.server = data.me.balance;
        renderBalance();
        renderLevel();
        applyLayout();
        connectRoom();
        gate(null);
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = 'Les gros coups des autres s\'affichent ici.';
        $('feed').append(empty);
        // le solde peut bouger ailleurs (work, daily...) : on le resynchronise de temps en temps
        setInterval(async () => {
            if (state.pending || state.inflight || state.auto) return;
            const { ok, data: me } = await api('api/me');
            if (ok) {
                state.server = me.balance;
                state.me = { ...state.me, ...me };
                renderBalance();
                renderLevel();
            }
        }, 15000);
    } catch (e) {
        gate(e.message || 'Connexion impossible.');
    }
}

// ---------------------------------------------------------------------------
seg('risk', 'risk', applyLayout);
seg('rows', 'rows', applyLayout);
$('drop').addEventListener('click', () => drop());
document.querySelector('.bet-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bet]');
    if (!b) return;
    const cur = parseBet($('bet').value) || state.cfg.minBet;
    if (b.dataset.bet === 'half') setBet(cur / 2);
    if (b.dataset.bet === 'double') setBet(cur * 2);
    if (b.dataset.bet === 'max') setBet(shown());
});
$('auto').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'stop') return stopAuto();
    startAuto(Number(b.dataset.n));
});
$('mute').addEventListener('click', () => {
    const m = sound.toggle();
    $('mute').textContent = m ? '🔇' : '🔊';
    $('mute').setAttribute('aria-label', m ? 'Remettre le son' : 'Couper le son');
});
$('mute').textContent = sound.muted ? '🔇' : '🔊';
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && $('gate').hidden) {
        e.preventDefault();
        drop();
    }
});

boot();
