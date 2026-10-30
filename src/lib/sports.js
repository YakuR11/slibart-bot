// Calendrier + cotes des gros matchs, et reglement des tickets.
// Foot : API-Football (calendrier, score, cotes bookmaker). Quota gratuit 100 req/jour,
// donc synchro espacee. LoL : API publique de lolesports (calendrier + score). Les cotes LoL
// sont calculees ici a partir du bilan du tournoi et du score des maps.
const db = require('../db');
const eco = require('./economy');
const config = require('../config');
const log = require('./logger');
const paris = require('./paris');
const announce = require('./announce');
const progress = require('./progress');
const { EmbedBuilder } = require('discord.js');
const { fmt } = require('./utils');

const FOOT = 'https://v3.football.api-sports.io';
const LOL = 'https://esports-api.lolesports.com/persisted/gw';
// Cle publique embarquee dans lolesports.com. Ce n'est pas un secret perso.
const LOL_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';

const LEAGUES = [
    { id: 61, name: 'Ligue 1' },
    { id: 39, name: 'Premier League' },
    { id: 140, name: 'La Liga' },
    { id: 135, name: 'Serie A' },
    { id: 78, name: 'Bundesliga' },
    { id: 2, name: 'Ligue des champions' },
    { id: 3, name: 'Europa League' },
];
const LEAGUE_IDS = new Set(LEAGUES.map((l) => l.id));

const LOL_BASE = [
    { id: '98767975604431411', name: 'Worlds', slug: 'worlds' },
    { id: '98767991302996019', name: 'LEC', slug: 'lec' },
    { id: '98767991325878492', name: 'MSI', slug: 'msi' },
];
// Ligues ouvertes aux paris (en plus de LOL_BASE et de l'EWC detectee automatiquement)
const LOL_BET_SLUGS = new Set(['worlds', 'msi', 'lec', 'first_stand']);
// Ligues qui nourrissent le classement Elo (sinon les equipes LCK/LPL arrivent aux Worlds
// sans historique et toutes les cotes valent 50/50)
const LOL_RATING_SLUGS = new Set([
    'worlds', 'msi', 'first_stand', 'lec', 'lck', 'lpl', 'lcs', 'lta_north', 'lta_south', 'lta_cross',
    'lcp', 'pcs', 'vcs', 'cblol-brazil', 'cblol', 'ljl-japan', 'ljl', 'lla',
]);
// Elo de depart selon la region du premier match vu
const PRIOR = { lck: 1650, lpl: 1650, lec: 1540, lcs: 1480, lta_north: 1480, lta_south: 1420, lta_cross: 1450, lcp: 1460, pcs: 1450, vcs: 1440, cblol: 1410, 'cblol-brazil': 1410, ljl: 1400, 'ljl-japan': 1400, lla: 1400 };
const ELO_DEFAULT = 1450;
const ELO_K = { 1: 24, 3: 32, 5: 40 };

const MARGIN = 0.95;
const LOL_VIG = 1.06;
const MAX_STAKE = 100_000;
const MIN_STAKE = 10;
const BIG_WIN = 3000;

const FOOT_DONE = new Set(['FT', 'AET', 'PEN']);
const FOOT_LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const FOOT_VOID = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO', 'SUSP']);

// API-Football gratuit = 100 requetes/jour. Calendrier + cotes 3 fois par jour (~45 req),
// scores toutes les 20 min seulement quand un match est en cours (le reste du budget).
const FULL_MS = 8 * 3600 * 1000;
const FOOT_KEEP = 25; // on garde toujours ce nombre de requetes pour regler les paris
const LIVE_MS = 20 * 60 * 1000;
const LOL_MS = 10 * 60 * 1000;

let running = false;
let lolLeagueCache = { at: 0, list: LOL_BASE, rating: null };

function parisDay(offset) {
    const p = paris.now();
    return paris.now(paris.at(p.y, p.mo, p.d + offset, 12, 0)).day;
}

function shave(odd) {
    const n = Number(odd);
    if (!Number.isFinite(n) || n <= 1) return null;
    return Math.round(Math.max(1.05, n * MARGIN) * 100) / 100;
}

function lolPrice(prob) {
    const q = Math.min(0.96, Math.max(0.04, prob));
    const odd = 1 / (q * LOL_VIG);
    return Math.round(Math.min(15, Math.max(1.03, odd)) * 100) / 100;
}

/** proba qu'une equipe d'Elo ra gagne une map contre rb */
const eloMapProb = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

function seriesProb(p, a, b, bestOf) {
    const need = Math.ceil((bestOf || 1) / 2);
    const memo = new Map();
    const rec = (x, y) => {
        if (x >= need) return 1;
        if (y >= need) return 0;
        const k = `${x},${y}`;
        if (memo.has(k)) return memo.get(k);
        const v = p * rec(x + 1, y) + (1 - p) * rec(x, y + 1);
        memo.set(k, v);
        return v;
    };
    return rec(a || 0, b || 0);
}

async function footGet(path) {
    if (!config.sportsApiKey) throw new Error('SPORTS_API_KEY manquante');
    const res = await fetch(`${FOOT}${path}`, { headers: { 'x-apisports-key': config.sportsApiKey } });
    const body = await res.json();
    const left = res.headers.get('x-ratelimit-requests-remaining');
    if (left !== null) await db.setSetting('foot_quota_left', Number(left));
    const err = body?.errors;
    const hasErr = err && (typeof err === 'string' || (typeof err === 'object' && Object.keys(err).length));
    if (hasErr) throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
    return body;
}

async function lolGet(path) {
    const res = await fetch(`${LOL}${path}`, { headers: { 'x-api-key': LOL_KEY } });
    if (!res.ok) throw new Error(`lol ${res.status} ${path}`);
    return res.json();
}

function footStatus(short) {
    if (FOOT_DONE.has(short)) return 'finished';
    if (FOOT_LIVE.has(short)) return 'live';
    if (FOOT_VOID.has(short)) return 'cancelled';
    return 'upcoming';
}

function extract1x2(bookmakers) {
    for (const b of bookmakers || []) {
        for (const bet of b.bets || []) {
            const name = String(bet.name || '').toLowerCase();
            if (bet.id !== 1 && !name.includes('match winner') && !name.includes('1x2')) continue;
            const map = {};
            for (const v of bet.values || []) {
                const key = String(v.value || '').toLowerCase();
                if (key === 'home') map.home = v.odd;
                else if (key === 'draw') map.draw = v.odd;
                else if (key === 'away') map.away = v.odd;
            }
            if (map.home && map.away) return map;
        }
    }
    return null;
}

async function saveMatch(row) {
    await db.exec(
        `INSERT INTO sport_matches
            (source, ext_id, competition, home, away, start_at, status, home_score, away_score, odd_home, odd_draw, odd_away, detail, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            competition = VALUES(competition),
            home = VALUES(home),
            away = VALUES(away),
            start_at = VALUES(start_at),
            status = VALUES(status),
            home_score = VALUES(home_score),
            away_score = VALUES(away_score),
            odd_home = COALESCE(VALUES(odd_home), odd_home),
            odd_draw = COALESCE(VALUES(odd_draw), odd_draw),
            odd_away = COALESCE(VALUES(odd_away), odd_away),
            detail = COALESCE(VALUES(detail), detail),
            updated_at = VALUES(updated_at)`,
        [
            row.source, String(row.extId), row.competition.slice(0, 80), row.home.slice(0, 80), row.away.slice(0, 80),
            row.startAt, row.status, row.homeScore, row.awayScore, row.oddHome, row.oddDraw, row.oddAway,
            row.detail ? String(row.detail).slice(0, 120) : null, Date.now(),
        ],
    );
}

function fixtureRow(fx, odds) {
    const short = fx.fixture?.status?.short || 'NS';
    const pen = fx.score?.penalty;
    let detail = null;
    if (short === 'PEN' && pen && pen.home != null) detail = `TAB ${pen.home}-${pen.away}`;
    else if (short === 'AET') detail = 'prolongations';
    return {
        source: 'foot',
        extId: fx.fixture.id,
        competition: fx.league?.name || 'Foot',
        home: fx.teams?.home?.name || 'Domicile',
        away: fx.teams?.away?.name || 'Extérieur',
        startAt: new Date(fx.fixture.date).getTime(),
        status: footStatus(short),
        homeScore: fx.goals?.home ?? null,
        awayScore: fx.goals?.away ?? null,
        oddHome: odds ? shave(odds.home) : null,
        oddDraw: odds ? shave(odds.draw) : null,
        oddAway: odds ? shave(odds.away) : null,
        detail,
    };
}

// Le plan gratuit d'API-Football ne donne que 3 dates (hier, aujourd'hui, demain)
// et refuse le parametre season sur la saison en cours. On filtre les grosses ligues
// nous-memes, puis une cote par match a venir.
async function syncFootFull() {
    const fixtures = [];
    for (const offset of [-1, 0, 1]) {
        try {
            const body = await footGet(`/fixtures?date=${parisDay(offset)}&timezone=Europe/Paris`);
            for (const fx of body.response || []) {
                if (LEAGUE_IDS.has(fx.league?.id)) fixtures.push(fx);
            }
        } catch (e) {
            log.warn(`[sport] fixtures ${parisDay(offset)} : ${e.message}`);
        }
    }
    for (const fx of fixtures) await saveMatch(fixtureRow(fx, null));
    const upcoming = fixtures
        .filter((fx) => footStatus(fx.fixture?.status?.short) === 'upcoming')
        .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
        .slice(0, 12);
    let oddsN = 0;
    for (const fx of upcoming) {
        // on ne grille pas les dernieres requetes du jour sur des cotes : elles servent aux resultats
        if (Number(await db.getSetting('foot_quota_left', '100')) <= FOOT_KEEP) break;
        try {
            const body = await footGet(`/odds?fixture=${fx.fixture.id}&bet=1`);
            const odd = extract1x2(body.response?.[0]?.bookmakers);
            if (!odd) continue;
            await saveMatch(fixtureRow(fx, odd));
            oddsN++;
        } catch (e) {
            log.warn(`[sport] cote ${fx.fixture?.id} : ${e.message}`);
            if (/rate|request/i.test(e.message)) break;
        }
    }
    await db.setSetting('sports_foot_full', Date.now());
    log.info(`[sport] foot : ${fixtures.length} matchs, ${oddsN} cotes · quota restant ${await db.getSetting('foot_quota_left', '?')}`);
}

async function syncFootLive() {
    const due = await db.q(
        `SELECT ext_id FROM sport_matches
         WHERE source = 'foot' AND status IN ('upcoming', 'live') AND start_at <= ?`,
        [Date.now() + 15 * 60 * 1000],
    );
    const ids = due.map((r) => r.ext_id).filter(Boolean);
    if (!ids.length) {
        await db.setSetting('sports_foot_live', Date.now());
        return;
    }
    const rows = [];
    for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20);
        if (!chunk.length) break;
        try {
            const body = await footGet(`/fixtures?ids=${chunk.join('-')}`);
            rows.push(...(body.response || []));
        } catch (e) {
            log.warn(`[sport] scores : ${e.message}`);
        }
    }
    const seen = new Set();
    for (const fx of rows) {
        if (!fx.fixture?.id || seen.has(fx.fixture.id)) continue;
        seen.add(fx.fixture.id);
        await saveMatch(fixtureRow(fx, null));
    }
    await db.setSetting('sports_foot_live', Date.now());
}

// ---------------------------------------------------------------------------
// LoL : classement Elo
// ---------------------------------------------------------------------------
async function lolLeagues() {
    if (Date.now() - lolLeagueCache.at < 6 * 3600 * 1000 && lolLeagueCache.rating) return lolLeagueCache;
    try {
        const body = await lolGet('/getLeagues?hl=fr-FR');
        const all = body?.data?.leagues || [];
        const isEwc = (l) => /ewc|world cup|esports world/i.test(`${l.slug || ''} ${l.name || ''}`);
        const bet = new Map(LOL_BASE.map((l) => [l.id, l]));
        for (const l of all) {
            if (LOL_BET_SLUGS.has(l.slug) || isEwc(l)) bet.set(String(l.id), { id: String(l.id), name: l.name, slug: l.slug });
        }
        const rating = all
            .filter((l) => LOL_RATING_SLUGS.has(l.slug) || isEwc(l) || bet.has(String(l.id)))
            .map((l) => ({ id: String(l.id), name: l.name, slug: l.slug }));
        lolLeagueCache = { at: Date.now(), list: [...bet.values()], rating };
    } catch (e) {
        log.warn(`[sport] ligues lol : ${e.message}`);
        if (!lolLeagueCache.rating) lolLeagueCache = { at: 0, list: LOL_BASE, rating: LOL_BASE };
    }
    return lolLeagueCache;
}

async function rating(team, code, slug) {
    const [r] = await db.q('SELECT rating FROM lol_elo WHERE team = ?', [team]);
    if (r) return Number(r.rating);
    const init = PRIOR[slug] ?? ELO_DEFAULT;
    await db.exec('INSERT IGNORE INTO lol_elo (team, code, rating, games) VALUES (?, ?, ?, 0)', [team, code || null, init]);
    return init;
}

/** applique un resultat termine au classement (une seule fois par match) */
async function applyElo(ev, slug) {
    const [a, b] = ev.match.teams;
    const aWin = a.result?.outcome === 'win';
    const bWin = b.result?.outcome === 'win';
    if (!aWin && !bWin) return false;
    const seen = await db.exec('INSERT IGNORE INTO lol_elo_seen (match_id, at) VALUES (?, ?)', [String(ev.match.id), Date.now()]);
    if (!seen.affectedRows) return false;
    const bo = ev.match.strategy?.count || 1;
    const ra = await rating(a.name, a.code, slug);
    const rb = await rating(b.name, b.code, slug);
    const expected = seriesProb(eloMapProb(ra, rb), 0, 0, bo);
    const d = (ELO_K[bo] || 32) * ((aWin ? 1 : 0) - expected);
    await db.exec('UPDATE lol_elo SET rating = rating + ?, games = games + 1, code = COALESCE(code, ?) WHERE team = ?', [d, a.code || null, a.name]);
    await db.exec('UPDATE lol_elo SET rating = rating - ?, games = games + 1, code = COALESCE(code, ?) WHERE team = ?', [d, b.code || null, b.name]);
    return true;
}

const validMatch = (ev) => ev?.type === 'match' && ev.match?.teams?.length === 2
    && ev.match.teams.every((t) => t?.name && !/tbd/i.test(t.name) && t.code !== 'TBD');

function rankedTeams(body) {
    let best = [];
    const stages = body?.data?.standings?.[0]?.stages || [];
    for (const stage of stages) {
        for (const sec of stage.sections || []) {
            const rows = [];
            for (const row of sec.rankings || []) {
                for (const team of row.teams || []) {
                    if (team?.name) rows.push({ name: team.name, code: team.code || null, rank: Number(row.ordinal) || rows.length + 1 });
                }
            }
            if (rows.length > best.length) best = rows;
        }
    }
    return best;
}

/**
 * Une fois : le classement public du tournoi en cours (ou du dernier termine)
 * ecarte les equipes. Ensuite seuls les resultats bougent l'Elo.
 * On ne touche pas a une equipe qui a deja 5 matchs : son historique compte plus qu'un seed.
 */
function newestFirst(tourneys) {
    return [...tourneys].sort((a, b) => String(b.startDate || b.endDate || '').localeCompare(String(a.startDate || a.endDate || '')));
}

async function seedFromStandings(leagues) {
    for (const lg of leagues) {
        const flag = `lol_elo_seed:${lg.slug || lg.id}`;
        if ((await db.getSetting(flag)) === 'v1') continue;
        let tourneys = [];
        try {
            const body = await lolGet(`/getTournamentsForLeague?hl=en-US&leagueId=${lg.id}`);
            tourneys = newestFirst(body?.data?.leagues?.[0]?.tournaments || []);
        } catch (e) {
            log.warn(`[sport] tournois ${lg.name} : ${e.message}`);
            continue;
        }
        let teams = [];
        let failed = false;
        for (const t of tourneys) {
            try {
                const body = await lolGet(`/getStandings?hl=en-US&tournamentId=${t.id}`);
                teams = rankedTeams(body);
            } catch (e) {
                log.warn(`[sport] classement ${lg.name} : ${e.message}`);
                failed = true;
                continue;
            }
            if (teams.length >= 4) break;
        }
        if (teams.length < 4) {
            if (!failed) log.info(`[sport] seed Elo ${lg.name} : pas encore de classement, on reessaiera`);
            continue;
        }
        const prior = PRIOR[lg.slug] ?? ELO_DEFAULT;
        const n = teams.length;
        let seeded = 0;
        for (const team of teams) {
            const spread = (Math.max(1, team.rank) - 1) / Math.max(1, n - 1);
            const elo = Math.round(prior + 180 * (1 - 2 * spread));
            const [existing] = await db.q('SELECT games FROM lol_elo WHERE team = ?', [team.name]);
            if (!existing) {
                await db.exec('INSERT INTO lol_elo (team, code, rating, games) VALUES (?, ?, ?, 0)', [team.name, team.code, elo]);
                seeded++;
            } else if (Number(existing.games) < 5) {
                await db.exec('UPDATE lol_elo SET rating = ?, code = COALESCE(code, ?) WHERE team = ?', [elo, team.code, team.name]);
                seeded++;
            }
        }
        if (!failed) await db.setSetting(flag, 'v1');
        else log.warn(`[sport] seed Elo ${lg.name} incomplet, on reessaiera`);
        log.info(`[sport] seed Elo ${lg.name} : ${teams.length} equipes, ${seeded} ecrites`);
    }
}

/** Premier demarrage : on rejoue l'historique de toutes les grosses ligues dans l'ordre */
async function bootstrapElo(leagues) {
    if ((await db.getSetting('lol_elo_boot')) === 'v1') return;
    log.info('[sport] construction du classement Elo LoL sur l\'historique...');
    const done = [];
    for (const lg of leagues) {
        let token = null;
        for (let page = 0; page < 8; page++) {
            let body;
            try {
                body = await lolGet(`/getSchedule?hl=fr-FR&leagueId=${lg.id}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
            } catch (e) {
                log.warn(`[sport] historique ${lg.name} : ${e.message}`);
                break;
            }
            const sch = body?.data?.schedule;
            for (const ev of sch?.events || []) if (ev.state === 'completed' && validMatch(ev)) done.push({ ev, slug: lg.slug });
            token = sch?.pages?.older;
            if (!token) break;
        }
    }
    done.sort((x, y) => new Date(x.ev.startTime) - new Date(y.ev.startTime));
    let n = 0;
    for (const { ev, slug } of done) if (await applyElo(ev, slug)) n++;
    await db.setSetting('lol_elo_boot', 'v1');
    log.info(`[sport] Elo LoL construit sur ${n} matchs`);
}

async function syncLol() {
    const { list, rating: ratingLeagues } = await lolLeagues();
    await seedFromStandings(ratingLeagues);
    await bootstrapElo(ratingLeagues);
    const betIds = new Set(list.map((l) => String(l.id)));

    // 1) resultats recents de toutes les ligues -> Elo a jour avant de calculer les cotes
    const toSave = [];
    for (const league of ratingLeagues) {
        let body;
        try {
            body = await lolGet(`/getSchedule?hl=fr-FR&leagueId=${league.id}`);
        } catch (e) {
            log.warn(`[sport] ${league.name} : ${e.message}`);
            continue;
        }
        const events = (body?.data?.schedule?.events || []).filter(validMatch)
            .sort((x, y) => new Date(x.startTime) - new Date(y.startTime));
        for (const ev of events) {
            if (ev.state === 'completed') await applyElo(ev, league.slug);
            if (betIds.has(String(league.id))) toSave.push({ ev, league });
        }
    }

    // 2) matchs des ligues ouvertes aux paris, cotes calculees depuis l'Elo
    let n = 0;
    for (const { ev, league } of toSave) {
        const [a, b] = ev.match.teams;
        const startAt = new Date(ev.startTime).getTime();
        if (!Number.isFinite(startAt)) continue;
        if (startAt < Date.now() - 36 * 3600 * 1000 || startAt > Date.now() + 14 * 24 * 3600 * 1000) continue;
        const bo = ev.match.strategy?.count || 1;
        let hs = Number(a.result?.gameWins) || 0;
        let as = Number(b.result?.gameWins) || 0;
        let status = ev.state === 'completed' ? 'finished' : ev.state === 'inProgress' ? 'live' : 'upcoming';
        const aWin = a.result?.outcome === 'win';
        const bWin = b.result?.outcome === 'win';
        if (status === 'finished' && !aWin && !bWin) status = 'live';
        if (status === 'finished' && hs === as) {
            if (aWin) hs = 1;
            else if (bWin) as = 1;
        }
        // cotes figees des que le match commence (sinon on pourrait parier en regardant le stream)
        let oddHome = null;
        let oddAway = null;
        if (status === 'upcoming') {
            const ra = await rating(a.name, a.code, league.slug);
            const rb = await rating(b.name, b.code, league.slug);
            const p = seriesProb(eloMapProb(ra, rb), 0, 0, bo);
            oddHome = lolPrice(p);
            oddAway = lolPrice(1 - p);
        }
        const live = status === 'live' ? ` · ${hs}-${as}` : '';
        await saveMatch({
            source: 'lol',
            extId: ev.match.id,
            competition: ev.league?.name || league.name,
            home: a.name,
            away: b.name,
            startAt,
            status,
            homeScore: status === 'upcoming' ? null : hs,
            awayScore: status === 'upcoming' ? null : as,
            oddHome,
            oddDraw: null,
            oddAway,
            detail: `Bo${bo}${live}`,
        });
        n++;
    }
    await db.setSetting('sports_lol', Date.now());
    log.info(`[sport] lol : ${n} matchs, Elo sur ${ratingLeagues.length} ligues`);
}

/** classement Elo (commande =elo) */
async function lolRanking(limit = 20) {
    return db.q('SELECT team, code, rating, games FROM lol_elo WHERE games >= 3 ORDER BY rating DESC LIMIT ?', [limit]);
}

function winningPick(m) {
    if (m.status === 'cancelled') return 'void';
    if (m.status !== 'finished') return null;
    const h = m.home_score == null ? null : Number(m.home_score);
    const a = m.away_score == null ? null : Number(m.away_score);
    if (h == null || a == null) return null;
    if (m.source === 'lol' && h === a) return 'void';
    if (h > a) return '1';
    if (h < a) return '2';
    return 'N';
}

async function settleOpen(client) {
    const rows = await db.q(
        `SELECT b.id, b.id_user, b.pick, b.stake, b.odds, b.match_id,
                m.status, m.home_score, m.away_score, m.home, m.away, m.competition, m.source
         FROM sport_bets b JOIN sport_matches m ON m.id = b.match_id
         WHERE b.status = 'open' AND m.status IN ('finished', 'cancelled')`,
    );
    const paid = new Map();
    for (const bet of rows) {
        const result = winningPick(bet);
        if (!result) continue;
        const stake = Number(bet.stake);
        const odds = Number(bet.odds);
        const won = result !== 'void' && result === bet.pick;
        const payout = result === 'void' ? stake : won ? Math.floor(stake * odds) : 0;
        const done = await db.tx(async (conn) => {
            const [cur] = await conn.query('SELECT status FROM sport_bets WHERE id = ? FOR UPDATE', [bet.id]);
            if (cur[0]?.status !== 'open') return null;
            const pay = payout > 0 ? await eco.addRb(bet.id_user, payout, conn) : { net: 0, cut: 0, debt: 0 };
            const net = result === 'void' ? pay.net : pay.net - stake;
            if (result === 'void') {
                await conn.query('UPDATE sport_bets SET status = ?, payout = ? WHERE id = ?', ['void', pay.net, bet.id]);
                return { void: true, net, cut: pay.cut };
            }
            if (net > 0) {
                await eco.bump(bet.id_user, { gamblecount: 1, wincount: net }, conn);
                await conn.query('UPDATE profile SET maxwin = GREATEST(maxwin, ?) WHERE id_user = ?', [net, String(bet.id_user)]);
            } else if (payout <= 0) {
                await eco.bump(bet.id_user, { gamblecount: 1, pertecount: stake }, conn);
                await eco.toCasino(stake, conn);
            } else {
                await eco.bump(bet.id_user, { gamblecount: 1, pertecount: Math.max(0, -net) }, conn);
            }
            await conn.query('UPDATE sport_bets SET status = ?, payout = ? WHERE id = ?', [won ? 'won' : 'lost', pay.net, bet.id]);
            await conn.query(
                'INSERT INTO weekly (week, id_user, net, games) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE net = net + VALUES(net), games = games + 1',
                [paris.weekKey(), String(bet.id_user), net],
            );
            return { void: false, net, cut: pay.cut };
        });
        if (!done || done.void) {
            if (done?.void) {
                const user = client ? await client.users.fetch(String(bet.id_user)).catch(() => null) : null;
                const bite = done.cut ? ` La banque en garde **${fmt(done.cut)}**.` : '';
                await user?.send(`🎟️ Match annulé (${bet.home} - ${bet.away}). **${fmt(done.net)}** ${config.rbEmoji} rendus.${bite}`).catch(() => {});
            }
            continue;
        }
        const net = done.net;
        await progress.streak(bet.id_user, won);
        const bucket = paid.get(bet.match_id) || { match: bet, lines: [], pot: 0 };
        bucket.pot += won ? net : 0;
        bucket.lines.push({ userId: String(bet.id_user), won, net, stake });
        paid.set(bet.match_id, bucket);
        if (won && net >= BIG_WIN && client) {
            const user = await client.users.fetch(String(bet.id_user)).catch(() => null);
            if (user) {
                await announce.send({
                    embeds: [new EmbedBuilder()
                        .setColor('#f1c40f')
                        .setDescription(`🚨 **${user.username}** encaisse **${fmt(net)}** ${config.rbEmoji} sur **${bet.home} - ${bet.away}** !`)],
                });
            }
        }
    }
    if (!paid.size) return;
    const blocks = [];
    for (const { match, lines } of paid.values()) {
        const score = `${match.home_score ?? '?'}-${match.away_score ?? '?'}`;
        const who = lines.map((l) => `<@${l.userId}> ${l.net >= 0 ? `+${fmt(l.net)}` : `-${fmt(-l.net)}`}`).join(' · ');
        blocks.push(`**${match.home} ${score} ${match.away}**\n${who}`);
    }
    await announce.send({
        embeds: [new EmbedBuilder()
            .setColor('#5865f2')
            .setTitle('🎟️ Paris réglés')
            .setDescription(blocks.join('\n\n').slice(0, 4000))],
    });
}

async function due(key, every) {
    const last = Number(await db.getSetting(key, '0'));
    return Date.now() - last >= every;
}

async function tick(client) {
    if (running) return;
    running = true;
    try {
        if (await due('sports_lol', LOL_MS)) await syncLol();
        if (config.sportsApiKey && await due('sports_foot_full', FULL_MS)) await syncFootFull();
        else if (config.sportsApiKey && await due('sports_foot_live', LIVE_MS)) await syncFootLive();
        await settleOpen(client);
    } catch (e) {
        log.warn('[sport]', e.message);
    } finally {
        running = false;
    }
}

function oddOf(match, pick) {
    if (pick === '1') return Number(match.odd_home) || 0;
    if (pick === 'N') return Number(match.odd_draw) || 0;
    if (pick === '2') return Number(match.odd_away) || 0;
    return 0;
}

function betsOpen(match) {
    if (match.status === 'finished' || match.status === 'cancelled') return false;
    // foot et LoL : on ferme au coup d'envoi. En LoL les cotes ne suivent pas l'etat de la partie
    // en cours, donc parier en direct en regardant le stream serait gratuit.
    return match.status === 'upcoming' && Number(match.start_at) > Date.now();
}

module.exports = { tick, oddOf, betsOpen, MAX_STAKE, MIN_STAKE, shave, lolPrice, seriesProb, eloMapProb, lolRanking, syncLol, applyElo };
