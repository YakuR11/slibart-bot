// Roulette, slots et duel dans le chat : les boutons marchent sur telephone,
// l'activite Discord (vocal) non. L'app garde les memes regles pour le PC.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const config = require('../config');
const db = require('../db');
const eco = require('../lib/economy');
const { fmt, pick, avatar, sleep } = require('../lib/utils');
const casino = require('../lib/casino');
const ui = require('../lib/ui');
const progress = require('../lib/progress');

const RB = () => config.rbEmoji;

// ---------------------------------------------------------------------------
// Roulette europeenne (=roulette) : memes paris et memes gains que dans l'app
// ---------------------------------------------------------------------------
const rl = require('../lib/roulette-math');
const DOT = { red: '🔴', black: '⚫', green: '🟢' };
const pocket = (n) => `${DOT[rl.color(n)]}${n}`;
/** morceau de roue centre sur n : 🔴27 ⚫13 ▸ 🔴36 ◂ ⚫11 🔴30 */
function wheelAround(n) {
    const i = rl.WHEEL.indexOf(n);
    const at = (k) => pocket(rl.WHEEL[(i + k + 37) % 37]);
    return `${at(-2)} ${at(-1)} ▸ **${at(0)}** ◂ ${at(1)} ${at(2)}`;
}

// ---------------------------------------------------------------------------
// Machine a sous (=slots) — esperance ~0.90, le casino gagne a la longue
// ---------------------------------------------------------------------------
const REELS = [
    { s: '🍒', w: 35, x3: 5 },
    { s: '🍋', w: 30, x3: 8 },
    { s: '🍇', w: 20, x3: 15 },
    { s: '🔔', w: 10, x3: 50 },
    { s: '💎', w: 4, x3: 250 },
    { s: '7️⃣', w: 1, x3: 2000 },
];
const PAIR_PAYOUT = 0.5;

// Jackpot progressif : 3% de chaque mise aux slots alimente le pot, 777 avec mise >= 100 le rafle
const JACKPOT_BASE = 5000;
const JACKPOT_CUT = 0.03;
const JACKPOT_MIN_BET = 100;
async function jackpotAdd(n) {
    await db.exec(
        `INSERT INTO settings (k, v) VALUES ('jackpot', ?) ON DUPLICATE KEY UPDATE v = CAST(v AS SIGNED) + ?`,
        [String(JACKPOT_BASE + n), n],
    );
}
const jackpotGet = async () => Number(await db.getSetting('jackpot', String(JACKPOT_BASE)));
async function jackpotClaim() {
    return db.tx(async (conn) => {
        const [[row]] = await conn.query(`SELECT v FROM settings WHERE k = 'jackpot' FOR UPDATE`);
        const pot = Number(row?.v || JACKPOT_BASE);
        await conn.query(`INSERT INTO settings (k, v) VALUES ('jackpot', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)`, [String(JACKPOT_BASE)]);
        return pot;
    });
}
const REEL_TOTAL = REELS.reduce((a, r) => a + r.w, 0);
function spinReel() {
    let n = Math.random() * REEL_TOTAL;
    for (const r of REELS) {
        if ((n -= r.w) < 0) return r;
    }
    return REELS[0];
}

// ---------------------------------------------------------------------------
// Duel pierre-feuille-ciseaux avec mise sequestree
// ---------------------------------------------------------------------------
const inDuel = new Set();
const RPS = { pierre: '🪨', feuille: '🍂', ciseaux: '✂️' };
const beats = (a, b) => (a === 'pierre' && b === 'ciseaux') || (a === 'feuille' && b === 'pierre') || (a === 'ciseaux' && b === 'feuille');

async function playRound(ctx, channel, p1, p2, amount, round) {
    const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const row = new ActionRowBuilder().addComponents(
        Object.entries(RPS).map(([k, e]) =>
            new ButtonBuilder().setCustomId(`rps:${id}:${k}`).setLabel(`${e} ${k[0].toUpperCase()}${k.slice(1)}`).setStyle(ButtonStyle.Secondary)),
    );
    const embed = new EmbedBuilder()
        .setTitle(round === 1 ? "C'EST L'HEURE DU DU-DU-DU-DU-DUEL!" : `🔁 Égalité ! Manche ${round}`)
        .setDescription(`**${p1.username}** VS **${p2.username}**\n**${fmt(amount * 2)}** ${RB()} dans le pot.\n\nChoisissez votre coup (30s) !`)
        .setColor('#F1C40F');
    if (round === 1) embed.setImage('https://media1.tenor.com/m/KNALQSk1p7gAAAAd/yugioh-yugi.gif');

    const msg = await channel.send({ embeds: [embed], components: [row] });
    const choices = {};
    await new Promise((resolve) => {
        const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000 });
        col.on('collect', async (i) => {
            if (![p1.id, p2.id].includes(i.user.id)) return i.reply({ content: 'Ce duel ne te concerne pas.', flags: MessageFlags.Ephemeral });
            if (choices[i.user.id]) return i.reply({ content: 'Tu as déjà choisi !', flags: MessageFlags.Ephemeral });
            choices[i.user.id] = i.customId.split(':')[2];
            await i.reply({ content: `Tu as choisi ${RPS[choices[i.user.id]]} **${choices[i.user.id]}**`, flags: MessageFlags.Ephemeral });
            const done = [p1.id, p2.id].filter((u) => choices[u]).map((u) => (u === p1.id ? p1.username : p2.username));
            await msg.edit({ embeds: [EmbedBuilder.from(embed).setFooter({ text: `✅ ${done.join(' · ')}` })] }).catch(() => {});
            if (choices[p1.id] && choices[p2.id]) col.stop('done');
        });
        col.on('end', resolve);
    });
    await msg.edit({ components: [] }).catch(() => {});
    return { c1: choices[p1.id], c2: choices[p2.id] };
}

module.exports = [
    {
        name: 'roulette',
        aliases: ['gamble', 'g', 'rl'],
        category: 'jeux',
        description: 'Roulette (0-36) : couleurs, pair/impair, numeros, chevaux, douzaines... plusieurs paris a la fois',
        usage: '<mise par pari> <pari> [pari...]',
        example: 'roulette 100 rouge 17 17-18 d2',
        options: [
            { name: 'montant', type: 'string', required: true, description: 'Mise sur CHAQUE pari : nombre, all, half, 1k...' },
            { name: 'paris', type: 'text', required: true, description: 'rouge noir pair impair 1-18 19-36 d1-d3 c1-c3, un numero (17), un cheval (17-18), un carre (8-9-11-12)' },
        ],
        async run(ctx, { montant, paris }) {
            let amount = String(montant);
            let words = String(paris).split(/[\s,]+/).filter(Boolean);
            // ancien ordre (=g r 500) : le pari d'abord, la mise ensuite
            if (rl.parseBet(amount) && !/^(\d|all|half|tout|max|moiti)/i.test(amount) && words.length === 1) [amount, words] = [words[0], [amount]];
            const ids = [];
            for (const w of words) {
                const id = rl.parseBet(w);
                if (!id) {
                    return ctx.fail(
                        `Pari inconnu : \`${w}\`.\n` +
                        `**x2** \`rouge\` \`noir\` \`pair\` \`impair\` \`1-18\` \`19-36\` · **x3** \`d1\` \`d2\` \`d3\` (douzaines) \`c1\` \`c2\` \`c3\` (colonnes)\n` +
                        `**x36** un numéro \`17\` · **x18** un cheval \`17-18\` · **x12** une transversale \`16-17-18\` · **x9** un carré \`8-9-11-12\` · **x6** un sixain \`13-18\`\n` +
                        `Ex : \`${config.prefix}roulette 100 rouge 17 d2\` (100 sur chacun).`,
                    );
                }
                if (!ids.includes(id)) ids.push(id);
            }
            if (ids.length > 12) return ctx.fail('12 paris maximum par tour dans le chat (dans l\'app tu poses autant de jetons que tu veux).');

            // la mise est PAR pari : on debite le total d'un coup
            const bal = await eco.balance(ctx.user.id);
            const each = /^(all|tout|max)$/i.test(amount) ? Math.floor(bal / ids.length) : /^(half|moiti)/i.test(amount) ? Math.floor(bal / 2 / ids.length) : eco.parseAmount(amount, bal);
            if (!each) return ctx.fail(bal ? 'Mise invalide (nombre, `all`, `half`, `1k`...).' : `Tu n'as plus un ${RB()}... \`${config.prefix}rsa\`, \`${config.prefix}work\` ou \`${config.prefix}daily\` !`);
            const placed = await casino.placeBet(ctx, String(each * ids.length), 'gamble', 1_000);
            if (!placed) return;
            const { bet, allin } = placed;
            const bets = ids.map((id) => ({ id, amount: each }));

            const n = rl.spin(Math.random);
            const { payout, wins } = rl.settle(bets, n);
            const { net, bal: after, cut, debt } = await casino.settle(ctx, bet, payout);

            const label = (id) => { const d = rl.BETS.get(id); return d.kind === 'simple' || d.kind === 'colonne' ? d.label : `${d.kind} ${d.label}`; };
            const title = ids.length === 1 ? `Roulette · ${fmt(bet)} sur ${label(ids[0])}` : `Roulette · ${ids.length} paris de ${fmt(each)} · ${fmt(bet)} au total`;
            const tease = rl.WHEEL[Math.floor(Math.random() * 37)];
            const msg = await ctx.reply({ embeds: [ui.gameEmbed(ctx, title).setDescription(`## ${wheelAround(tease)}\n🎡 La bille tourne...`)] });
            await sleep(1200);
            const st = ui.resultStyle(net, bet);
            const won = new Map(wins.map((w) => [w.id, w.pay]));
            const lines = ids.map((id) => (won.has(id) ? `✅ ${label(id)} → **+${fmt(won.get(id) - each)}**` : `❌ ${label(id)}`));
            const final = ui.gameEmbed(ctx, title, st.color)
                .setDescription(
                    `## ${wheelAround(n)}\n` +
                    `${st.tag} — la bille s'arrête sur ${pocket(n)}\n` +
                    `${ids.length > 1 ? `${lines.join('\n')}\n` : ''}${ui.signed(net)}${cut ? `\n🏦 La banque prend **${fmt(cut)}** · dette **${fmt(debt)}**` : ''}`,
                )
                .setFooter({ text: `Solde : ${fmt(after)}` });
            await casino.editReply(ctx, msg, { embeds: [final], components: [casino.replayRow(bet)] }).catch(() => {});
            // Rejouer garde les memes paris ; le montant du bouton est le total, on le redivise
            casino.listenReplay(ctx, msg, bet, (m) => ({ montant: m === 'all' ? 'all' : String(Math.max(1, Math.floor(Number(m) / ids.length))), paris: words.join(' ') }));
            await casino.after(ctx, { bet, net, allin, game: 'roulette' });
        },
    },
    {
        name: 'slots',
        aliases: ['slot', 'sl'],
        category: 'jeux',
        description: 'Machine a sous (777 = x2000)',
        usage: '<montant|all|half>',
        options: [{ name: 'montant', type: 'string', required: true, description: 'Mise' }],
        async run(ctx, { montant }) {
            const placed = await casino.placeBet(ctx, montant, 'slots', 1_000);
            if (!placed) return;
            const { bet, allin } = placed;

            const res = [spinReel(), spinReel(), spinReel()];
            const [a, b, c] = res;
            let payout = 0;
            let label;
            const jackpot = a.s === '7️⃣' && b.s === '7️⃣' && c.s === '7️⃣';
            await jackpotAdd(Math.max(1, Math.floor(bet * JACKPOT_CUT)));
            let pot = 0;
            if (a.s === b.s && b.s === c.s) {
                payout = bet * a.x3;
                if (jackpot && bet >= JACKPOT_MIN_BET) pot = await jackpotClaim();
                payout += pot;
                label = jackpot
                    ? `🚨🚨 **JACKPOT 777** 🚨🚨${pot ? `\n💎 Tu rafles le jackpot progressif : **${fmt(pot)}** ${RB()} !` : `\n-# (mise ${JACKPOT_MIN_BET}+ pour rafler le jackpot progressif...)`}`
                    : `**Triple ${a.s}** · x${a.x3}`;
            } else if (a.s === b.s || b.s === c.s || a.s === c.s) {
                payout = Math.floor(bet * PAIR_PAYOUT);
                label = 'Paire · tu récupères la moitié';
            } else label = 'Rien du tout';
            const { net, bal, cut, debt } = await casino.settle(ctx, bet, payout);

            const potNow = await jackpotGet();
            const title = `Slots · ${fmt(bet)}`;
            const jpLine = `💎 Jackpot progressif : **${fmt(potNow)}** ${RB()}${bet < JACKPOT_MIN_BET ? ` · *mise ${JACKPOT_MIN_BET}+ pour le gagner*` : ''}`;
            const frame = (reels, text, color = ui.COLORS.casino) => ui.gameEmbed(ctx, title, color)
                .setDescription(`${jpLine}\n## ┃ ${reels.join(' ┃ ')} ┃\n${text}`);
            const spinning = () => pick(REELS).s;
            const msg = await ctx.reply({ embeds: [frame([spinning(), spinning(), spinning()], '🎰 ça tourne...')] });
            await sleep(800);
            await casino.editReply(ctx, msg, { embeds: [frame([a.s, spinning(), spinning()], '🎰 ça tourne...')] }).catch(() => {});
            await sleep(700);
            await casino.editReply(ctx, msg, { embeds: [frame([a.s, b.s, spinning()], a.s === b.s ? '👀 ...' : '🎰 ça tourne...')] }).catch(() => {});
            await sleep(a.s === b.s ? 1200 : 700); // suspense quand les deux premiers matchent
            const st = ui.resultStyle(net, bet);
            await casino.editReply(ctx, msg, {
                embeds: [frame(res.map((r) => r.s), `${label}\n${ui.signed(net)}${cut ? `\n🏦 La banque prend **${fmt(cut)}** · dette **${fmt(debt)}**` : ''}`, jackpot ? ui.COLORS.bigwin : st.color).setFooter({ text: `Solde : ${fmt(bal)}` })],
                components: [casino.replayRow(bet)],
            }).catch(() => {});
            casino.listenReplay(ctx, msg, bet, (m) => ({ montant: m }));
            await casino.after(ctx, { bet, net, allin, jackpot, game: 'slots' });
        },
    },
    {
        name: 'duel',
        category: 'jeux',
        description: 'Duel pierre-feuille-ciseaux avec mise',
        usage: '<@user> <montant>',
        example: 'duel @rigel 200',
        options: [
            { name: 'membre', type: 'user', required: true, description: 'Ton adversaire' },
            { name: 'montant', type: 'string', required: true, description: 'Mise de chacun (0 = pour l\'honneur)' },
        ],
        async run(ctx, { membre: opp, montant }) {
            const me = ctx.user;
            if (opp.id === me.id || opp.bot) return ctx.fail('Choisis un vrai adversaire.');
            if (inDuel.has(me.id)) return ctx.fail('Tu es déjà dans un duel.');
            if (inDuel.has(opp.id)) return ctx.fail(`**${opp.username}** est déjà dans un duel.`);
            const myBal = await eco.balance(me.id);
            const amount = ['0', 'honneur'].includes(String(montant)) ? 0 : eco.parseAmount(montant, myBal);
            if (amount === null) return ctx.fail('Montant invalide, espèce d\'infâme troudbal.');
            if (amount > myBal) return ctx.fail(`Tu n'as pas assez de ${RB()} pour parier ${fmt(amount)}, pauvre troudbal.`);
            if (amount > (await eco.balance(opp.id))) return ctx.fail(`**${opp.username}** n'a pas assez de ${RB()} pour ce duel.`);

            inDuel.add(me.id);
            inDuel.add(opp.id);
            try {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('duel:yes').setLabel('Accepter').setEmoji('⚔️').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('duel:no').setLabel('Refuser').setEmoji('🏳️').setStyle(ButtonStyle.Danger),
                );
                const ask = await ctx.reply({
                    content: `${opp}, **${ctx.displayName}** te défie en duel pour **${fmt(amount)}** ${RB()} ! (60s)`,
                    components: [row],
                    allowedMentions: { users: [opp.id] },
                });
                const answer = await ask.awaitMessageComponent({
                    componentType: ComponentType.Button,
                    time: 60_000,
                    filter: async (i) => {
                        if (i.user.id === opp.id) return true;
                        if (i.user.id === me.id && i.customId === 'duel:no') return true; // le challenger peut annuler
                        await i.reply({ content: 'Ce duel ne te concerne pas.', flags: MessageFlags.Ephemeral }).catch(() => {});
                        return false;
                    },
                }).catch(() => null);

                if (!answer) return void (await casino.editReply(ctx, ask, { content: `⏱️ ${opp.username} n'a pas répondu. Duel annulé.`, components: [] }).catch(() => {}));
                if (answer.customId === 'duel:no') {
                    const who = answer.user.id === me.id ? `${ctx.displayName} a annulé` : `${opp.username} a refusé`;
                    return void (await answer.update({ content: `🏳️ ${who} le duel.`, components: [] }));
                }
                await answer.update({ content: `⚔️ **${opp.username}** accepte le duel !`, components: [] });

                // on bloque les deux mises tout de suite : plus possible de les depenser pendant le duel
                if (amount > 0) {
                    const locked = await db.tx(async (conn) => {
                        if (!(await eco.takeRb(me.id, amount, conn))) return `${ctx.displayName} n'a plus assez de ${RB()}`;
                        if (!(await eco.takeRb(opp.id, amount, conn))) throw Object.assign(new Error('opp'), { msg: `${opp.username} n'a plus assez de ${RB()}` });
                        return null;
                    }).catch((e) => e.msg || 'erreur');
                    if (locked) return ctx.channel.send(`❌ Duel annulé : ${locked}.`);
                }

                let winner = null;
                let loser = null;
                let last;
                for (let round = 1; round <= 3 && !winner; round++) {
                    last = await playRound(ctx, ctx.channel, me, opp, amount, round);
                    const { c1, c2 } = last;
                    if (!c1 && !c2) break;
                    if (c1 && !c2) [winner, loser] = [me, opp];
                    else if (!c1 && c2) [winner, loser] = [opp, me];
                    else if (beats(c1, c2)) [winner, loser] = [me, opp];
                    else if (beats(c2, c1)) [winner, loser] = [opp, me];
                    else if (round === 3) break;
                    else await ctx.channel.send(`🤝 Les deux ont joué ${RPS[c1]} **${c1}**, on rejoue !`);
                }

                if (!winner) {
                    if (amount > 0) {
                        await eco.addRb(me.id, amount);
                        await eco.addRb(opp.id, amount);
                    }
                    const why = !last?.c1 && !last?.c2 ? '⏱️ Personne n\'a joué' : '🤝 Égalité parfaite';
                    return ctx.channel.send({
                        embeds: [new EmbedBuilder().setColor('#bfaf75').setDescription(`${why}, les mises sont rendues.`)
                            .setImage('https://media1.tenor.com/m/A_LD8plpEMoAAAAC/yugioh-yugioh-duel-monsters.gif')],
                    });
                }

                const pay = amount > 0 ? await eco.addRb(winner.id, amount * 2) : { net: 0, cut: 0, debt: 0 };
                const wc = winner.id === me.id ? last.c1 : last.c2;
                const lc = winner.id === me.id ? last.c2 : last.c1;
                const how = lc ? `**${loser.username}** a joué ${RPS[lc]} **${lc}** mais **${winner.username}** a joué ${RPS[wc]} **${wc}**.. mskn!` : `**${loser.username}** n'a pas joué à temps... forfait !`;
                await ctx.channel.send({
                    embeds: [new EmbedBuilder()
                        .setColor('#6e90ff')
                        .setTitle(`🔥 ${winner.username} gagne le duel !`)
                        .setDescription(`${how}\n**+${fmt(pay.net)}** ${RB()} pour **${winner.username}**.${pay.cut ? `\n🏦 La banque prend **${fmt(pay.cut)}** · dette **${fmt(pay.debt)}**` : ''}`)
                        .setThumbnail(avatar(winner))
                        .setFooter({ text: `${me.username} VS ${opp.username}` })],
                });
                await db.exec('UPDATE profile SET duelwins = duelwins + 1 WHERE id_user = ?', [winner.id]);
                await progress.track({ user: winner, channel: ctx.channel }, { duel_win: 1, duel: 1 }, {});
                await progress.track({ user: loser, channel: ctx.channel }, { duel: 1 }, {});
            } finally {
                inDuel.delete(me.id);
                inDuel.delete(opp.id);
            }
        },
    },
];
