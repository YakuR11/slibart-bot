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
// Roulette (=gamble)
// ---------------------------------------------------------------------------
const COLORS = { r: 'red', red: 'red', rouge: 'red', b: 'black', black: 'black', noir: 'black', n: 'black', g: 'green', green: 'green', vert: 'green', v: 'green' };
const COLOR_EMOJI = { red: '🔴', black: '⚫', green: '🟢' };
const GREEN_CHANCE = 1 / 15;
const GREEN_PAYOUT = 14;

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

const STRIP = ['🔴', '⚫', '🔴', '⚫', '🟢', '⚫', '🔴', '⚫', '🔴', '⚫', '🔴', '⚫', '🔴', '⚫', '🔴'];
/** bande de roulette centree sur une case de la couleur voulue : ⚫🔴⚫ ▸🔴◂ ⚫🔴⚫ */
const stripAround = (emoji) => {
    const spots = STRIP.map((e, i) => (e === emoji ? i : -1)).filter((i) => i >= 0);
    const i = pick(spots);
    const at = (k) => STRIP[(i + k + STRIP.length) % STRIP.length];
    return `${at(-3)}${at(-2)}${at(-1)} ▸${at(0)}◂ ${at(1)}${at(2)}${at(3)}`;
};

module.exports = [
    {
        name: 'gamble',
        aliases: ['g', 'roulette'],
        category: 'jeux',
        description: 'Roulette : rouge/noir x2, vert x14',
        usage: '<red|black|green> <montant|all|half>',
        example: 'gamble r 500',
        options: [
            {
                name: 'couleur', type: 'string', required: true, description: 'Couleur',
                choices: [{ name: '🔴 rouge (x2)', value: 'red' }, { name: '⚫ noir (x2)', value: 'black' }, { name: '🟢 vert (x14, 1/15)', value: 'green' }],
            },
            { name: 'montant', type: 'string', required: true, description: 'Nombre, all, half, 1k...' },
        ],
        async run(ctx, { couleur, montant }) {
            const color = COLORS[couleur.toLowerCase()];
            if (!color) return ctx.fail('Couleur : `red`/`r`, `black`/`b` ou `green`/`g`.');
            const placed = await casino.placeBet(ctx, montant, 'gamble', 1_000);
            if (!placed) return;
            const { bet, allin } = placed;

            const outcome = color === 'green'
                ? (Math.random() < GREEN_CHANCE ? 'green' : pick(['red', 'black']))
                : (Math.random() < 0.5 ? 'red' : 'black');
            const won = outcome === color;
            const payout = won ? bet * (color === 'green' ? GREEN_PAYOUT : 2) : 0;
            const { net, bal, cut, debt } = await casino.settle(ctx, bet, payout);

            const spin = ui.gameEmbed(ctx, `Roulette · ${fmt(bet)} sur ${COLOR_EMOJI[color]}`)
                .setDescription(`## ${stripAround(pick(STRIP))}\n🎡 La bille tourne...`);
            const msg = await ctx.reply({ embeds: [spin] });
            await sleep(1100);
            const st = ui.resultStyle(net, bet);
            const final = ui.gameEmbed(ctx, `Roulette · ${fmt(bet)} sur ${COLOR_EMOJI[color]}`, st.color)
                .setDescription(
                    `## ${stripAround(COLOR_EMOJI[outcome])}\n` +
                    `${st.tag} — c'est tombé sur ${COLOR_EMOJI[outcome]} **${outcome}**\n${ui.signed(net)}${cut ? `\n🏦 La banque prend **${fmt(cut)}** · dette **${fmt(debt)}**` : ''}`,
                )
                .setFooter({ text: `Solde : ${fmt(bal)}` });
            await casino.editReply(ctx, msg, { embeds: [final], components: [casino.replayRow(bet)] }).catch(() => {});
            casino.listenReplay(ctx, msg, bet, (m) => ({ couleur: color, montant: m }));
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
