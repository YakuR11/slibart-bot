const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
const eco = require('../lib/economy');
const cd = require('../lib/cooldowns');
const { fmt, duration, pick, randInt, avatar, baseEmbed } = require('../lib/utils');
const progress = require('../lib/progress');
const boost = require('../lib/boost');
const inv = require('../lib/inventory');
const credit = require('../lib/credit');

const happyTag = (m) => (m > 1 ? ' · 🔥 **HAPPY HOUR x2**' : '');
const ui = require('../lib/ui');

const RB = () => config.rbEmoji;
const C = config.content;

// --- reglages du jeu (modifiables ici) ---
const WORK_BASE = 50;
const WORK_PER_SLAVE = 25;
const SLOT_MS = 30 * 60 * 1000; // =work et =gw : dispo a chaque demi-heure pile
const DAILY_BASE = 200;
const DAILY_STREAK_BONUS = 25; // par jour de streak
const DAILY_STREAK_MAX = 10;
const DAILY_CD = 20 * 3600 * 1000; // 20h : pas besoin d'etre pile a la meme heure chaque jour
const DAILY_BREAK = 48 * 3600 * 1000; // streak perdu apres 48h sans daily
// Prix exponentiels : chaque achat coute plus cher que le precedent, pas de limite.
// esclave n°1 = 90, n°11 = 364, n°21 = 1 473, n°31 = 5 959, n°41 = 24 108...
// cave n°1 = 300, n°3 = 867, n°5 = 2 506, n°8 = 12 310, n°10 = 35 576...
const SLAVE_BASE = 90;
const SLAVE_GROWTH = 1.15; // +15% par esclave que tu possedes deja
const SLAVE_INFLATION = 1; // +1 RB par esclave existant sur tout le serveur
const SLAVES_PER_CAVE = 5;
const CAVE_BASE = 300;
const CAVE_GROWTH = 1.7; // +70% par cave que tu possedes deja
const CAVE_CD = 90 * 60 * 1000;
const BULK_MAX = 50; // max d'esclaves achetes en une fois

const slaveUnit = (owned, server) => Math.round(SLAVE_BASE * SLAVE_GROWTH ** owned + SLAVE_INFLATION * server);
const cavePrice = (owned) => Math.round(CAVE_BASE * CAVE_GROWTH ** owned);
/** cout de qty esclaves quand on en a deja owned (chaque unite plus chere) */
function slaveCost(owned, qty, server) {
    let c = 0;
    for (let k = 0; k < qty; k++) c += slaveUnit(owned + k, server + k);
    return c;
}
const MINE_CD = 60 * 1000;
const LOCK_PRICE = 600;

const nextSlot = () => Math.ceil((Date.now() + 1) / SLOT_MS) * SLOT_MS;
const hhmm = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

const serverSlaves = async (conn = db.pool) => {
    const [[{ total }]] = await conn.query('SELECT COALESCE(SUM(slavecount), 0) AS total FROM profile');
    return Number(total);
};

async function shopEmbed(ctx) {
    const p = await db.getProfile(ctx.user.id);
    const server = await serverSlaves();
    const next = slaveUnit(p.slavecount, server);
    const next5 = slaveCost(p.slavecount, 5, server);
    const room = p.cavecount * SLAVES_PER_CAVE - p.slavecount;
    return baseEmbed(ctx, '#f7ffcc')
        .setTitle(`🛒 Shop · ${RB()}`)
        .setDescription(
            `Tu as **${p.slavecount}** esclave(s), **${p.cavecount}** cave(s) · **${fmt(p.rb)}** ${RB()}\n\n` +
            `🛠️ **Esclave** · \`${config.prefix}buy slave [nb|max]\`\n` +
            `> Prochain : **${fmt(next)}** ${RB()} · les 5 prochains : ${fmt(next5)}\n` +
            `> +${WORK_PER_SLAVE} ${RB()} par \`${config.prefix}work\` · +15% de prix à chaque esclave\n` +
            `> Place libre : **${Math.max(0, room)}** (${SLAVES_PER_CAVE} par cave)\n\n` +
            `🏠 **Cave** · \`${config.prefix}buy cave\`\n` +
            `> Prochaine : **${fmt(cavePrice(p.cavecount))}** ${RB()} · puis ${fmt(cavePrice(p.cavecount + 1))}, ${fmt(cavePrice(p.cavecount + 2))}...\n` +
            `> Pas de limite · +70% de prix à chaque cave · 1 achat toutes les 1h30\n\n` +
            `🔒 **Cadenas** · \`${config.prefix}buy cadenas [nb]\`\n` +
            `> **${fmt(LOCK_PRICE)}** ${RB()} · bloque une tentative de \`${config.prefix}rob\` contre toi`,
        );
}

module.exports = [
    {
        name: 'bank',
        aliases: ['b', 'bal', 'balance'],
        category: 'eco',
        description: 'Ton compte en banque (ou celui de quelqu\'un)',
        usage: '[@user]',
        options: [{ name: 'membre', type: 'user', description: 'Membre (toi par defaut)' }],
        async run(ctx, { membre }) {
            const user = membre || ctx.user;
            const p = await db.getProfile(user.id);
            const name = user.id === ctx.user.id ? ctx.displayName : user.globalName || user.username;
            const net = p.wincount - p.pertecount;
            const embed = new EmbedBuilder()
                .setColor('#a8ffd8')
                .setAuthor({ name: `Banque de ${name}`, iconURL: avatar(user) })
                .setDescription(`*${pick(C.bankQuotes)}*\n\n**${fmt(p.rb)}** ${RB()}`)
                .addFields(
                    { name: '👥 Esclaves', value: `${p.slavecount} / ${p.cavecount * SLAVES_PER_CAVE}`, inline: true },
                    { name: '🏠 Caves', value: `${p.cavecount} · prochaine ${fmt(cavePrice(p.cavecount))}`, inline: true },
                    { name: '💼 Revenu =work', value: `${fmt(WORK_BASE + WORK_PER_SLAVE * p.slavecount)} ${RB()}`, inline: true },
                    { name: '📈 Gains casino', value: `${fmt(p.wincount)} ${RB()}`, inline: true },
                    { name: '📉 Pertes casino', value: `${fmt(p.pertecount)} ${RB()}`, inline: true },
                    { name: '⚖️ Bilan', value: `${net >= 0 ? '+' : '-'}${fmt(Math.abs(net))} ${RB()}`, inline: true },
                    { name: '🏦 Crédit', value: p.debt > 0 ? `${fmt(p.debt)} ${RB()}\n${credit.pct(p.debt)} % sur tout` : 'aucune dette', inline: true },
                );
            await ctx.reply({ embeds: [embed] });
        },
    },
    {
        name: 'work',
        aliases: ['w'],
        category: 'eco',
        description: `Travaille pour gagner des RB (toutes les 30 min)`,
        async run(ctx) {
            const slot = nextSlot();
            const left = await cd.take(ctx.user.id, 'work', slot, { absolute: true });
            if (left) return ctx.reply(`⏳ **${ctx.displayName}**, tu pourras retravailler ${ui.ts(Date.now() + left)}.`);
            const p = await db.getProfile(ctx.user.id);
            const bonus = WORK_PER_SLAVE * p.slavecount;
            const m = await boost.mult();
            const total = (WORK_BASE + bonus) * m;
            const pay = await eco.addRb(ctx.user.id, total);
            await ctx.reply(
                `**+${fmt(pay.net)}** ${RB()} pour **${ctx.displayName}** !${happyTag(m)}${credit.note(pay.cut, pay.debt)}\n` +
                `-# 💼 Travail ${WORK_BASE}${bonus ? ` · 📜 Bonus esclaves +${fmt(bonus)}` : ''} · prochain ${ui.ts(slot)}`,
            );
            await progress.track(ctx, { work: 1 });
        },
    },
    {
        name: 'gamblework',
        aliases: ['gw'],
        category: 'eco',
        description: 'Travail au hasard : 25 a 100 RB (toutes les 30 min)',
        async run(ctx) {
            const slot = nextSlot();
            const left = await cd.take(ctx.user.id, 'gw', slot, { absolute: true });
            if (left) return ctx.reply(`⏳ **${ctx.displayName}**, prochain gw ${ui.ts(Date.now() + left)}.`);
            const m = await boost.mult();
            const base = randInt(25, 100);
            const gain = base * m;
            const pay = await eco.addRb(ctx.user.id, gain);
            const mood = base >= 90 ? '🤑' : base <= 35 ? '😐' : '💸';
            await ctx.reply(`${mood} **+${fmt(pay.net)}** ${RB()} pour **${ctx.displayName}** !${happyTag(m)}${credit.note(pay.cut, pay.debt)}\n-# prochain gw ${ui.ts(slot)}`);
            await progress.track(ctx, { gw: 1 });
        },
    },
    {
        name: 'daily',
        aliases: ['d'],
        category: 'eco',
        description: 'Bonus quotidien avec streak',
        async run(ctx) {
            const now = Date.now();
            const p = await db.getProfile(ctx.user.id);
            const since = now - p.daily_last;
            if (p.daily_last && since < DAILY_CD) {
                return ctx.reply(`⏳ Daily déjà pris. Reviens ${ui.ts(p.daily_last + DAILY_CD)}. Streak actuel : **${p.daily_streak}** 🔥`);
            }
            const streak = p.daily_last && since < DAILY_BREAK ? p.daily_streak + 1 : 1;
            const m = await boost.mult();
            const reward = (DAILY_BASE + DAILY_STREAK_BONUS * Math.min(streak - 1, DAILY_STREAK_MAX)) * m;
            // conditionne sur l'ancienne valeur : impossible de prendre 2 dailies en spammant
            const res = await db.exec(
                'UPDATE profile SET daily_last = ?, daily_streak = ? WHERE id_user = ? AND daily_last = ?',
                [now, streak, ctx.user.id, p.daily_last],
            );
            if (!res.affectedRows) return ctx.reply('⏳ Daily déjà pris.');
            const pay = await eco.addRb(ctx.user.id, reward);
            const lost = p.daily_streak > 1 && streak === 1 ? `\n-# 💀 Tu avais un streak de ${p.daily_streak}, perdu...` : '';
            // un coffre chaque jour, rare tous les 7 jours, legendaire tous les 30
            const crate = streak % 30 === 0 ? 'coffre_legend' : streak % 7 === 0 ? 'coffre_rare' : 'coffre';
            await inv.add(ctx.user.id, crate);
            const toRare = 7 - (streak % 7);
            const week = Array.from({ length: 7 }, (_, k) => (k < streak % 7 || (streak % 7 === 0 && streak > 0) ? '🔥' : k === 6 ? '🎁' : '▫️')).join('');
            await ctx.reply(
                `🎁 **+${fmt(pay.net)}** ${RB()} + ${inv.label(crate)} pour **${ctx.displayName}** !${happyTag(m)}${credit.note(pay.cut, pay.debt)}\n` +
                `${week} Streak **${streak}** jour${streak > 1 ? 's' : ''}` +
                `${streak % 7 === 0 ? ' · coffre rare débloqué !' : ` · coffre rare dans **${toRare}** jour${toRare > 1 ? 's' : ''}`}\n` +
                `-# demain : +${fmt(DAILY_BASE + DAILY_STREAK_BONUS * Math.min(streak, DAILY_STREAK_MAX))} · \`${config.prefix}ouvrir\` pour ton coffre${lost}`,
            );
            await progress.track(ctx, { daily: 1 });
        },
    },
    {
        name: 'give',
        aliases: ['pay', 'donne'],
        category: 'eco',
        description: 'Donne des RB a quelqu\'un',
        usage: '<@user> <montant|all|half|1k>',
        example: 'give @rigel 500',
        options: [
            { name: 'membre', type: 'user', required: true, description: 'Qui recoit' },
            { name: 'montant', type: 'string', required: true, description: 'Nombre, all, half, 1k...' },
        ],
        async run(ctx, { membre, montant }) {
            if (membre.id === ctx.user.id) return ctx.fail('Tu peux pas te donner à toi-même.');
            if (membre.bot) return ctx.fail('Les bots n\'ont pas besoin de ton argent.');
            const bal = await eco.balance(ctx.user.id);
            const amount = eco.parseAmount(montant, bal);
            if (!amount) return ctx.fail('Montant invalide.');
            if (amount > bal) return ctx.fail(`Tu n'as que **${fmt(bal)}** ${RB()}.`);
            const pay = await eco.transfer(ctx.user.id, membre.id, amount);
            if (!pay) return ctx.fail('Fonds insuffisants.');
            await ctx.reply(`💸 **${ctx.displayName}** a donné **${fmt(amount)}** ${RB()} à ${membre} !${credit.note(pay.cut, pay.debt)}`);
        },
    },
    {
        name: 'shop',
        category: 'eco',
        description: 'Affiche le magasin',
        async run(ctx) {
            await ctx.reply({ embeds: [await shopEmbed(ctx)] });
        },
    },
    {
        name: 'buy',
        aliases: ['acheter'],
        category: 'eco',
        description: 'Achete un esclave ou une cave',
        usage: '<slave|cave> [nb|max]',
        options: [
            { name: 'item', type: 'string', description: 'Quoi acheter', choices: [{ name: 'esclave', value: 'slave' }, { name: 'cave', value: 'cave' }, { name: 'cadenas', value: 'cadenas' }] },
            { name: 'quantite', type: 'string', description: 'Nombre ou max (esclaves)' },
        ],
        async run(ctx, { item, quantite }) {
            const what = { esclave: 'slave', slaves: 'slave', esclaves: 'slave', caves: 'cave', lock: 'cadenas', cadenas: 'cadenas', cadena: 'cadenas' }[item?.toLowerCase()] || item?.toLowerCase();
            if (!what) return ctx.reply({ embeds: [await shopEmbed(ctx)] });

            if (what === 'slave') {
                const result = await db.tx(async (conn) => {
                    await db.ensureProfile(ctx.user.id, conn);
                    const [[p]] = await conn.query('SELECT rb, slavecount, cavecount FROM profile WHERE id_user = ? FOR UPDATE', [ctx.user.id]);
                    const server = await serverSlaves(conn);
                    const rb = Number(p.rb);
                    const owned = Number(p.slavecount);
                    const room = Number(p.cavecount) * SLAVES_PER_CAVE - owned;
                    if (room <= 0) return { err: `Plus de place ! **${SLAVES_PER_CAVE} esclaves par cave**. Prochaine cave : **${fmt(cavePrice(Number(p.cavecount)))}** ${RB()} (\`${config.prefix}buy cave\`).` };
                    let qty;
                    if (['max', 'all'].includes(String(quantite).toLowerCase())) {
                        qty = 0;
                        while (qty < Math.min(room, BULK_MAX) && slaveCost(owned, qty + 1, server) <= rb) qty++;
                    } else qty = quantite === undefined ? 1 : parseInt(quantite, 10);
                    const first = slaveUnit(owned, server);
                    if (!qty || qty < 0 || Number.isNaN(qty)) return { err: rb < first ? `Il te faut **${fmt(first)}** ${RB()} pour le prochain esclave.` : 'Quantité invalide.' };
                    if (qty > BULK_MAX) return { err: `${BULK_MAX} max par achat.` };
                    if (qty > room) return { err: `Tu as de la place pour **${room}** esclave(s) seulement.` };
                    const cost = slaveCost(owned, qty, server);
                    if (rb < cost) return { err: `Il te faut **${fmt(cost)}** ${RB()} pour ${qty} esclave(s) (tu as ${fmt(rb)}).` };
                    await conn.query('UPDATE profile SET rb = rb - ?, slavecount = slavecount + ? WHERE id_user = ?', [cost, qty, ctx.user.id]);
                    return { qty, cost, total: owned + qty, next: slaveUnit(owned + qty, server + qty) };
                });
                if (result.err) return ctx.fail(result.err);
                return ctx.reply(`👏 **${ctx.displayName}** a acheté **${result.qty}** esclave(s) pour **${fmt(result.cost)}** ${RB()}. Total : **${result.total}**.\n-# prochain esclave : ${fmt(result.next)}`);
            }

            if (what === 'cave') {
                const left = await cd.remaining(ctx.user.id, 'cave');
                if (left) return ctx.fail(`Prochaine cave ${ui.ts(Date.now() + left)}.`);
                const result = await db.tx(async (conn) => {
                    await db.ensureProfile(ctx.user.id, conn);
                    const [[p]] = await conn.query('SELECT rb, cavecount FROM profile WHERE id_user = ? FOR UPDATE', [ctx.user.id]);
                    const price = cavePrice(Number(p.cavecount));
                    if (Number(p.rb) < price) return { err: `Il te faut **${fmt(price)}** ${RB()} pour ta cave n°${Number(p.cavecount) + 1} (tu as ${fmt(p.rb)}).` };
                    await conn.query('UPDATE profile SET rb = rb - ?, cavecount = cavecount + 1 WHERE id_user = ?', [price, ctx.user.id]);
                    return { total: Number(p.cavecount) + 1, price };
                });
                if (result.err) return ctx.fail(result.err);
                await cd.set(ctx.user.id, 'cave', CAVE_CD);
                return ctx.reply(`🏠 **${ctx.displayName}** a acheté sa cave n°${result.total} pour **${fmt(result.price)}** ${RB()} (${result.total * SLAVES_PER_CAVE} places).\n-# prochaine cave : ${fmt(cavePrice(result.total))}`);
            }

            if (what === 'cadenas') {
                const qty = Math.min(10, Math.max(1, parseInt(quantite, 10) || 1));
                const have = (await inv.list(ctx.user.id)).cadenas || 0;
                if (have + qty > 10) return ctx.fail('10 cadenas max.');
                if (!(await eco.takeRb(ctx.user.id, qty * LOCK_PRICE))) return ctx.fail(`Il te faut **${fmt(qty * LOCK_PRICE)}** ${RB()}.`);
                await inv.add(ctx.user.id, 'cadenas', qty);
                return ctx.reply(`🔒 **${ctx.displayName}** achète **${qty}** cadenas. Tu en as **${have + qty}**, les voleurs n'ont qu'à bien se tenir.`);
            }
            return ctx.fail(`Item inconnu. \`${config.prefix}shop\` pour voir le magasin.`);
        },
    },
    {
        name: 'mine',
        aliases: ['m'],
        category: 'eco',
        description: 'Mine du roknit (1 fois par minute)',
        async run(ctx) {
            const left = await cd.take(ctx.user.id, 'mine', MINE_CD);
            if (left) return ctx.reply(`⛏️ **${ctx.displayName}**, ta pioche refroidit... ${ui.ts(Date.now() + left)}`);
            const r = Math.random() * 1000;
            let gain;
            let what;
            if (r < 1) { gain = 1000; what = '💎 **Roknit légendaire**'; }
            else if (r < 11) { gain = 100; what = '🔹 **Diamant rare**'; }
            else if (r < 61) { gain = randInt(10, 25); what = '🟡 **Pépite d\'or**'; }
            else { gain = randInt(1, 5); what = '🪨 **Pierre commune**'; }
            const hm = await boost.mult();
            gain *= hm;
            // 1 chance sur 40 de trouver un coffre en minant
            const found = Math.random() < 1 / 40;
            if (found) await inv.add(ctx.user.id, 'coffre');
            const pay = await eco.addRb(ctx.user.id, gain);
            await eco.bump(ctx.user.id, { minecount: gain });
            const bal = await eco.balance(ctx.user.id);
            const hype = gain >= 1000 ? '\n🚨🚨 **JACKPOT** 🚨🚨' : '';
            await ctx.reply(`⛏️ **${ctx.displayName}** a trouvé ${what} : **+${fmt(pay.net)}** ${RB()} (solde ${fmt(bal)})${happyTag(hm)}${credit.note(pay.cut, pay.debt)}${hype}${found ? `\n📦 Et un **coffre** caché dans la roche ! \`${config.prefix}ouvrir\`` : ''}`);
            await progress.track(ctx, { mine: 1 }, { roknit: gain >= 1000 });
        },
    },
    {
        name: 'credit',
        aliases: ['pret', 'emprunt', 'dette'],
        category: 'eco',
        description: 'Emprunte des RB. Le work est prélevé à la source jusqu\'au remboursement',
        usage: '[montant]',
        example: 'credit 100000',
        options: [{ name: 'montant', type: 'string', description: 'Somme à emprunter (100 à 100000k)' }],
        async run(ctx, { montant }) {
            const p = await db.getProfile(ctx.user.id);
            if (!montant) {
                const r = credit.pct(p.debt);
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setColor(p.debt > 0 ? '#e74c3c' : '#a8ffd8')
                        .setTitle(`🏦 Crédit de ${ctx.displayName}`)
                        .setDescription(
                            p.debt > 0
                                ? `Dette : **${fmt(p.debt)}** ${RB()}\n**${r} %** de tout ce qui entre est pris à la source : work, daily, casino, quêtes, dons, récompenses.\nÀ partir de **100k** de dette, c'est **50 %**. Tu rembourses tout.\n\n\`${config.prefix}rembourser <montant|all>\` pour payer plus vite.`
                                : `Aucune dette.\n\`${config.prefix}credit 5000\` pour emprunter.\nEnsuite la banque prend une part de **tout** ce qui arrive sur le compte : **10 %** sur une petite dette, **50 %** à partir de **100k**.\nPlafond : **${fmt(credit.MAX_DEBT)}** ${RB()}.`,
                        )],
                });
            }
            const bal = await eco.balance(ctx.user.id);
            const amount = eco.parseAmount(montant, bal);
            if (!amount) return ctx.fail('Montant invalide (`5000`, `100k`, `100000k`).');
            if (amount < credit.MIN_LOAN) return ctx.fail(`Minimum **${fmt(credit.MIN_LOAN)}** ${RB()}.`);
            const res = await credit.borrow(ctx.user.id, amount);
            if (res.error === 'cap') {
                return ctx.fail(`Plafond **${fmt(credit.MAX_DEBT)}** ${RB()}. Dette actuelle : **${fmt(res.debt)}**.`);
            }
            const now = await eco.balance(ctx.user.id);
            return ctx.reply(
                `🏦 **${ctx.displayName}** emprunte **${fmt(amount)}** ${RB()}. Solde : **${fmt(now)}**.\n` +
                `Dette : **${fmt(res.debt)}** · **${credit.pct(res.debt)} %** de chaque entrée (work, daily, casino, récompenses, dons) part à la banque jusqu'au remboursement total.`,
            );
        },
    },
    {
        name: 'rembourser',
        aliases: ['rembourse', 'repay'],
        category: 'eco',
        description: 'Rembourse une partie du crédit avec ton solde',
        usage: '<montant|all>',
        example: 'rembourser all',
        options: [{ name: 'montant', type: 'string', required: true, description: 'Somme, ou all' }],
        async run(ctx, { montant }) {
            const p = await db.getProfile(ctx.user.id);
            if (p.debt <= 0) return ctx.fail('Tu n\'as pas de crédit en cours.');
            const bal = await eco.balance(ctx.user.id);
            const amount = eco.parseAmount(montant, bal);
            if (!amount) return ctx.fail('Montant invalide.');
            const res = await credit.repay(ctx.user.id, amount);
            if (res.error === 'broke') return ctx.fail(`Tu n'as que **${fmt(bal)}** ${RB()} pour rembourser **${fmt(p.debt)}**.`);
            if (res.error === 'none') return ctx.fail('Tu n\'as pas de crédit en cours.');
            const left = res.debt > 0
                ? `Il reste **${fmt(res.debt)}** ${RB()} · prélèvement **${credit.pct(res.debt)} %**.`
                : 'Dette soldée. Ton work repasse à 100 %.';
            return ctx.reply(`🏦 **${ctx.displayName}** rembourse **${fmt(res.paid)}** ${RB()}. ${left}`);
        },
    },
];
