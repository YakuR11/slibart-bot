// Paris sportifs dans l'app : meme ticket que =parier (cote figee, une mise par match).
const db = require('../db');
const eco = require('../lib/economy');
const sports = require('../lib/sports');
const { placeTicket, failText } = require('../commands/sports');

const plain = (s) => String(s || '').replace(/\*\*/g, '');

async function list(userId) {
    const rows = await db.q(
        `SELECT * FROM sport_matches
         WHERE status IN ('upcoming', 'live') AND start_at > ?
         ORDER BY status = 'live' DESC, start_at ASC
         LIMIT 20`,
        [Date.now() - 8 * 3600 * 1000],
    );
    const mine = await db.q(
        `SELECT b.match_id, b.pick, b.stake, b.odds, b.status, m.home, m.away
         FROM sport_bets b JOIN sport_matches m ON m.id = b.match_id
         WHERE b.id_user = ?
         ORDER BY b.created_at DESC
         LIMIT 8`,
        [String(userId)],
    );
    return {
        matches: rows.map((m) => ({
            id: m.id,
            source: m.source,
            competition: m.competition,
            home: m.home,
            away: m.away,
            startAt: Number(m.start_at),
            status: m.status,
            detail: m.detail,
            odds: { 1: Number(m.odd_home) || 0, N: Number(m.odd_draw) || 0, 2: Number(m.odd_away) || 0 },
            open: sports.betsOpen(m) && (Number(m.odd_home) > 1 || Number(m.odd_away) > 1),
        })),
        mine: mine.map((r) => ({
            matchId: r.match_id,
            pick: r.pick,
            stake: Number(r.stake),
            odds: Number(r.odds),
            status: r.status,
            home: r.home,
            away: r.away,
        })),
        min: sports.MIN_STAKE,
        max: sports.MAX_STAKE,
    };
}

async function bet(userId, { matchId, pick, amount }) {
    const result = await placeTicket(String(userId), Number(matchId), pick, amount);
    if (result.error) return { error: plain(failText(result.error, result.bal)) };
    const side = pick === '1' ? result.match.home : pick === '2' ? result.match.away : 'Nul';
    return {
        ok: true,
        odds: result.odds,
        stake: result.stake,
        win: Math.floor(result.stake * result.odds),
        side,
        capped: !!result.capped,
        balance: await eco.balance(userId),
    };
}

module.exports = { list, bet };
