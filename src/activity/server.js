// Serveur de l'Activity Discord (Plinko) : page web, connexion Discord, API du jeu, salle en direct.
// Il tourne dans le meme process que le bot (memes Rokbux, meme base).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const config = require('../config');
const db = require('../db');
const eco = require('../lib/economy');
const log = require('../lib/logger');
const progress = require('../lib/progress');
const plinko = require('./plinko');
const crash = require('./crash');
const feed = require('./feed');
const games = require('./games');
const life = require('./life');
const loto = require('../lib/loto');
const skins = require('../lib/skins');
const sportApp = require('./sports');

const ROOT = path.join(__dirname, '..', '..', 'activity');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const SESSION_TTL = 12 * 3600 * 1000;

const sessions = new Map(); // token -> { id, name, avatar, user, exp }
const rooms = new Map(); // instanceId -> Set(ws)
let client = null;

// ---------------------------------------------------------------------------
// utilitaires
// ---------------------------------------------------------------------------
function send(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (c) => {
            data += c;
            if (data.length > 10_000) req.destroy();
        });
        req.on('end', () => {
            try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
        });
    });
}

function auth(req) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const s = sessions.get(token);
    if (!s || s.exp < Date.now()) return null;
    return s;
}

// l'Activity ne peut pas charger d'images d'un autre domaine : on relaie les avatars Discord
function avatarUrl(u) {
    if (!u.avatar) return `avatar/default/${Number(BigInt(u.id) >> 22n) % 6}`;
    return `avatar/${u.id}/${u.avatar}`;
}

async function serveAvatar(res, route) {
    const m = route.match(/^\/avatar\/(default\/[0-5]|\d{5,20}\/a?_?[0-9a-f]{32})$/);
    if (!m) return send(res, 404, 'introuvable', 'text/plain');
    const src = m[1].startsWith('default/')
        ? `https://cdn.discordapp.com/embed/avatars/${m[1].split('/')[1]}.png`
        : `https://cdn.discordapp.com/avatars/${m[1]}.png?size=64`;
    const r = await fetch(src).catch(() => null);
    if (!r?.ok) return send(res, 404, 'introuvable', 'text/plain');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    res.end(Buffer.from(await r.arrayBuffer()));
}

/** image de profil (=set img) relayee : l'Activity ne peut pas charger d'autres domaines */
const imgCache = new Map();
async function proxyImage(res, src, maxBytes) {
    const hit = imgCache.get(src);
    if (hit && Date.now() - hit.at < 3600_000) {
        res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=3600' });
        return res.end(hit.buf);
    }
    const r = await fetch(src, { redirect: 'follow', signal: AbortSignal.timeout(8000) }).catch(() => null);
    const type = r?.headers.get('content-type') || '';
    if (!r?.ok || !/^(image\/|video\/mp4)/.test(type)) return send(res, 404, 'introuvable', 'text/plain');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) return send(res, 413, 'trop lourd', 'text/plain');
    if (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(src, { at: Date.now(), type, buf });
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
    return res.end(buf);
}

async function serveProfileImage(res, route) {
    const m = route.match(/^\/pimg\/(\d{5,20})$/);
    if (!m) return send(res, 404, 'introuvable', 'text/plain');
    const src = await life.profileImageUrl(m[1]);
    if (!src || !/^https?:\/\//.test(src)) return send(res, 404, 'introuvable', 'text/plain');
    return proxyImage(res, src, 6 * 1024 * 1024);
}

/** GIF perso (Giphy uniquement) */
async function serveGif(res, u) {
    const ok = u && skins.normalizeGif(u) === u;
    if (!ok) return send(res, 404, 'introuvable', 'text/plain');
    return proxyImage(res, u, 15 * 1024 * 1024);
}

async function newSession(u) {
    const token = crypto.randomBytes(24).toString('base64url');
    const member = client && config.guildId ? await client.guilds.cache.get(config.guildId)?.members.fetch(u.id).catch(() => null) : null;
    const user = client ? await client.users.fetch(u.id).catch(() => null) : null;
    const s = {
        id: String(u.id),
        name: member?.displayName || u.global_name || u.username,
        avatar: avatarUrl(u),
        user,
        exp: Date.now() + SESSION_TTL,
    };
    sessions.set(token, s);
    await db.ensureProfile(s.id);
    life.assignHouse(s.id).catch(() => {});
    return { token, s };
}

async function profileOf(s) {
    const p = await db.getProfile(s.id);
    const lvl = progress.levelInfo(p.xp);
    return { id: s.id, name: s.name, avatar: s.avatar, balance: p.rb, level: lvl.level, xp: lvl.cur, xpNeed: lvl.need, debt: p.debt || 0 };
}

// ---------------------------------------------------------------------------
// salle en direct (tout le monde dans le meme vocal voit les billes des autres)
// ---------------------------------------------------------------------------
/** a tout le monde dans l'app, toutes salles confondues (centre des paris) */
function broadcastAll(msg) {
    const data = JSON.stringify(msg);
    for (const set of rooms.values()) for (const ws of set) if (ws.readyState === 1) ws.send(data);
}

/** a toutes les fenetres d'un joueur */
function sendTo(userId, msg) {
    const data = JSON.stringify(msg);
    for (const set of rooms.values()) for (const ws of set) if (ws.player?.id === String(userId) && ws.readyState === 1) ws.send(data);
}

/** joueur connecte a l'app (n'importe quelle salle) -> ses infos, sinon null */
function online(userId) {
    for (const set of rooms.values()) for (const ws of set) if (ws.player?.id === String(userId)) return ws.player;
    return null;
}

function onlineList() {
    const seen = new Map();
    for (const set of rooms.values()) for (const ws of set) if (ws.player && !seen.has(ws.player.id)) seen.set(ws.player.id, { id: ws.player.id, name: ws.player.name, avatar: ws.player.avatar, skins: ws.player.skins || null });
    return [...seen.values()];
}

/** nom + avatar d'un membre (pour la carte et les profils), avec cache */
const infoCache = new Map();
async function userInfo(id) {
    // quelqu'un de connecte a l'app : on a deja son nom et sa pp
    const live = online(id);
    if (live && !client) return { name: live.name, avatar: live.avatar };
    const hit = infoCache.get(id);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
    const u = client ? await client.users.fetch(id).catch(() => null) : null;
    const member = client && config.guildId ? await client.guilds.cache.get(config.guildId)?.members.fetch(id).catch(() => null) : null;
    const v = { name: member?.displayName || u?.globalName || u?.username || '???', avatar: u ? avatarUrl({ id, avatar: u.avatar }) : `avatar/default/${Number(BigInt(id) >> 22n) % 6}` };
    infoCache.set(id, { at: Date.now(), v });
    return v;
}

/** actions de l'app (WebSocket : { type: 'req', id, op, args }) */
async function handleReq(ws, room, s, op, a = {}) {
    const player = { id: s.id, name: s.name, avatar: s.avatar, user: s.user, skins: ws.player.skins || null };
    switch (op) {
        case 'roulette': return games.roulette(player, a);
        case 'slots': return games.slots(player, a);
        case 'slots.jackpot': return { jackpot: await games.jackpot() };
        case 'blackjack': return games.blackjack(player, a);
        case 'mines': return games.mines(player, a);
        case 'loto.state': {
            const st = await loto.state();
            const mine = Number(st.rows.find((r) => String(r.id_user) === s.id)?.tickets || 0);
            const top = await Promise.all(st.rows.slice(0, 8).map(async (r) => ({ ...(await userInfo(String(r.id_user))), id: String(r.id_user), tickets: Number(r.tickets) })));
            return { round: st.round, pot: st.pot, total: st.total, mine, top, next: loto.nextDraw(), price: loto.TICKET, max: loto.MAX_TICKETS };
        }
        case 'loto.buy': {
            const r = await loto.buy(s.id, a.n === 'max' ? 'max' : a.n);
            if (!r.error) {
                const id = feed.start({ player, game: 'loto', bet: r.n * loto.TICKET, text: `${r.n} ticket${r.n > 1 ? 's' : ''}` });
                feed.finish(id, { net: 0, text: 'en attente du tirage de 21h' });
            }
            return { ...r, balance: await eco.balance(s.id) };
        }
        case 'duel.online': return { players: onlineList().filter((p) => p.id !== s.id) };
        case 'duel.challenge': return games.duelChallenge(player, { ...a, online });
        case 'duel.answer': return games.duelAnswer(player, a);
        case 'duel.play': return games.duelPlay(player, a);
        case 'map': {
            const data = await life.mapData(userInfo);
            const mine = data.houses.find((h) => h.id === s.id);
            return { ...data, you: mine ? mine.plot : null, full: !mine && data.houses.length >= data.plots };
        }
        case 'sports.list': return sportApp.list(s.id);
        case 'sports.bet': return sportApp.bet(s.id, a);
        case 'profile': return life.profileData(String(a.id || s.id), userInfo);
        case 'gif.get': return { owned: await skins.hasGif(s.id), url: await skins.gifOf(s.id), price: skins.GIF_PRICE };
        case 'gif.set': return skins.setGif(s.id, a.url);
        default: return { error: 'Action inconnue.' };
    }
}

function broadcast(room, msg, except = null) {
    const set = rooms.get(room);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) if (ws !== except && ws.readyState === 1) ws.send(data);
}

// une couleur par joueur dans la salle (distinctes, jamais l'or : l'or c'est "ma" bille)
const PALETTE = ['#4fd1ff', '#ff6fb5', '#8cff6b', '#b98bff', '#ff8a3d', '#3dffd0', '#ff4f6a', '#f2f26b'];

function players(room) {
    const seen = new Map();
    for (const ws of rooms.get(room) || []) {
        if (ws.player && !seen.has(ws.player.id)) seen.set(ws.player.id, { ...ws.player });
    }
    return [...seen.values()];
}

function colorFor(room, id) {
    const used = new Set();
    for (const ws of rooms.get(room) || []) {
        if (ws.player?.id === id) return ws.player.color;
        if (ws.player) used.add(ws.player.color);
    }
    return PALETTE.find((c) => !used.has(c)) || PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function broadcastDrop(room, s, b, except = null) {
    let color = null;
    let look = null;
    for (const ws of rooms.get(room) || []) {
        if (ws.player?.id === s.id) {
            color = ws.player.color;
            look = ws.player.skins;
        }
    }
    broadcast(room, {
        type: 'drop',
        player: { id: s.id, name: s.name, avatar: s.avatar, color, skins: look },
        rows: b.rows, risk: b.risk, path: b.path, mult: b.mult, bet: b.bet, net: b.payout - b.bet,
    }, except);
}

/** un joueur a change de skin : tout le monde le voit tout de suite */
function refreshLook(id, equipped) {
    for (const [room, set] of rooms) {
        let hit = false;
        for (const ws of set) {
            if (ws.player?.id === id) {
                ws.player.skins = equipped;
                hit = true;
            }
        }
        if (hit) broadcast(room, { type: 'players', players: players(room) });
    }
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
async function api(req, res, route) {
    if (route === '/api/config' && req.method === 'GET') {
        return send(res, 200, { version: uiVersion(), clientId: config.activity.clientId, dev: config.activity.dev, rb: 'RB', tables: plinko.TABLES, minBet: plinko.MIN_BET, maxBet: plinko.MAX_BET });
    }

    // echange du code OAuth Discord contre un token, puis session de jeu
    if (route === '/api/token' && req.method === 'POST') {
        const { code } = await readJson(req);
        if (!code) return send(res, 400, { error: 'code manquant' });
        const r = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: config.activity.clientId,
                client_secret: config.activity.clientSecret,
                grant_type: 'authorization_code',
                code,
            }),
        });
        const tok = await r.json().catch(() => ({}));
        if (!tok.access_token) {
            log.warn('[activity] echange OAuth refuse :', JSON.stringify(tok).slice(0, 200));
            return send(res, 401, { error: 'connexion Discord refusee' });
        }
        const me = await (await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
        if (!me?.id) return send(res, 401, { error: 'utilisateur introuvable' });
        const { token, s } = await newSession(me);
        log.info(`[activity] ${s.name} a ouvert le Plinko`);
        return send(res, 200, { access_token: tok.access_token, session: token, me: await profileOf(s) });
    }

    // mode test hors Discord (ACTIVITY_DEV=true seulement)
    // (refuse tout ce qui passe par Cloudflare : le mode test ne doit jamais etre joignable depuis Internet)
    if (route === '/api/dev-login' && req.method === 'POST' && config.activity.dev && !req.headers['cf-connecting-ip'] && !req.headers['cf-ray']) {
        const { id = '100000000000000001', name = 'Testeur' } = await readJson(req);
        const { token, s } = await newSession({ id: String(id), username: name, global_name: name, avatar: null });
        return send(res, 200, { session: token, me: await profileOf(s) });
    }

    const s = auth(req);
    if (!s) return send(res, 401, { error: 'session expiree, relance l\'activite' });

    if (route === '/api/me' && req.method === 'GET') return send(res, 200, await profileOf(s));

    if (route === '/api/plinko/drop' && req.method === 'POST') {
        const body = await readJson(req);
        const room = body.room ? String(body.room) : null;
        const out = await plinko.drop({ id: s.id, name: s.name, user: s.user, avatar: s.avatar }, body, {
            onBall: (b) => room && broadcastDrop(room, s, b),
        });
        if (out.error) return send(res, out.soft ? 429 : 400, out);
        return send(res, 200, out);
    }

    // ---- boutique de skins ----
    if (route === '/api/shop' && req.method === 'GET') {
        const [owned, equipped, p] = await Promise.all([skins.owned(s.id), skins.equipped(s.id), db.getProfile(s.id)]);
        return send(res, 200, { owned: [...owned], equipped, balance: p.rb });
    }
    if (route === '/api/shop/buy' && req.method === 'POST') {
        const { id } = await readJson(req);
        const r = await skins.buy(s.id, String(id || ''));
        if (r.error) return send(res, 400, r);
        log.info(`[boutique] ${s.name} achete ${id} (${r.price})`);
        const [owned, p] = await Promise.all([skins.owned(s.id), db.getProfile(s.id)]);
        return send(res, 200, { ok: true, owned: [...owned], balance: p.rb });
    }
    if (route === '/api/shop/equip' && req.method === 'POST') {
        const { id } = await readJson(req);
        const r = await skins.equip(s.id, String(id || ''));
        if (r.error) return send(res, 400, r);
        refreshLook(s.id, r.equipped);
        return send(res, 200, r);
    }

    if (route === '/api/top' && req.method === 'GET') {
        const rows = await db.q('SELECT id_user, rb FROM profile WHERE id_user != ? ORDER BY rb DESC LIMIT 5', [config.casinoId]);
        const out = [];
        for (const r of rows) {
            const u = client ? await client.users.fetch(String(r.id_user)).catch(() => null) : null;
            out.push({ name: u?.globalName || u?.username || '???', rb: Number(r.rb) });
        }
        return send(res, 200, out);
    }

    return send(res, 404, { error: 'introuvable' });
}

/**
 * Version de l'interface = empreinte de app.js + style.css.
 * index.html est servi avec ?v=<version> sur ses fichiers : a chaque mise a jour l'adresse change,
 * donc ni Discord, ni Cloudflare, ni le navigateur ne peuvent resservir l'ancien code.
 */
let versionCache = { key: '', v: 'dev' };
function uiVersion() {
    try {
        const files = [path.join(ROOT, 'dist', 'app.js'), path.join(ROOT, 'style.css')];
        const key = files.map((f) => fs.statSync(f).mtimeMs).join(':');
        if (key !== versionCache.key) {
            const h = crypto.createHash('sha1');
            for (const f of files) h.update(fs.readFileSync(f));
            versionCache = { key, v: h.digest('hex').slice(0, 8) };
        }
    } catch { /* build absent */ }
    return versionCache.v;
}

function serveStatic(req, res, route, query) {
    const file = route === '/' ? 'index.html' : route.slice(1);
    const full = path.normalize(path.join(ROOT, file));
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, 'introuvable', 'text/plain');
    const nosniff = { 'X-Content-Type-Options': 'nosniff' };
    if (file === 'index.html') {
        const v = uiVersion();
        const html = fs.readFileSync(full, 'utf8')
            .replace('href="style.css"', `href="style.css?v=${v}"`)
            .replace('src="dist/app.js"', `src="dist/app.js?v=${v}"`);
        res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store, max-age=0', ...nosniff });
        return res.end(html);
    }
    // fichier versionne : gardable pour toujours (l'adresse change a chaque version)
    // sinon : on revalide a chaque fois
    const versioned = query.has('v') || file.startsWith('dist/fonts/');
    res.writeHead(200, {
        'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
        'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
        ...nosniff,
    });
    fs.createReadStream(full).pipe(res);
}

async function start(discordClient) {
    const a = config.activity;
    if (!a.enabled) return null;
    if (!a.clientSecret && !a.dev) {
        log.warn('[activity] DISCORD_CLIENT_SECRET manquant : Plinko desactive (voir README)');
        return null;
    }
    if (!fs.existsSync(path.join(ROOT, 'dist', 'app.js'))) {
        log.warn('[activity] activity/dist/app.js absent : lance "npm run build" (fait automatiquement par Docker)');
    }
    client = discordClient;
    crash.init({ broadcast, alive: (room) => (rooms.get(room)?.size || 0) > 0 });
    feed.init({ broadcastAll }, discordClient);
    games.initDuels(sendTo);
    skins.migrateV2().catch((e) => log.error('[skins] migration', e));

    const server = http.createServer(async (req, res) => {
        // Discord peut prefixer les requetes par /.proxy selon les versions : on accepte les deux
        const url = new URL(req.url, 'http://x');
        const route = url.pathname.replace(/^\/\.proxy/, '') || '/';
        try {
            if (route.startsWith('/api/')) return await api(req, res, route);
            if (route.startsWith('/avatar/')) return await serveAvatar(res, route);
            if (route.startsWith('/pimg/')) return await serveProfileImage(res, route);
            if (route === '/gifp') return await serveGif(res, url.searchParams.get('u'));
            return serveStatic(req, res, route, url.searchParams);
        } catch (e) {
            log.error('[activity]', e);
            return send(res, 500, { error: 'erreur serveur' });
        }
    });

    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://x');
        if (url.pathname.replace(/^\/\.proxy/, '') !== '/ws') return socket.destroy();
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, url));
    });
    wss.on('connection', (ws, url) => {
        const s = sessions.get(url.searchParams.get('session') || '');
        const room = String(url.searchParams.get('room') || 'lobby').slice(0, 64);
        if (!s) return ws.close(4001, 'session');
        ws.player = { id: s.id, name: s.name, avatar: s.avatar, color: colorFor(room, s.id), rows: 12, risk: 'medium' };
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(ws);
        const reply = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
        reply({ type: 'hello', color: ws.player.color });
        broadcast(room, { type: 'players', players: players(room) });
        reply({ type: 'feed:init', entries: feed.snapshot() });
        life.assignHouse(s.id).catch(() => {});
        skins.equipped(s.id).then((eq) => {
            ws.player.skins = eq;
            broadcast(room, { type: 'players', players: players(room) });
        }).catch(() => {});

        ws.on('message', (raw) => {
            let m;
            try { m = JSON.parse(String(raw)); } catch { return; }
            if (!m || typeof m !== 'object') return;
            if (s.exp < Date.now()) return reply({ type: 'err', id: m.id, error: 'Session expirée, relance l\'activité.', fatal: true });

            // reglages visibles par les autres (pour leur tribune)
            if (m.type === 'cfg') {
                const c = plinko.check({ bet: plinko.MIN_BET, risk: m.risk, rows: m.rows });
                if (c.error) return;
                ws.player.rows = c.rows;
                ws.player.risk = c.risk;
                return broadcast(room, { type: 'cfg', id: s.id, rows: c.rows, risk: c.risk }, ws);
            }

            // ---- actions de l'app (jeux, work, carte, profils...) ----
            if (m.type === 'req' && typeof m.op === 'string') {
                return handleReq(ws, room, s, m.op, m.args || {})
                    .then((r) => reply({ ...(r || {}), type: 'res', rid: m.id }))
                    .catch((e) => {
                        log.error(`[app] ${m.op}`, e);
                        reply({ type: 'res', rid: m.id, error: 'Erreur serveur, réessaie.' });
                    });
            }

            // ---- crash ----
            if (m.type === 'crash:join') return reply(crash.join(room));
            if (m.type === 'crash:bet' || m.type === 'crash:cancel' || m.type === 'crash:cash') {
                const run = m.type === 'crash:bet'
                    ? crash.bet(room, { ...ws.player }, m, reply)
                    : m.type === 'crash:cancel' ? crash.cancel(room, s.id) : Promise.resolve(crash.cashout(room, s.id));
                return run.then((r) => reply({ type: 'crash:res', id: m.id, ...r }))
                    .catch((e) => { log.error('[crash]', e); reply({ type: 'crash:res', id: m.id, error: 'Erreur serveur.' }); });
            }

            if (m.type === 'drop') {
                const id = m.id;
                plinko.drop({ id: s.id, name: s.name, user: s.user, avatar: s.avatar, skins: ws.player.skins || null }, m, {
                    onBall: (b) => {
                        reply({ type: 'ball', id, path: b.path, bucket: b.bucket, mult: b.mult, payout: b.payout });
                        broadcastDrop(room, s, b, ws);
                    },
                    onNotices: (list) => reply({ type: 'notices', list }),
                }).then((out) => {
                    if (out.error) return reply({ type: 'err', id, error: out.error, soft: !!out.soft });
                    reply({ type: 'settled', id, received: out.received, net: out.net, balance: out.balance, cut: out.cut });
                });
            }
        });
        ws.on('close', () => {
            rooms.get(room)?.delete(ws);
            if (!rooms.get(room)?.size) rooms.delete(room);
            else broadcast(room, { type: 'players', players: players(room) });
        });
        ws.on('error', () => {});
    });
    // ping pour garder les connexions ouvertes a travers le proxy Discord / Cloudflare
    setInterval(() => wss.clients.forEach((ws) => ws.readyState === 1 && ws.ping()), 25_000).unref();
    setInterval(() => { for (const [k, s] of sessions) if (s.exp < Date.now()) sessions.delete(k); }, 3600_000).unref();

    try {
        await crash.resume();
    } catch (e) {
        log.error('[crash] reprise', e);
    }
    server.listen(a.port, () => log.info(`[activity] Plinko sur le port ${a.port}${a.dev ? ' (mode test ACTIVE)' : ''}`));
    return server;
}

module.exports = { start, sessions, rooms };
