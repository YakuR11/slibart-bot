import { DiscordSDK } from '@discord/embedded-app-sdk';
import { Board, bucketColor, multLabel, reduceMotion } from './board.js';
import { sound } from './sound.js';
import { CrashView } from './crash.js';
import { ShopView } from './shop.js';
import { DEFAULTS, lookOf, ballColor, applyTable, frameAttrs } from './looks.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.trunc(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ');
const ME_COLOR = '#ffd76a'; // couleur de mon nom dans les listes

const state = {
    cfg: null,
    session: null,
    me: null,
    room: 'lobby',
    risk: 'medium',
    rows: 12,
    server: 0, // solde confirme par le serveur
    seq: 0,
    ws: null,
    auto: 0,
    autoTimer: null,
    sessionNet: 0,
    streak: 0,
    needSync: false,
    skins: { ...DEFAULTS }, // mes skins equipes
    view: 'plinko',
};

/**
 * Une entree par bille lancee, jusqu'a ce qu'elle soit a la fois arrivee (animation) et
 * reglee (serveur). Le solde affiche en est deduit, donc il est toujours juste meme en rafale.
 */
const recs = new Map();
const friends = new Map(); // id -> pote dans la tribune
const avatars = new Map(); // url -> Image

const board = new Board($('board'), $('pops'));

// ---------------------------------------------------------------------------
// solde
// ---------------------------------------------------------------------------
function target() {
    let v = state.server;
    for (const r of recs.values()) v -= r.settled ? r.received : r.bet;
    return v;
}

const bal = { shown: 0, raf: 0 };
function renderBalance(dur = 0, cls = null) {
    const to = target();
    cancelAnimationFrame(bal.raf);
    const el = $('balance');
    if (cls) {
        el.classList.remove('up', 'big');
        void el.offsetWidth; // relance l'animation CSS
        el.classList.add(cls);
    }
    if (!dur || reduceMotion || to <= bal.shown) {
        bal.shown = to;
        el.textContent = fmt(to);
        return;
    }
    const from = bal.shown;
    const t0 = performance.now();
    const tick = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        bal.shown = from + (to - from) * (1 - (1 - t) ** 3);
        el.textContent = fmt(bal.shown);
        if (t < 1) bal.raf = requestAnimationFrame(tick);
    };
    bal.raf = requestAnimationFrame(tick);
}

function renderSession() {
    const el = $('session');
    el.hidden = state.sessionNet === 0;
    el.textContent = `${state.sessionNet > 0 ? '+' : ''}${fmt(state.sessionNet)} cette session`;
    el.className = `session ${state.sessionNet >= 0 ? 'pos' : 'neg'}`;
}

function renderStreak(bump) {
    const el = $('streak');
    el.hidden = state.streak < 2;
    el.textContent = state.streak >= 5 ? `🔥 ${state.streak} gains d'affilée` : `${state.streak} gains d'affilée`;
    el.classList.toggle('fire', state.streak >= 5);
    if (bump) {
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
    }
}

function renderLevel() {
    if (state.me) $('level').textContent = `niv. ${state.me.level}`;
}

// ---------------------------------------------------------------------------
// petits elements d'interface
// ---------------------------------------------------------------------------
const toastSeen = new Map();
function toast(text, err = false) {
    // pas deux fois le meme message en 3 s (rafales)
    if (Date.now() - (toastSeen.get(text) || 0) < 3000) return;
    toastSeen.set(text, Date.now());
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

function avatarImg(url) {
    if (!url) return null;
    let img = avatars.get(url);
    if (!img) {
        img = new Image();
        img.decoding = 'async';
        img.src = url;
        avatars.set(url, img);
    }
    return img;
}

function firstName(name) {
    return String(name).split(/\s+/)[0].slice(0, 12);
}

function addHistory(mult, rows, risk) {
    const el = document.createElement('span');
    el.textContent = multLabel(mult);
    const k = state.cfg.tables[rows][risk].indexOf(mult);
    el.style.background = bucketColor(k < 0 ? rows / 2 : k, rows);
    $('history').prepend(el);
    while ($('history').children.length > 14) $('history').lastChild.remove();
}

function addFeed(player, mult, net, color) {
    const feed = $('feed');
    feed.querySelector('.empty')?.remove();
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = player.avatar;
    img.alt = '';
    if (color) img.style.boxShadow = `0 0 0 2px ${color}`;
    const name = document.createElement('b');
    name.textContent = player.name;
    if (color) name.style.color = color;
    const res = document.createElement('span');
    res.className = net > 0 ? 'w' : 'l';
    res.textContent = net > 0 ? `${multLabel(mult)} · +${fmt(net)}` : multLabel(mult);
    li.append(img, name, res);
    feed.prepend(li);
    while (feed.children.length > 8) feed.lastChild.remove();
}

function flashBoard() {
    if (reduceMotion) return;
    const w = $('board-wrap');
    w.classList.remove('flash');
    void w.offsetWidth;
    w.classList.add('flash');
}

// ---------------------------------------------------------------------------
// gros gains : GROS GAIN / MEGA GAIN / JACKPOT avec compteur qui defile
// ---------------------------------------------------------------------------
const big = { tier: 0, timer: null, raf: 0 };

function tierOf(mult) {
    return mult >= 200 ? 3 : mult >= 50 ? 2 : mult >= 10 ? 1 : 0;
}

function bigWin(rec, pos) {
    const tier = tierOf(rec.mult);
    board.shake([0, 7, 11, 16][tier]);
    board.burst(pos.x, pos.y, { kind: 'coin', n: 18 + tier * 14, power: 1.2 + tier * 0.25 });
    board.burst(pos.x, pos.y, { kind: 'confetti', n: 20 + tier * 10, power: 1.1 });
    board.rain(30 + tier * 50);
    flashBoard();
    showBigWin(rec.mult, rec.payout - rec.bet, rec.bet);
}

/** ecran GROS GAIN / MEGA GAIN / JACKPOT + compteur (commun a tous les jeux) */
function showBigWin(mult, net, bet) {
    const tier = tierOf(mult);
    if (!tier) return;
    const seconds = [0, 1.4, 2.4, 3.6][tier];
    sound.bigWin(tier, seconds);

    // un gain plus petit ne remplace pas un plus gros deja a l'ecran
    if (!$('bigwin').hidden && tier < big.tier) return;
    big.tier = tier;
    const el = $('bigwin');
    el.className = `bigwin t${tier}`;
    el.hidden = false;
    $('bw-title').textContent = ['', 'GROS GAIN', 'MÉGA GAIN', 'JACKPOT'][tier];
    $('bw-mult').textContent = `×${mult} · mise ${fmt(bet)}`;
    cancelAnimationFrame(big.raf);
    clearTimeout(big.timer);
    const t0 = performance.now() + 350;
    const dur = seconds * 1000;
    const tick = (now) => {
        const t = Math.max(0, Math.min(1, (now - t0) / dur));
        const e = t < 1 ? 1 - (1 - t) ** 2.2 : 1;
        $('bw-amount').textContent = fmt(net * e);
        if (t > 0 && t < 1) sound.tick(t);
        if (t < 1) big.raf = requestAnimationFrame(tick);
    };
    big.raf = requestAnimationFrame(tick);
    big.timer = setTimeout(closeBigWin, dur + 1700);
}

function closeBigWin() {
    const el = $('bigwin');
    if (el.hidden) return;
    clearTimeout(big.timer);
    cancelAnimationFrame(big.raf);
    el.classList.add('out');
    setTimeout(() => {
        el.hidden = true;
        el.classList.remove('out');
        big.tier = 0;
    }, 340);
}

// ---------------------------------------------------------------------------
// mes billes
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

function mineInAir() {
    let n = 0;
    for (const r of recs.values()) if (!r.landed) n++;
    return n;
}

function wsSend(msg) {
    if (state.ws?.readyState === 1) {
        state.ws.send(JSON.stringify(msg));
        return true;
    }
    return false;
}

function drop() {
    if (!state.session) return;
    sound.unlock();
    const bet = parseBet($('bet').value);
    if (!Number.isFinite(bet) || bet < state.cfg.minBet) {
        toast(`Mise minimum : ${fmt(state.cfg.minBet)}`, true);
        sound.error();
        return stopAuto();
    }
    if (bet > target()) {
        toast(`Pas assez de Rokbux pour miser ${fmt(bet)}`, true);
        sound.error();
        return stopAuto();
    }
    let waiting = 0;
    for (const r of recs.values()) if (!r.settled) waiting++;
    if (waiting >= 38) return; // le serveur a deja une grosse file : on laisse respirer

    const rec = { id: ++state.seq, bet, rows: state.rows, risk: state.risk, settled: false, landed: false, received: 0, payout: 0, mult: null };
    recs.set(rec.id, rec);
    const look = lookOf(state.skins, 'ball');
    rec.ball = board.addBall({
        color: ballColor(look),
        look,
        trailLook: lookOf(state.skins, 'trail'),
        mine: true,
        onPeg: (r, b) => sound.peg(r, rec.rows, true, b.slow < 1),
        onTension: (level, remaining) => sound.tension(level, remaining),
        onLand: (k, pos) => landed(rec, pos),
    });
    sound.launch();
    renderBalance();
    // filet de securite : sans reponse en 12 s, on abandonne la bille et on resynchronise
    rec.timer = setTimeout(() => {
        if (!recs.has(rec.id) || rec.settled) return;
        recs.delete(rec.id);
        if (!rec.landed) rec.ball.cancel();
        toast('Connexion lente, solde resynchronisé.', true);
        state.needSync = true;
        maybeSync();
    }, 12000);

    const msg = { type: 'drop', id: rec.id, bet, risk: rec.risk, rows: rec.rows };
    if (!wsSend(msg)) httpDrop(rec);
}

async function httpDrop(rec) {
    const { ok, data } = await api('api/plinko/drop', { bet: rec.bet, risk: rec.risk, rows: rec.rows, room: state.room });
    if (!ok) return onErr(rec, data);
    onBall(rec, data);
    onSettled(rec, data);
}

function onBall(rec, m) {
    rec.mult = m.mult;
    rec.payout = m.payout;
    rec.bucket = m.bucket;
    // on a change de plateau entre-temps : pas d'animation, resultat direct
    if (rec.rows !== state.rows) {
        rec.ball.cancel();
        return landed(rec, null);
    }
    rec.ball.setPath(m.path, { tension: mineInAir() <= 3 });
}

function onSettled(rec, m) {
    rec.settled = true;
    rec.received = Number(m.received ?? m.payout) || 0;
    state.server = Number(m.balance);
    if (rec.landed) finish(rec);
    else renderBalance();
}

function onErr(rec, m) {
    clearTimeout(rec.timer);
    recs.delete(rec.id);
    if (!rec.landed) rec.ball.cancel();
    renderBalance();
    if (m.fatal || m.status === 401) gate('Session expirée : ferme et relance l\'activité.');
    if (m.soft) return toast(m.error || 'Doucement !');
    toast(m.error || 'Erreur, réessaie', true);
    sound.error();
    stopAuto();
}

function landed(rec, pos) {
    if (rec.landed) return;
    rec.landed = true;
    if (rec.mult == null) return; // annulee
    celebrate(rec, pos);
    if (rec.settled) finish(rec);
}

function finish(rec) {
    clearTimeout(rec.timer);
    recs.delete(rec.id);
    const win = rec.payout > rec.bet;
    const tier = tierOf(rec.mult);
    if (tier) renderBalance([0, 1400, 2400, 3600][tier] + 350, 'big');
    else renderBalance(win ? 550 : 0, win && rec.mult >= 2 ? 'up' : null);
    maybeSync();
}

function celebrate(rec, pos) {
    const m = rec.mult;
    const net = rec.payout - rec.bet;
    state.sessionNet += net;
    renderSession();
    if (m > 1) {
        state.streak++;
        renderStreak(true);
        if (state.streak >= 3) sound.streak(state.streak);
    } else if (m < 1 && state.streak) {
        state.streak = 0;
        renderStreak(false);
    }
    addHistory(m, rec.rows, rec.risk);
    if (m >= 5 && state.me) addFeed(state.me, m, net, ME_COLOR);
    if (!pos) return;

    const color = bucketColor(rec.bucket, rec.rows);
    if (tierOf(m) > 0) {
        board.pop(`+${fmt(net)}`, pos.x, 'big');
        return bigWin(rec, pos);
    }
    sound.land(m);
    if (m < 1) {
        if (mineInAir() < 6) board.pop(multLabel(m), pos.x, 'loss');
    } else if (m < 2) {
        board.pop(net > 0 ? `+${fmt(net)}` : multLabel(m), pos.x, 'win');
        board.burst(pos.x, pos.y, { kind: 'coin', n: 4, power: 0.7 });
    } else {
        board.pop(`+${fmt(net)}`, pos.x, 'good');
        board.burst(pos.x, pos.y, { kind: 'coin', n: m >= 5 ? 16 : 9, power: 1 });
        board.burst(pos.x, pos.y, { color, n: 10, power: 0.9 });
        board.shake(m >= 5 ? 4 : 2);
    }
}

function startAuto(n) {
    stopAuto();
    state.auto = n;
    $('stop').hidden = false;
    $('stop').textContent = `Stop (${n})`;
    const next = () => {
        if (state.auto <= 0) return stopAuto();
        state.auto--;
        $('stop').textContent = `Stop (${state.auto})`;
        drop();
        if (state.auto > 0) state.autoTimer = setTimeout(next, 170);
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
// les potes : tribune (mini plateau par pote) + leurs billes sur mon plateau
// ---------------------------------------------------------------------------
function ensureFriend(p) {
    if (!p || p.id === state.me?.id) return null;
    let f = friends.get(p.id);
    if (!f) {
        const li = document.createElement('li');
        li.className = 'pal';
        const img = document.createElement('img');
        img.alt = '';
        const who = document.createElement('div');
        who.className = 'who';
        const name = document.createElement('b');
        const info = document.createElement('span');
        info.textContent = 'regarde…';
        who.append(name, info);
        const mini = document.createElement('div');
        mini.className = 'mini';
        const canvas = document.createElement('canvas');
        const last = document.createElement('span');
        last.className = 'last';
        mini.append(canvas, last);
        li.append(img, who, mini);
        $('tribune').append(li);
        f = { id: p.id, li, img, name, info, last, net: 0, rows: 12, risk: 'medium', board: new Board(canvas, null, { mini: true }) };
        friends.set(p.id, f);
        $('tribune').hidden = false;
    }
    f.player = { id: p.id, name: p.name, avatar: p.avatar };
    f.color = p.color || f.color || '#4fd1ff';
    f.li.style.setProperty('--c', f.color);
    if (p.skins) {
        f.skins = p.skins;
        frameAttrs(f.img, p.skins);
        f.board.setTheme(lookOf(p.skins, 'board'));
    }
    if (f.img.getAttribute('src') !== p.avatar) f.img.src = p.avatar;
    f.name.textContent = p.name;
    if (p.rows && p.risk) setFriendCfg(f, p.rows, p.risk);
    return f;
}

function setFriendCfg(f, rows, risk) {
    if (!state.cfg.tables[rows]?.[risk]) return;
    if (f.rows === rows && f.risk === risk && f.board.mults.length) return;
    f.rows = rows;
    f.risk = risk;
    f.board.setLayout(rows, state.cfg.tables[rows][risk]);
    renderFriendInfo(f);
}

function renderFriendInfo(f) {
    const risk = { low: 'doux', medium: 'normal', high: 'sale' }[f.risk];
    f.info.replaceChildren();
    const net = document.createElement('span');
    net.className = f.net >= 0 ? 'pos' : 'neg';
    net.textContent = f.net ? `${f.net > 0 ? '+' : ''}${fmt(f.net)}` : '';
    f.info.append(`${f.rows} · ${risk} `, net);
}

function renderPlayers(list) {
    const ul = $('players');
    ul.replaceChildren(...list.slice(0, 8).map((p) => {
        const li = document.createElement('li');
        li.style.backgroundImage = `url("${p.avatar}")`;
        li.title = p.name;
        li.style.setProperty('--c', p.id === state.me?.id ? '#ffd76a' : (p.color || '#cdbb9f'));
        frameAttrs(li, p.skins);
        return li;
    }));
    const ids = new Set(list.map((p) => p.id));
    for (const [id, f] of friends) {
        if (!ids.has(id)) {
            f.board.ro.disconnect();
            f.li.remove();
            friends.delete(id);
        }
    }
    for (const p of list) ensureFriend(p);
    $('tribune').hidden = friends.size === 0;
}

function onFriendDrop(msg) {
    const f = ensureFriend(msg.player);
    if (!f) return;
    setFriendCfg(f, msg.rows, msg.risk);
    const net = Math.floor(msg.net);
    const fl = msg.player.skins || f.skins;
    f.board.addBall({
        path: msg.path,
        color: f.color,
        look: fl ? lookOf(fl, 'ball') : null,
        onLand: () => {
            f.net += net;
            renderFriendInfo(f);
            f.last.textContent = multLabel(msg.mult);
            f.last.style.background = bucketColor(f.board.mults.indexOf(msg.mult), f.rows);
            f.last.classList.remove('flash');
            void f.last.offsetWidth;
            f.last.classList.add('flash');
            if (msg.mult >= 2) addFeed(f.player, msg.mult, net, f.color);
            if (msg.mult >= 10) friendBigWin(f, msg, net);
        },
    });
    // meme plateau que moi : sa bille tombe aussi chez moi, avec sa tete dessus
    if (msg.rows === state.rows && board.balls.length < 80) {
        // un seul nom par pote a l'ecran (sur sa bille la plus avancee), sinon c'est illisible en rafale
        board.addBall({
            labelKey: f.id,
            path: msg.path,
            color: f.color,
            img: avatarImg(f.player.avatar),
            look: fl ? lookOf(fl, 'ball') : null,
            trailLook: fl ? lookOf(fl, 'trail') : null,
            label: firstName(f.player.name),
            onPeg: (r) => sound.peg(r, msg.rows, false),
            onLand: (k, pos) => {
                if (!pos) return;
                if (msg.mult >= 2) board.pop(net > 0 ? `${firstName(f.player.name)} +${fmt(net)}` : multLabel(msg.mult), pos.x, 'friend', f.color);
                if (msg.mult >= 2) board.burst(pos.x, pos.y, { color: f.color, n: 8, power: 0.8 });
            },
        });
    }
}

function friendBigWin(f, msg, net) {
    const tier = tierOf(msg.mult);
    board.rain(20 + tier * 25, [f.color, '#ffd76a', '#f7ebd7']);
    f.li.classList.remove('hot');
    void f.li.offsetWidth;
    f.li.classList.add('hot');
    banner(f.player, f.color, `${['', 'gros gain', 'MÉGA GAIN', 'JACKPOT'][tier]} · ${multLabel(msg.mult)} au Plinko`, net, tier);
}

/** bandeau en haut : un pote vient de gagner gros (Plinko ou Crash) */
function banner(player, color, text, net, tier = 1) {
    sound.friendWin(tier);
    const el = document.createElement('div');
    el.className = 'banner';
    el.style.setProperty('--c', color);
    const img = document.createElement('img');
    img.src = player.avatar;
    img.alt = '';
    const mid = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = player.name;
    const small = document.createElement('small');
    small.textContent = text;
    mid.append(b, small);
    const amt = document.createElement('span');
    amt.className = 'amt';
    amt.textContent = `+${fmt(net)}`;
    el.append(img, mid, amt);
    $('banners').prepend(el);
    while ($('banners').children.length > 2) $('banners').lastChild.remove();
    setTimeout(() => el.remove(), 4100);
}

// ---------------------------------------------------------------------------
// connexion temps reel (salle du vocal + mes billes)
// ---------------------------------------------------------------------------
function connectRoom(attempt = 0) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = location.pathname.startsWith('/.proxy') ? '/.proxy' : '';
    const ws = new WebSocket(`${proto}://${location.host}${base}/ws?session=${encodeURIComponent(state.session)}&room=${encodeURIComponent(state.room)}`);
    state.ws = ws;
    ws.onopen = () => {
        attempt = 0;
        crash.join();
        wsSend({ type: 'cfg', rows: state.rows, risk: state.risk });
    };
    ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        const rec = m.id != null ? recs.get(m.id) : null;
        switch (m.type) {
            case 'ball': if (rec) onBall(rec, m); break;
            case 'settled': if (rec) onSettled(rec, m); break;
            case 'err': if (rec) onErr(rec, m); else if (m.fatal) gate(m.error); break;
            case 'notices': for (const n of m.list || []) toast(n); break;
            case 'players': renderPlayers(m.players || []); break;
            case 'crash:state': case 'crash:bet': case 'crash:cancel': case 'crash:cashout': case 'crash:balance': case 'crash:res':
                crash.onMessage(m); break;
            case 'cfg': { const f = friends.get(m.id); if (f) setFriendCfg(f, m.rows, m.risk); break; }
            case 'drop': if (m.player?.id !== state.me?.id) onFriendDrop(m); break;
            default:
        }
    };
    ws.onclose = (e) => {
        if (state.ws === ws) state.ws = null;
        if (e.code === 4001) return gate('Session expirée : ferme et relance l\'activité.');
        setTimeout(() => connectRoom(attempt + 1), Math.min(10000, 500 * 2 ** attempt));
    };
}

async function api(path, body) {
    const res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(state.session ? { Authorization: `Bearer ${state.session}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    if (!res) return { ok: false, status: 0, data: { error: 'Réseau indisponible' } };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) data.status = res.status;
    if (res.status === 429) data.soft = true;
    return { ok: res.ok, status: res.status, data };
}

async function sync() {
    const { ok, data: me } = await api('api/me');
    if (!ok || recs.size) return;
    state.server = me.balance;
    state.me = { ...state.me, ...me };
    state.needSync = false;
    renderBalance();
    renderLevel();
}
function maybeSync() {
    if (state.needSync && !recs.size) sync();
}

// ---------------------------------------------------------------------------
// connexion Discord
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
        state.room = params.get('room') || 'dev';
        return data;
    }
    throw new Error('Ouvre le Plinko depuis Discord : rejoins un vocal, clique sur la fusée 🚀 puis choisis le bot.');
}

function applyLayout() {
    board.setLayout(state.rows, state.cfg.tables[state.rows][state.risk]);
    wsSend({ type: 'cfg', rows: state.rows, risk: state.risk });
}

async function boot() {
    gate('Connexion à Discord…');
    try {
        state.cfg = (await api('api/config')).data;
        $('ver').textContent = `version ${state.cfg.version || '?'}`;
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
        empty.textContent = 'Les gros coups des potes s\'affichent ici.';
        $('feed').append(empty);
        // le solde peut bouger ailleurs (work, daily...) : on le resynchronise quand rien ne tombe
        setInterval(() => { if (!recs.size && !state.auto) sync(); }, 15000);
        // mode test uniquement : de quoi declencher les effets a la main
        if (state.cfg.dev) window.plinkoDebug = { state, recs, board, celebrate, bigWin, friendBigWin, friends, crash, shop };
        // mes skins (tables, bille...) des le chargement
        api('api/shop').then(({ ok, data }) => ok && applySkins(data.equipped));
    } catch (e) {
        gate(e.message || 'Connexion impossible.');
    }
}

// ---------------------------------------------------------------------------
// controles
// ---------------------------------------------------------------------------
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

seg('risk', 'risk', applyLayout);
seg('rows', 'rows', applyLayout);

// clic = une bille ; bouton maintenu = ca enchaine
const hold = { t: null, i: null };
function stopHold() {
    clearTimeout(hold.t);
    clearInterval(hold.i);
    hold.t = hold.i = null;
}
$('drop').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stopHold();
    drop();
    hold.t = setTimeout(() => { hold.i = setInterval(drop, 140); }, 380);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) $('drop').addEventListener(ev, stopHold);
$('drop').addEventListener('click', (e) => { if (e.detail === 0) drop(); }); // clavier (Entree)
window.addEventListener('blur', stopHold);

$('bet-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bet]');
    if (!b) return;
    const cur = parseBet($('bet').value) || state.cfg.minBet;
    if (b.dataset.bet === 'half') setBet(cur / 2);
    if (b.dataset.bet === 'double') setBet(cur * 2);
    if (b.dataset.bet === 'max') setBet(target());
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
$('bigwin').addEventListener('click', closeBigWin);

let lastKey = 0;
document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || document.activeElement?.tagName === 'INPUT' || !$('gate').hidden) return;
    if (state.view === 'shop') return;
    e.preventDefault();
    const now = performance.now();
    if (state.view === 'crash') {
        if (e.repeat) return;
        return crash.press();
    }
    if (now - lastKey < 120) return; // touche maintenue : ~8 billes/s
    lastKey = now;
    drop();
});

// ---------------------------------------------------------------------------
// skins, onglets, Crash, Boutique
// ---------------------------------------------------------------------------
function applySkins(equipped) {
    state.skins = { ...DEFAULTS, ...equipped };
    const table = lookOf(state.skins, 'board');
    applyTable($('board-wrap'), table);
    applyTable($('crash-wrap'), table);
    board.setTheme(table);
}

function setBalance(bal) {
    if (!Number.isFinite(Number(bal))) return;
    const up = Number(bal) > target();
    state.server = Number(bal);
    renderBalance(up ? 600 : 0, up ? 'up' : null);
}

const crash = new CrashView({
    send: wsSend,
    me: () => state.me,
    mySkins: () => state.skins,
    onBalance: setBalance,
    toast,
    sound,
    celebrate: (mult, net, bet) => {
        state.sessionNet += net;
        renderSession();
        if (tierOf(mult)) showBigWin(mult, net, bet);
    },
    friendWin: (player, mult, net) => banner(player, player.color || '#4fd1ff', `encaisse ×${mult.toFixed(2)} au Crash`, net, Math.max(1, tierOf(mult))),
    avatarImg,
    parseBet,
    maxBet: () => target(),
    get minBet() { return state.cfg?.minBet || 10; },
});

const shop = new ShopView({
    api,
    toast,
    sound,
    me: () => state.me,
    avatarImg,
    balance: () => target(),
    onBalance: setBalance,
    onEquip: (eq) => applySkins(eq),
});

function setView(view) {
    state.view = view;
    for (const b of $('tabs').children) b.setAttribute('aria-selected', String(b.dataset.view === view));
    for (const el of document.querySelectorAll('.view')) el.hidden = el.dataset.view !== view;
    crash.show(view === 'crash');
    shop.show(view === 'shop');
    if (view === 'plinko') board.resize();
    try { localStorage.setItem('casino-view', view); } catch { /* rien */ }
}
$('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    sound.unlock();
    setView(b.dataset.view);
});
try {
    const v = localStorage.getItem('casino-view');
    if (v && v !== 'plinko') setView(v);
} catch { /* rien */ }

boot();
