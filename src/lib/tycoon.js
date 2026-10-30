// Tableau de bord du tycoon (page Empire de l'app) : tout est lu ici, rien n'est paye ici.
// Les revenus sont affiches "par =work" (30 min), pas par heure : le work se lance a la main,
// seul le contremaitre (rare) le ramasse tout seul.
const db = require('../db');
const config = require('../config');
const cd = require('./cooldowns');
const inv = require('./inventory');
const wages = require('./wages');
const upkeep = require('./upkeep');
const boost = require('./boost');
const shop = require('./shop');
const prestige = require('./prestige');
const progress = require('./progress');

const DAILY_CD = 20 * 3600 * 1000;
/** les libelles de quete sont ecrits pour Discord : on enleve le markdown et les emojis perso */
const plain = (s) => String(s)
    .replace(/<a?:rokbux:\d+>/gi, 'RB')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const MINE_EV = 5.69; // esperance d'un =mine (roknit, diamant, or, pierre)

async function slotState(id, kind, potNow) {
    const seen = await wages.peek(id, kind);
    if (!seen) return { ready: true, left: potNow, next: 0 };
    return seen.left > 0 ? { ready: true, left: seen.left, next: 0 } : { ready: false, left: 0, next: seen.slotEnd };
}

async function state(userId) {
    const id = String(userId);
    const p = await db.getProfile(id);
    const [server, hm, caveLeft, mineLeft, locks, questsRaw] = await Promise.all([
        shop.serverSlaves(),
        boost.mult(),
        cd.remaining(id, 'cave'),
        cd.remaining(id, 'mine'),
        inv.list(id).then((l) => l.cadenas || 0),
        progress.ensureQuests(id),
    ]);
    const ps = prestige.status(p);
    const pm = ps.mult;
    const room = p.cavecount * shop.SLAVES_PER_CAVE - p.slavecount;
    const work = wages.workAmount(p.slavecount, { foreman: p.foreman, mult: pm });
    const gwAvg = Math.round(wages.GW_AVG * pm);
    const [workSlot, gwSlot] = await Promise.all([
        slotState(id, 'work', work * hm),
        slotState(id, 'gw', gwAvg * hm),
    ]);
    const dailyAt = p.daily_last ? p.daily_last + DAILY_CD : 0;
    const quests = questsRaw.filter((q) => q.qtype !== '_bonus').map((q) => ({
        label: plain(progress.QUESTS[q.qtype]?.label(q.target) || q.qtype),
        progress: Number(q.progress),
        target: Number(q.target),
        reward: Number(q.reward),
        done: Number(q.done) === 1,
    }));
    const bonusDone = questsRaw.some((q) => q.qtype === '_bonus');
    const fo = wages.foremanOffer(p.slavecount);

    return {
        rb: p.rb,
        debt: p.debt,
        slaves: p.slavecount,
        caves: p.cavecount,
        room,
        foreman: !!p.foreman,
        happy: hm > 1,
        prestige: ps,
        income: {
            work,
            gw: gwAvg,
            mine: Math.round(MINE_EV * pm * 10) / 10,
            perSlave: Math.round((wages.WORK_PER_SLAVE + (p.foreman ? wages.FOREMAN_EXTRA : 0)) * pm),
            upkeep: upkeep.due(p.rb, p.cavecount),
            caveFee: upkeep.caveFee(p.cavecount),
            tax: upkeep.wealthTax(p.rb),
            taxFloor: upkeep.TAX_FLOOR,
        },
        items: {
            slave: { price: shop.slaveUnit(p.slavecount, server), price5: shop.slaveCost(p.slavecount, 5, server), room },
            cave: { price: shop.cavePrice(p.cavecount), cdUntil: caveLeft ? Date.now() + caveLeft : 0, places: shop.SLAVES_PER_CAVE },
            foreman: { price: wages.FOREMAN_PRICE, owned: !!p.foreman, before: fo.before, after: fo.after, hours: fo.hours },
            cadenas: { price: shop.LOCK_PRICE, have: locks, max: shop.LOCK_MAX },
        },
        tasks: {
            work: p.foreman ? { auto: true } : workSlot,
            gw: gwSlot,
            mine: { ready: !mineLeft, next: mineLeft ? Date.now() + mineLeft : 0 },
            daily: { ready: !dailyAt || dailyAt <= Date.now(), next: dailyAt, streak: p.daily_streak },
        },
        quests,
        questBonus: { done: bonusDone, reward: progress.QUEST_BONUS },
        prefix: config.prefix,
    };
}

async function buy(userId, item, qty) {
    if (item === 'slave') return shop.buySlaves(userId, qty ?? 1);
    if (item === 'cave') return shop.buyCave(userId);
    if (item === 'foreman') return shop.buyForeman(userId);
    if (item === 'cadenas') return shop.buyLocks(userId, qty ?? 1);
    return { err: 'item' };
}

/** top 5 et ton rang (hors banque du casino) */
async function top(userId, userInfo) {
    const casino = String(config.casinoId);
    const rows = await db.q('SELECT id_user, rb, prestige FROM profile WHERE id_user != ? ORDER BY rb DESC, id_user LIMIT 5', [casino]);
    const me = await db.getProfile(userId);
    const [{ n }] = await db.q('SELECT COUNT(*) AS n FROM profile WHERE id_user != ? AND rb > ?', [casino, me.rb]);
    const list = [];
    for (const r of rows) {
        const u = await userInfo(String(r.id_user));
        list.push({ id: String(r.id_user), name: u.name, avatar: u.avatar, rb: Number(r.rb), prestige: Number(r.prestige || 0) });
    }
    // la personne juste devant toi : sert a "X vient de te passer devant"
    const [up] = await db.q('SELECT id_user, rb FROM profile WHERE id_user != ? AND rb > ? ORDER BY rb ASC LIMIT 1', [casino, me.rb]);
    const above = up ? { id: String(up.id_user), name: (await userInfo(String(up.id_user))).name, rb: Number(up.rb) } : null;
    return { top: list, me: { rank: Number(n) + 1, rb: me.rb }, above };
}

module.exports = { state, buy, top };
