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

const ROOT = path.join(__dirname, '..', '..', 'activity');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
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
    for (const ws of rooms.get(room) || []) if (ws.player?.id === s.id) color = ws.player.color;
    broadcast(room, {
        type: 'drop',
        player: { id: s.id, name: s.name, avatar: s.avatar, color },
        rows: b.rows, risk: b.risk, path: b.path, mult: b.mult, bet: b.bet, net: b.payout - b.bet,
    }, except);
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
async function api(req, res, route) {
    if (route === '/api/config' && req.method === 'GET') {
        return send(res, 200, { clientId: config.activity.clientId, dev: config.activity.dev, rb: 'RB', tables: plinko.TABLES, minBet: plinko.MIN_BET, maxBet: plinko.MAX_BET });
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
        const out = await plinko.drop({ id: s.id, name: s.name, user: s.user }, body, {
            onBall: (b) => room && broadcastDrop(room, s, b),
        });
        if (out.error) return send(res, out.soft ? 429 : 400, out);
        return send(res, 200, out);
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

function serveStatic(req, res, route) {
    const file = route === '/' ? 'index.html' : route.slice(1);
    const full = path.normalize(path.join(ROOT, file));
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, 'introuvable', 'text/plain');
    res.writeHead(200, {
        'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
        'Cache-Control': file === 'index.html' ? 'no-cache' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(full).pipe(res);
}

function start(discordClient) {
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

    const server = http.createServer(async (req, res) => {
        // Discord peut prefixer les requetes par /.proxy selon les versions : on accepte les deux
        const url = new URL(req.url, 'http://x');
        const route = url.pathname.replace(/^\/\.proxy/, '') || '/';
        try {
            if (route.startsWith('/api/')) return await api(req, res, route);
            if (route.startsWith('/avatar/')) return await serveAvatar(res, route);
            return serveStatic(req, res, route);
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

            if (m.type === 'drop') {
                const id = m.id;
                plinko.drop({ id: s.id, name: s.name, user: s.user }, m, {
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

    server.listen(a.port, () => log.info(`[activity] Plinko sur le port ${a.port}${a.dev ? ' (mode test ACTIVE)' : ''}`));
    return server;
}

module.exports = { start, sessions, rooms };
