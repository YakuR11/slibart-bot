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
const wages = require('../lib/wages');
const upkeep = require('../lib/upkeep');

const happyTag = (m) => (m > 1 ? ' · 🔥 **HAPPY HOUR x2**' : '');
const ui = require('../lib/ui');

const RB = () => config.rbEmoji;
const C = config.content;

// --- reglages du jeu (modifiables ici) ---
const WORK_BASE = wages.WORK_BASE;
const WORK_PER_SLAVE = wages.WORK_PER_SLAVE;
const DAILY_BASE = 200;
const DAILY_STREAK_BONUS = 25; // par jour de streak
const DAILY_STREAK_MAX = 10;
const DAILY_CD = 20 * 3600 * 1000; // 20h : pas besoin d'etre pile a la meme heure chaque jour
const DAILY_BREAK = 48 * 3600 * 1000; // streak perdu apres 48h sans daily
const shop = require('../lib/shop');
const { SLAVES_PER_CAVE, slaveUnit, cavePrice, slaveCost, serverSlaves, LOCK_PRICE } = shop;
const prestige = require('../lib/prestige');
const MINE_CD = 60 * 1000;

function buyError(r) {
    if (r.err === 'room') return `Plus de place ! **${SLAVES_PER_CAVE} esclaves par cave**. Prochaine cave : **${fmt(r.cave)}** ${RB()} (\`${config.prefix}buy cave\`).`;
    if (r.err === 'bulk') return `${shop.BULK_MAX} max par achat.`;
    if (r.err === 'roomfor') return `Tu as de la place pour **${r.room}** esclave(s) seulement.`;
    if (r.err === 'broke') return r.qty > 1 ? `Il te faut **${fmt(r.need)}** ${RB()} pour ${r.qty} esclave(s) (tu as ${fmt(r.rb)}).` : `Il te faut **${fmt(r.need)}** ${RB()} pour le prochain esclave.`;
    return 'Quantité invalide.';
}

function foremanBlurb(p) {
    const o = wages.foremanOffer(p.slavecount);
    const head = `⏱️ **Contremaître** · \`${config.prefix}buy contremaitre\`\n> **${fmt(wages.FOREMAN_PRICE)}** ${RB()} · une fois${p.foreman ? ' · **en poste**' : ''}\n`;
    if (p.foreman) return `${head}> Il ramasse **${fmt(o.after)}** ${RB()} / 30 min\n\n`;
    if (!o.slots) return `${head}> Ramasse les **${fmt(o.before)}** ${RB()} tout seul. Prends des esclaves d'abord.\n\n`;
    const when = o.hours >= 48 ? `${Math.round(o.hours / 24)} jours` : `${Math.round(o.hours)} h`;
    return `${head}> Ramasse le \`${config.prefix}work\` tout seul\n> **${fmt(o.before)} → ${fmt(o.after)}** ${RB()} / 30 min (**+${fmt(o.delta)}**)\n> Remboursé en **${o.slots}** créneaux, environ **${when}**\n\n`;
}

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
            `> +${WORK_PER_SLAVE} ${RB()} par \`${config.prefix}work\`\n` +
            `> +15% de prix à chaque esclave\n` +
            `> Place libre : **${Math.max(0, room)}** (${SLAVES_PER_CAVE} par cave)\n\n` +
            `🏠 **Cave** · \`${config.prefix}buy cave\`\n` +
            `> Prochaine : **${fmt(cavePrice(p.cavecount))}** ${RB()} · puis ${fmt(cavePrice(p.cavecount + 1))}, ${fmt(cavePrice(p.cavecount + 2))}...\n` +
            `> Pas de limite · +70% de prix à chaque cave · 1 achat toutes les 1h30\n\n` +
            foremanBlurb(p) +
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
                    { name: '💼 Revenu =work', value: `${fmt(wages.workAmount(p.slavecount, { foreman: p.foreman, mult: prestige.mult(p.prestige) }))} ${RB()} / 30 min${p.foreman ? '\ncontremaître en poste' : ''}${p.prestige ? `\n⭐ prestige ${p.prestige} (x${prestige.mult(p.prestige).toFixed(1)})` : ''}`, inline: true },
                    { name: '🏠 Entretien', value: p.cavecount ? `${fmt(upkeep.caveFee(p.cavecount))} ${RB()} / jour` : 'pas de cave', inline: true },
                    { name: '💸 Taxe', value: `1 % au-dessus de ${fmt(upkeep.TAX_FLOOR)} (max ${fmt(upkeep.TAX_CAP)} / jour)`, inline: true },
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
            const p = await db.getProfile(ctx.user.id);
            const m = await boost.mult();
            const bonus = (WORK_PER_SLAVE + (p.foreman ? wages.FOREMAN_EXTRA : 0)) * p.slavecount;
            const pm = prestige.mult(p.prestige);
            const pot = wages.workAmount(p.slavecount, { foreman: p.foreman, mult: m * pm });
            const got = await wages.claim(ctx.user.id, 'work', pot, pot, { all: true });
            if (got.paid <= 0) {
                const who = p.foreman ? 'ton contremaître est passé' : 'déjà fait';
                return ctx.reply(`⏳ **${ctx.displayName}**, salaire déjà pris (${who}). Prochain ${ui.ts(got.slotEnd)}.`);
            }
            const pay = await eco.addRb(ctx.user.id, got.paid);
            const partial = got.already ? ` · ${fmt(got.already)} déjà pris` : '';
            const boss = `${p.foreman ? ' · ⏱️ contremaître' : ''}${p.prestige ? ` · ⭐ x${pm.toFixed(1)}` : ''}`;
            await ctx.reply(
                `**+${fmt(pay.net)}** ${RB()} pour **${ctx.displayName}** !${happyTag(m)}${credit.note(pay.cut, pay.debt)}\n` +
                `-# 💼 Travail ${WORK_BASE}${bonus ? ` · 📜 Bonus esclaves +${fmt(bonus)}` : ''}${boss}${partial} · prochain ${ui.ts(got.slotEnd)}`,
            );
            if (got.fresh) await progress.track(ctx, { work: 1 });
        },
    },
    {
        name: 'gamblework',
        aliases: ['gw'],
        category: 'eco',
        description: 'Travail au hasard : 25 a 100 RB (toutes les 30 min)',
        async run(ctx) {
            const hm = await boost.mult();
            const m = hm * prestige.mult((await db.getProfile(ctx.user.id)).prestige);
            const base = randInt(25, 100);
            const pot = Math.round(base * m);
            const got = await wages.claim(ctx.user.id, 'gw', pot, pot, { all: true, lockPot: true });
            if (got.paid <= 0) return ctx.reply(`⏳ **${ctx.displayName}**, prochain gw ${ui.ts(got.slotEnd)}.`);
            const pay = await eco.addRb(ctx.user.id, got.paid);
            const shown = got.already ? got.paid : pot;
            const mood = shown >= 90 * m ? '🤑' : shown <= 35 * m ? '😐' : '💸';
            const partial = got.already ? ` · ${fmt(got.already)} déjà pris` : '';
            await ctx.reply(`${mood} **+${fmt(pay.net)}** ${RB()} pour **${ctx.displayName}** !${happyTag(hm)}${credit.note(pay.cut, pay.debt)}\n-# prochain gw ${ui.ts(got.slotEnd)}${partial}`);
            if (got.fresh) await progress.track(ctx, { gw: 1 });
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
            const reward = Math.round((DAILY_BASE + DAILY_STREAK_BONUS * Math.min(streak - 1, DAILY_STREAK_MAX)) * m * prestige.mult(p.prestige));
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
            // pas de don avec une dette : sinon on emprunte et on vide tout sur le compte d'un pote
            const me = await db.getProfile(ctx.user.id);
            if (me.debt > 0) return ctx.fail(`Tu as une dette de **${fmt(me.debt)}** ${RB()}. Rembourse d'abord (\`${config.prefix}rembourser\`).`);
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
        description: 'Achete un esclave, une cave ou le contremaitre',
        usage: '<slave|cave|contremaitre> [nb|max]',
        options: [
            { name: 'item', type: 'string', description: 'Quoi acheter', choices: [{ name: 'esclave', value: 'slave' }, { name: 'cave', value: 'cave' }, { name: 'contremaître', value: 'contremaitre' }, { name: 'cadenas', value: 'cadenas' }] },
            { name: 'quantite', type: 'string', description: 'Nombre ou max (esclaves)' },
        ],
        async run(ctx, { item, quantite }) {
            const what = { esclave: 'slave', slaves: 'slave', esclaves: 'slave', caves: 'cave', lock: 'cadenas', cadenas: 'cadenas', cadena: 'cadenas', contremaitre: 'contremaitre', 'contremaître': 'contremaitre', foreman: 'contremaitre', regisseur: 'contremaitre', 'régisseur': 'contremaitre' }[item?.toLowerCase()] || item?.toLowerCase();
            if (!what) return ctx.reply({ embeds: [await shopEmbed(ctx)] });

            if (what === 'slave') {
                const r = await shop.buySlaves(ctx.user.id, quantite);
                if (r.err) return ctx.fail(buyError(r));
                return ctx.reply(`👏 **${ctx.displayName}** a acheté **${r.qty}** esclave(s) pour **${fmt(r.cost)}** ${RB()}. Total : **${r.total}**.\n-# prochain esclave : ${fmt(r.next)}`);
            }

            if (what === 'cave') {
                const r = await shop.buyCave(ctx.user.id);
                if (r.err === 'cd') return ctx.fail(`Prochaine cave ${ui.ts(r.until)}.`);
                if (r.err) return ctx.fail(`Il te faut **${fmt(r.need)}** ${RB()} pour ta cave n°${r.n} (tu as ${fmt(r.rb)}).`);
                return ctx.reply(`🏠 **${ctx.displayName}** a acheté sa cave n°${r.total} pour **${fmt(r.price)}** ${RB()} (${r.total * SLAVES_PER_CAVE} places).\n-# prochaine cave : ${fmt(cavePrice(r.total))}`);
            }

            if (what === 'contremaitre') {
                const r = await shop.buyForeman(ctx.user.id);
                if (r.err === 'owned') return ctx.fail('Ton contremaître est déjà en poste.');
                if (r.err === 'broke') return ctx.fail(`Il te faut **${fmt(r.need)}** ${RB()} (tu as ${fmt(r.rb)}).`);
                if (r.err) return ctx.fail('Achat pas passé, réessaie.');
                const o = r.offer;
                return ctx.reply(
                    `⏱️ **${ctx.displayName}** pose le contremaître pour **${fmt(r.price)}** ${RB()}.\n` +
                    `**${fmt(o.before)} → ${fmt(o.after)}** ${RB()} / 30 min. Il ramasse même si t'es pas là.`,
                );
            }

            if (what === 'cadenas') {
                const r = await shop.buyLocks(ctx.user.id, quantite);
                if (r.err === 'max') return ctx.fail(`${shop.LOCK_MAX} cadenas max.`);
                if (r.err) return ctx.fail(`Il te faut **${fmt(r.need)}** ${RB()}.`);
                return ctx.reply(`🔒 **${ctx.displayName}** achète **${r.qty}** cadenas. Tu en as **${r.have}**, les voleurs n'ont qu'à bien se tenir.`);
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
            gain = Math.round(gain * hm * prestige.mult((await db.getProfile(ctx.user.id)).prestige));
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
        options: [{ name: 'montant', type: 'string', description: 'Somme à emprunter (plafond selon ton niveau)' }],
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
                                : `Aucune dette.\n\`${config.prefix}credit 5000\` pour emprunter (**${Math.round(credit.FEE * 100)} %** de frais).\nEnsuite la banque prend une part de **tout** ce qui arrive sur le compte : **10 %** sur une petite dette, **50 %** à partir de **100k**.\nPlafond à ton niveau : **${fmt(credit.maxDebt(p.level))}** ${RB()} (monte avec ton niveau).\nPas de \`give\` tant que tu as une dette.`,
                        )],
                });
            }
            const bal = await eco.balance(ctx.user.id);
            const amount = eco.parseAmount(montant, bal);
            if (!amount) return ctx.fail('Montant invalide (`5000`, `100k`, `100000k`).');
            if (amount < credit.MIN_LOAN) return ctx.fail(`Minimum **${fmt(credit.MIN_LOAN)}** ${RB()}.`);
            const res = await credit.borrow(ctx.user.id, amount);
            if (res.error === 'cap') {
                return ctx.fail(`Plafond à ton niveau : **${fmt(res.cap)}** ${RB()} de dette (dette actuelle **${fmt(res.debt)}**). Tu peux encore emprunter **${fmt(res.room)}**.`);
            }
            const now = await eco.balance(ctx.user.id);
            return ctx.reply(
                `🏦 **${ctx.displayName}** emprunte **${fmt(amount)}** ${RB()} (tu dois **${fmt(res.owed)}** avec les frais). Solde : **${fmt(now)}**.\n` +
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
