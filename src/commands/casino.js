// Blackjack, mines, crash et loto dans le chat. Meme raison que games.js :
// une activite Discord ne s'ouvre pas sur telephone, un message avec des boutons si.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const eco = require('../lib/economy');
const cd = require('../lib/cooldowns');
const casino = require('../lib/casino');
const loto = require('../lib/loto');
const ui = require('../lib/ui');
const { fmt, pick, sleep } = require('../lib/utils');

const RB = () => config.rbEmoji;
const notYours = (i) => i.reply({ content: 'C\'est pas ta partie 😉', flags: MessageFlags.Ephemeral }).catch(() => {});

// ===========================================================================
// BLACKJACK
// ===========================================================================
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const card = () => ({ r: pick(RANKS), s: pick(SUITS) });
function handValue(h) {
    let v = 0;
    let aces = 0;
    for (const c of h) {
        if (c.r === 'A') { v += 11; aces++; } else if (['J', 'Q', 'K'].includes(c.r)) v += 10;
        else v += Number(c.r);
    }
    while (v > 21 && aces) { v -= 10; aces--; }
    return v;
}
const showHand = (h) => h.map((c) => `\`${c.r}${c.s}\``).join(' ');

// ===========================================================================
// MINES
// ===========================================================================
const GRID = 20; // 4 lignes x 5
const MINES_EDGE = 0.97;
function minesMult(k, mines) {
    let m = MINES_EDGE;
    for (let i = 0; i < k; i++) m *= (GRID - i) / (GRID - mines - i);
    return k === 0 ? 1 : Math.floor(m * 100) / 100;
}

// ===========================================================================
// CRASH
// ===========================================================================
const CRASH_K = 0.09; // x2 a ~7.7s, x5 a ~18s, x10 a ~26s
const SPARK = '▁▂▃▄▅▆▇█';
function crashPoint() {
    const r = Math.random();
    const cp = Math.floor((97 / (1 - r))) / 100; // ~3% de crash instantane = avantage maison
    return Math.min(1000, Math.max(1, cp));
}
function sparkline(values) {
    const v = values.slice(-18);
    const max = Math.max(...v);
    const min = Math.min(...v);
    return v.map((x) => SPARK[max === min ? 0 : Math.round(((x - min) / (max - min)) * 7)]).join('');
}

module.exports = [
    // -----------------------------------------------------------------------
    {
        name: 'blackjack',
        aliases: ['bj'],
        category: 'jeux',
        description: 'Blackjack contre le croupier (BJ paye x2.5)',
        usage: '<montant|all|half>',
        options: [{ name: 'montant', type: 'string', required: true, description: 'Mise' }],
        async run(ctx, { montant }) {
            const placed = await casino.placeBet(ctx, montant, 'bj', 1_000);
            if (!placed) return;
            let { bet } = placed;
            const { allin } = placed;
            const player = [card(), card()];
            const dealer = [card(), card()];
            let doubled = false;

            const render = (reveal, text, color = ui.COLORS.casino) => {
                const pv = handValue(player);
                const dv = reveal ? handValue(dealer) : handValue([dealer[0]]);
                return ui.gameEmbed(ctx, `Blackjack · ${fmt(bet)}${doubled ? ' (doublé)' : ''}`, color)
                    .addFields(
                        { name: `Ta main · ${pv}`, value: showHand(player), inline: true },
                        { name: `Croupier · ${reveal ? dv : `${dv} + ?`}`, value: reveal ? showHand(dealer) : `${showHand([dealer[0]])} \`🂠\``, inline: true },
                    )
                    .setDescription(text || '');
            };
            const buttons = async () => {
                const canDouble = player.length === 2 && !doubled && (await eco.balance(ctx.user.id)) >= bet;
                return new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('bj:hit').setLabel('Tirer').setEmoji('🃏').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('bj:stand').setLabel('Rester').setEmoji('✋').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('bj:double').setLabel('Doubler').setEmoji('⏫').setStyle(ButtonStyle.Success).setDisabled(!canDouble),
                );
            };

            let msg;
            let finished = false;
            const finish = async (i, outcome) => {
                if (finished) return;
                finished = true;
                const pv = handValue(player);
                const dv = handValue(dealer);
                const natural = outcome === 'blackjack';
                const payout = { blackjack: Math.floor(bet * 2.5), win: bet * 2, push: bet, lose: 0, bust: 0 }[outcome];
                const { net, bal, cut, debt } = await casino.settle(ctx, bet, payout);
                const text = {
                    blackjack: '🂡 **BLACKJACK !** Payé x2.5',
                    win: dv > 21 ? `Le croupier saute (${dv}) !` : `${pv} contre ${dv}, tu gagnes !`,
                    push: `${pv} partout, mise rendue.`,
                    lose: dealer.length === 2 && dv === 21 ? 'Le croupier a un blackjack 💀' : `${dv} contre ${pv}, le croupier gagne.`,
                    bust: `Tu sautes avec ${pv} 💥`,
                }[outcome];
                const st = ui.resultStyle(net, bet);
                const payload = { embeds: [render(true, `${st.tag} — ${text}\n${ui.signed(net)}${cut ? `\n🏦 La banque prend **${fmt(cut)}** · dette **${fmt(debt)}**` : ''}`, st.color).setFooter({ text: `Solde : ${fmt(bal)}` })], components: [casino.replayRow(bet / (doubled ? 2 : 1))] };
                if (i) await i.update(payload).catch(() => {});
                else await casino.editReply(ctx, msg, payload).catch(() => {});
                casino.listenReplay(ctx, msg, bet / (doubled ? 2 : 1), (m) => ({ montant: m }));
                await casino.after(ctx, { bet, net, allin, blackjack: natural, game: 'blackjack' });
            };
            const dealerPlays = () => {
                while (handValue(dealer) < 17) dealer.push(card());
                const pv = handValue(player);
                const dv = handValue(dealer);
                if (dv > 21 || pv > dv) return 'win';
                if (pv === dv) return 'push';
                return 'lose';
            };

            // blackjacks naturels
            const pBJ = handValue(player) === 21;
            const dBJ = handValue(dealer) === 21;
            msg = await ctx.reply({ embeds: [render(false, '🃏 Distribution...')] });
            if (pBJ || dBJ) {
                await sleep(700);
                return finish(null, pBJ && dBJ ? 'push' : pBJ ? 'blackjack' : 'lose');
            }
            await casino.editReply(ctx, msg, { embeds: [render(false, 'Tirer, rester ou doubler ?')], components: [await buttons()] });

            const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 60_000, filter: (i) => i.customId.startsWith('bj:') });
            col.on('collect', async (i) => {
                if (i.user.id !== ctx.user.id) return notYours(i);
                const action = i.customId.split(':')[1];
                if (action === 'double') {
                    if (!(await eco.takeRb(ctx.user.id, bet))) return i.reply({ content: 'Pas assez pour doubler.', flags: MessageFlags.Ephemeral });
                    bet *= 2;
                    doubled = true;
                    player.push(card());
                    col.stop('done');
                    return finish(i, handValue(player) > 21 ? 'bust' : dealerPlays());
                }
                if (action === 'hit') {
                    player.push(card());
                    const v = handValue(player);
                    if (v > 21) { col.stop('done'); return finish(i, 'bust'); }
                    if (v === 21) { col.stop('done'); return finish(i, dealerPlays()); }
                    return i.update({ embeds: [render(false, 'Encore ?')], components: [await buttons()] });
                }
                col.stop('done');
                return finish(i, dealerPlays());
            });
            col.on('end', (_, reason) => {
                if (reason !== 'done' && !finished) finish(null, dealerPlays()); // inactif -> on reste
            });
        },
    },
    // -----------------------------------------------------------------------
    {
        name: 'mines',
        aliases: ['mn', 'bombes'],
        category: 'jeux',
        description: 'Evite les bombes, encaisse quand tu veux',
        usage: '<montant> [bombes 1-15]',
        example: 'mines 200 5',
        options: [
            { name: 'montant', type: 'string', required: true, description: 'Mise' },
            { name: 'bombes', type: 'integer', description: 'Nombre de bombes (3 par defaut)', min: 1, max: 15 },
        ],
        async run(ctx, { montant, bombes }) {
            const mines = Math.min(15, Math.max(1, Number(bombes) || 3));
            const placed = await casino.placeBet(ctx, montant, 'mines', 1_000);
            if (!placed) return;
            const { bet, allin } = placed;
            const bombSet = new Set();
            while (bombSet.size < mines) bombSet.add(Math.floor(Math.random() * GRID));
            const picked = new Set();
            let finished = false;
            let boom = null;

            const grid = (final) => Array.from({ length: 4 }, (_, r) => new ActionRowBuilder().addComponents(
                Array.from({ length: 5 }, (__, c) => {
                    const idx = r * 5 + c;
                    const b = new ButtonBuilder().setCustomId(`mn:${idx}`);
                    if (picked.has(idx)) return b.setEmoji('💎').setStyle(ButtonStyle.Success).setDisabled(true);
                    if (final && idx === boom) return b.setEmoji('💥').setStyle(ButtonStyle.Danger).setDisabled(true);
                    if (final && bombSet.has(idx)) return b.setEmoji('💣').setStyle(ButtonStyle.Danger).setDisabled(true);
                    return b.setEmoji(final ? '▪️' : '⬛').setStyle(ButtonStyle.Secondary).setDisabled(final);
                }),
            ));
            const control = () => {
                const k = picked.size;
                const cur = minesMult(k, mines);
                const next = minesMult(k + 1, mines);
                return new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('mn:cash').setLabel(k ? `Encaisser ${fmt(Math.floor(bet * cur))} (x${cur})` : 'Choisis une case').setEmoji('💰').setStyle(ButtonStyle.Success).setDisabled(k === 0),
                    new ButtonBuilder().setCustomId('mn:info').setLabel(`Prochaine : x${next}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                );
            };
            const embed = (text, color = ui.COLORS.casino) => ui.gameEmbed(ctx, `Mines · ${fmt(bet)} · ${mines} 💣`, color).setDescription(text);

            const msg = await ctx.reply({ embeds: [embed(`Trouve les 💎, évite les 💣 !\n${GRID - mines} cases sûres sur ${GRID}.`)], components: [...grid(false), control()] });

            const end = async (i, cashed) => {
                if (finished) return;
                finished = true;
                const k = picked.size;
                if (!cashed && k === 0 && boom === null) {
                    await casino.refund(ctx, bet);
                    const p = { embeds: [embed('⏱️ Partie annulée, mise rendue.', ui.COLORS.push)], components: [] };
                    return i ? i.update(p) : casino.editReply(ctx, msg, p).catch(() => {});
                }
                const mult = cashed ? minesMult(k, mines) : 0;
                const payout = Math.floor(bet * mult);
                const { net, bal, cut, debt } = await casino.settle(ctx, bet, payout);
                const st = ui.resultStyle(net, bet);
                const text = cashed
                    ? `${st.tag} — **${k}** case(s) · encaissé à **x${mult}**\n${ui.signed(net)}${cut ? `\n🏦 La banque prend **${fmt(cut)}** · dette **${fmt(debt)}**` : ''}`
                    : `💥 **BOUM** après ${k} case(s)...\n${ui.signed(net)}${cut ? `\n🏦 La banque prend **${fmt(cut)}** · dette **${fmt(debt)}**` : ''}`;
                const p = { embeds: [embed(text, cashed ? st.color : ui.COLORS.lose).setFooter({ text: `Solde : ${fmt(bal)}` })], components: [...grid(true), casino.replayRow(bet)] };
                if (i) await i.update(p).catch(() => {});
                else await casino.editReply(ctx, msg, p).catch(() => {});
                casino.listenReplay(ctx, msg, bet, (m) => ({ montant: m, bombes: mines }));
                await casino.after(ctx, { bet, net, allin, minesPicks: cashed ? k : 0, game: 'mines' });
            };

            const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 60_000, filter: (i) => i.customId.startsWith('mn:') });
            col.on('collect', async (i) => {
                if (i.user.id !== ctx.user.id) return notYours(i);
                const id = i.customId.split(':')[1];
                if (id === 'cash') { col.stop('done'); return end(i, true); }
                const idx = Number(id);
                if (bombSet.has(idx)) { boom = idx; col.stop('done'); return end(i, false); }
                picked.add(idx);
                if (picked.size === GRID - mines) { col.stop('done'); return end(i, true); }
                const k = picked.size;
                return i.update({ embeds: [embed(`💎 **${k}** · gain actuel **${fmt(Math.floor(bet * minesMult(k, mines)))}** ${RB()} (x${minesMult(k, mines)})\nTu continues ou t'encaisses ?`)], components: [...grid(false), control()] });
            });
            col.on('end', (_, reason) => { if (reason !== 'done') end(null, picked.size > 0); });
        },
    },
    // -----------------------------------------------------------------------
    {
        name: 'crash',
        aliases: ['cr', 'rocket'],
        category: 'jeux',
        description: 'Le multiplicateur monte... encaisse avant le crash',
        usage: '<montant> [auto-cashout ex: 2.5]',
        example: 'crash 300 2',
        options: [
            { name: 'montant', type: 'string', required: true, description: 'Mise' },
            { name: 'auto', type: 'string', description: 'Encaisse automatiquement a ce multiplicateur (ex: 2.5)' },
        ],
        async run(ctx, { montant, auto }) {
            const autoAt = auto ? parseFloat(String(auto).replace(',', '.').replace('x', '')) : null;
            if (auto && (!autoAt || autoAt < 1.01)) return ctx.fail('Auto-cashout invalide (minimum 1.01).');
            const placed = await casino.placeBet(ctx, montant, 'crash', 1_000);
            if (!placed) return;
            const { bet, allin } = placed;
            const cp = crashPoint();
            const history = [1];
            const title = `Crash · ${fmt(bet)}${autoAt ? ` · auto x${autoAt}` : ''}`;
            const btn = (disabled = false, label = 'Encaisser') => new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('cr:cash').setLabel(label).setEmoji('💸').setStyle(ButtonStyle.Success).setDisabled(disabled),
            );
            const live = (m) => ui.gameEmbed(ctx, title, ui.COLORS.info)
                .setDescription(`## 🚀 x${m.toFixed(2)}\n\`${sparkline(history)}\`\nGain si tu encaisses : **${fmt(Math.floor(bet * m))}** ${RB()}`);

            const msg = await ctx.reply({ embeds: [live(1)], components: [btn()] });
            const start = Date.now();
            const mAt = () => Math.floor(Math.exp(CRASH_K * ((Date.now() - start) / 1000)) * 100) / 100;
            let finished = false;

            const finish = async (i, cashAt) => {
                if (finished) return;
                finished = true;
                const payout = cashAt ? Math.floor(bet * cashAt) : 0;
                const { net, bal, cut, debt } = await casino.settle(ctx, bet, payout);
                const st = ui.resultStyle(net, bet);
                const text = cashAt
                    ? `## 💸 x${cashAt.toFixed(2)}\n${st.tag} — encaissé avant le crash (x${cp.toFixed(2)})\n${ui.signed(net)}${cut ? `\n🏦 La banque prend **${fmt(cut)}** · dette **${fmt(debt)}**` : ''}`
                    : `## 💥 CRASH x${cp.toFixed(2)}\nTrop gourmand...\n${ui.signed(net)}${cut ? `\n🏦 La banque prend **${fmt(cut)}** · dette **${fmt(debt)}**` : ''}`;
                history.push(cp);
                const p = {
                    embeds: [ui.gameEmbed(ctx, title, cashAt ? st.color : ui.COLORS.lose).setDescription(`${text}\n\`${sparkline(history)}\``).setFooter({ text: `Solde : ${fmt(bal)}` })],
                    components: [casino.replayRow(bet)],
                };
                if (i) await i.update(p).catch(() => {});
                else await casino.editReply(ctx, msg, p).catch(() => {});
                casino.listenReplay(ctx, msg, bet, (m) => ({ montant: m, auto: autoAt ? String(autoAt) : undefined }));
                await casino.after(ctx, { bet, net, allin, crashMult: cashAt || 0, game: 'crash' });
            };

            const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000, filter: (i) => i.customId === 'cr:cash' });
            col.on('collect', async (i) => {
                if (i.user.id !== ctx.user.id) return notYours(i);
                const m = mAt();
                col.stop('done');
                await finish(i, m < cp ? m : null);
            });

            if (cp <= 1) { col.stop('done'); return finish(null, null); } // crash instantane
            while (!finished) {
                await sleep(1300);
                if (finished) break;
                const m = mAt();
                if (autoAt && autoAt < cp && m >= autoAt) { col.stop('done'); await finish(null, autoAt); break; }
                if (m >= cp) { col.stop('done'); await finish(null, null); break; }
                history.push(m);
                await casino.editReply(ctx, msg, { embeds: [live(m)], components: [btn()] }).catch(() => {});
            }
        },
    },
    // -----------------------------------------------------------------------
    {
        name: 'loto',
        aliases: ['lottery', 'loterie'],
        category: 'jeux',
        description: `Loterie du serveur, tirage tous les jours a ${loto.LOTO_HOUR}h`,
        usage: '[nb tickets|max]',
        options: [{ name: 'tickets', type: 'string', description: `Nombre de tickets a acheter (${loto.TICKET} chacun)` }],
        async run(ctx, { tickets }) {
            if (tickets !== undefined) {
                const n = ['max', 'all'].includes(String(tickets).toLowerCase()) ? 'max' : tickets;
                const res = await loto.buy(ctx.user.id, n);
                if (res.error) return ctx.fail(res.error);
            }
            const { round, rows, total, pot } = await loto.state();
            const mine = Number(rows.find((r) => String(r.id_user) === ctx.user.id)?.tickets || 0);
            const top = await Promise.all(rows.slice(0, 5).map(async (r, i) => {
                const u = await ctx.client.users.fetch(String(r.id_user)).catch(() => null);
                return `${['🥇', '🥈', '🥉'][i] || '▫️'} ${u?.globalName || u?.username || '?'} — ${r.tickets} 🎟️ (${total ? ((r.tickets / total) * 100).toFixed(1) : 0}%)`;
            }));
            const when = loto.nextDraw();
            const embed = new EmbedBuilder()
                .setColor(ui.COLORS.bigwin)
                .setTitle(`🎟️ Loterie · tirage n°${round}`)
                .setDescription(
                    `## 💰 ${fmt(pot)} ${RB()}\nTirage ${ui.ts(when)} (${ui.ts(when, 't')})\n\n` +
                    `${tickets !== undefined ? '✅ Tickets achetés ! ' : ''}Tu as **${mine}** ticket(s)${mine && total ? ` · **${((mine / total) * 100).toFixed(1)}%** de chances` : ''}\n` +
                    `-# ${loto.TICKET} ${RB()} le ticket · max ${loto.MAX_TICKETS} · \`${config.prefix}loto 10\` ou \`${config.prefix}loto max\``,
                )
                .addFields({ name: `Participants (${rows.length})`, value: top.join('\n') || '*Personne... le premier a toutes les chances*' });
            await ctx.reply({ embeds: [embed] });
        },
    },
    // -----------------------------------------------------------------------
    {
        name: 'rsa',
        aliases: ['caf', 'chomage'],
        category: 'eco',
        description: 'Aide sociale si tu es a la rue (toutes les 4h)',
        async run(ctx) {
            const bal = await eco.balance(ctx.user.id);
            if (bal >= 100) return ctx.fail(`T'as **${fmt(bal)}** ${RB()}, t'es pas à la rue. Va \`${config.prefix}work\`.`);
            const left = await cd.take(ctx.user.id, 'rsa', 4 * 3600 * 1000);
            if (left) return ctx.fail(`La CAF revient ${ui.ts(Date.now() + left)}.`);
            const gain = 300 + Math.floor(Math.random() * 201);
            const pay = await eco.addRb(ctx.user.id, gain);
            const credit = require('../lib/credit');
            await ctx.reply(`🏛️ La CAF a versé **${fmt(pay.net)}** ${RB()} à **${ctx.displayName}**.${credit.note(pay.cut, pay.debt)} Ne gâche pas tout au casino. (Tu vas tout gâcher au casino.)`);
        },
    },
];
