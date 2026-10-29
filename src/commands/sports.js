const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const eco = require('../lib/economy');
const ui = require('../lib/ui');
const sports = require('../lib/sports');
const { fmt, normalize } = require('../lib/utils');
const config = require('../config');

const RB = () => config.rbEmoji;
const EPHEMERAL = { flags: MessageFlags.Ephemeral };
const PRESETS = [
    { key: '100', label: '100' },
    { key: '500', label: '500' },
    { key: '1000', label: '1k' },
    { key: '5000', label: '5k' },
    { key: 'all', label: 'Tout' },
];

const clip = (s, n) => {
    const t = String(s);
    return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

function pickOf(raw, match) {
    const s = normalize(String(raw || '').trim());
    if (!s) return null;
    if (['1', 'home', 'dom', 'domicile'].includes(s)) return '1';
    if (['n', 'x', 'nul', 'null', 'draw'].includes(s)) return 'N';
    if (['2', 'away', 'ext', 'exterieur'].includes(s)) return '2';
    const home = normalize(match.home);
    const away = normalize(match.away);
    const hit = (name) => name === s || (s.length >= 3 && (name.startsWith(s) || name.includes(s)));
    const h = hit(home);
    const a = hit(away);
    if (h && !a) return '1';
    if (a && !h) return '2';
    return null;
}

function line(m) {
    const when = m.status === 'live' ? '🔴 LIVE' : ui.ts(Number(m.start_at), 'f');
    const score = m.status === 'live' && m.home_score != null ? ` **${m.home_score}-${m.away_score}**` : '';
    const bits = [`\`1\` ${Number(m.odd_home) ? Number(m.odd_home).toFixed(2) : '—'}`];
    if (m.source === 'foot') bits.push(`\`N\` ${Number(m.odd_draw) ? Number(m.odd_draw).toFixed(2) : '—'}`);
    bits.push(`\`2\` ${Number(m.odd_away) ? Number(m.odd_away).toFixed(2) : '—'}`);
    const tag = m.source === 'lol' ? '🎮' : '⚽';
    const extra = m.detail ? ` · ${m.detail}` : '';
    return `**#${m.id}** ${tag} ${m.competition}${extra}\n${when}${score}\n**${m.home}** vs **${m.away}**\n${bits.join('  ·  ')}`;
}

async function upcoming(source) {
    return db.q(
        `SELECT * FROM sport_matches
         WHERE status IN ('upcoming', 'live')
           AND start_at > ?
           ${source ? 'AND source = ?' : ''}
         ORDER BY status = 'live' DESC, start_at ASC
         LIMIT 12`,
        source ? [Date.now() - 8 * 3600 * 1000, source] : [Date.now() - 8 * 3600 * 1000],
    );
}

function canBet(m) {
    return sports.betsOpen(m) && (Number(m.odd_home) > 1 || Number(m.odd_away) > 1);
}

function matchMenu(rows) {
    const open = rows.filter(canBet).slice(0, 25);
    if (!open.length) return null;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('sp:sel')
            .setPlaceholder('Clique un match')
            .addOptions(open.map((m) => {
                const odds = [m.odd_home, m.source === 'foot' ? m.odd_draw : null, m.odd_away]
                    .filter((n) => Number(n) > 1)
                    .map((n) => Number(n).toFixed(2))
                    .join(' · ');
                return {
                    label: clip(`${m.home} vs ${m.away}`, 100),
                    description: clip(`${m.competition}${odds ? ` · ${odds}` : ''}`, 100),
                    value: String(m.id),
                    emoji: m.source === 'lol' ? '🎮' : '⚽',
                };
            })),
    );
}

function sideName(match, pick) {
    if (pick === '1') return match.home;
    if (pick === '2') return match.away;
    return 'Nul';
}

function teamRow(match, stakeKey) {
    const buttons = [];
    const add = (pick, odd, style) => {
        if (!(Number(odd) > 1)) return;
        buttons.push(new ButtonBuilder()
            .setCustomId(`sp:go:${match.id}:${pick}:${stakeKey}`)
            .setLabel(clip(`${sideName(match, pick)} · ${Number(odd).toFixed(2)}`, 80))
            .setStyle(style));
    };
    add('1', match.odd_home, ButtonStyle.Primary);
    add('N', match.odd_draw, ButtonStyle.Secondary);
    add('2', match.odd_away, ButtonStyle.Success);
    return buttons.length ? new ActionRowBuilder().addComponents(buttons) : null;
}

function stakeRow(match, stakeKey) {
    return new ActionRowBuilder().addComponents(PRESETS.map((p) => new ButtonBuilder()
        .setCustomId(`sp:stk:${match.id}:${p.key}`)
        .setLabel(p.label)
        .setStyle(p.key === stakeKey ? ButtonStyle.Primary : ButtonStyle.Secondary)));
}

function stakeText(stakeKey) {
    if (stakeKey === 'all') return 'tout ton solde';
    return `**${fmt(Number(stakeKey))}** ${RB()}`;
}

function betEmbed(match, stakeKey) {
    const when = match.status === 'live' ? '🔴 LIVE' : ui.ts(Number(match.start_at), 'f');
    return new EmbedBuilder()
        .setColor(ui.COLORS.info)
        .setTitle(`${match.home} vs ${match.away}`)
        .setDescription(
            `${match.source === 'lol' ? '🎮' : '⚽'} ${match.competition}${match.detail ? ` · ${match.detail}` : ''}\n${when}\n\n` +
            `Mise : ${stakeText(stakeKey)}\nClique qui gagne.`,
        );
}

async function showBet(interaction, matchId, stakeKey, fresh) {
    const rows = await db.q('SELECT * FROM sport_matches WHERE id = ? LIMIT 1', [matchId]);
    const match = rows[0];
    const key = PRESETS.some((p) => p.key === stakeKey) ? stakeKey : '500';
    if (!match || !canBet(match)) {
        const payload = { content: 'Les mises sont fermées sur ce match.', embeds: [], components: [] };
        if (fresh) return interaction.reply({ ...payload, ...EPHEMERAL });
        return interaction.update(payload);
    }
    const teams = teamRow(match, key);
    if (!teams) {
        const payload = { content: 'Pas encore de cote sur ce match.', embeds: [], components: [] };
        if (fresh) return interaction.reply({ ...payload, ...EPHEMERAL });
        return interaction.update(payload);
    }
    const payload = { content: '', embeds: [betEmbed(match, key)], components: [teams, stakeRow(match, key)] };
    if (fresh) return interaction.reply({ ...payload, ...EPHEMERAL });
    return interaction.update(payload);
}

/** Pose le ticket. Retourne la cote figée, ou un code d'erreur. */
async function placeTicket(userId, matchId, pick, amountRaw) {
    const bal = await eco.balance(userId);
    let stake = eco.parseAmount(amountRaw, bal);
    if (!stake) return { error: bal ? 'Mise invalide.' : `Tu n'as plus un ${RB()}.` };
    if (stake < sports.MIN_STAKE) return { error: `Mise minimum : **${fmt(sports.MIN_STAKE)}** ${RB()}.` };
    const capped = stake > sports.MAX_STAKE;
    if (capped) stake = sports.MAX_STAKE;
    try {
        const placed = await db.tx(async (conn) => {
            const [fresh] = await conn.query('SELECT * FROM sport_matches WHERE id = ? FOR UPDATE', [matchId]);
            const m = fresh[0];
            if (!m || !sports.betsOpen(m)) return 'closed';
            if (pick === 'N' && m.source !== 'foot') return 'nodraw';
            const locked = sports.oddOf(m, pick);
            if (!locked) return 'noodds';
            const ok = await eco.takeRb(userId, stake, conn);
            if (!ok) return 'broke';
            await conn.query(
                'INSERT INTO sport_bets (id_user, match_id, pick, stake, odds, status, payout, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
                [String(userId), matchId, pick, stake, locked, 'open', Date.now()],
            );
            return { odds: locked, match: m };
        });
        if (typeof placed === 'string') return { error: placed, bal };
        return { ...placed, stake, capped, bal };
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return { error: 'dup' };
        throw e;
    }
}

function failText(code, bal) {
    if (code === 'closed') return 'Les mises sont fermées sur ce match.';
    if (code === 'nodraw') return 'Pas de match nul en LoL.';
    if (code === 'noodds') return 'Pas de cote sur ce choix.';
    if (code === 'broke') return `Tu n'as que **${fmt(bal)}** ${RB()}.`;
    if (code === 'dup') return 'Tu as déjà un ticket sur ce match.';
    return code;
}

async function handleComponent(interaction) {
    const id = String(interaction.customId);
    if (interaction.isStringSelectMenu() && id === 'sp:sel') {
        await showBet(interaction, interaction.values[0], '500', true);
        const menu = interaction.component;
        if (menu) {
            await interaction.message.edit({
                components: [new ActionRowBuilder().addComponents(StringSelectMenuBuilder.from(menu).setPlaceholder('Clique un match'))],
            }).catch(() => {});
        }
        return;
    }
    const parts = id.split(':');
    if (parts[1] === 'stk') return showBet(interaction, parts[2], parts[3], false);
    if (parts[1] !== 'go') return;
    const [, , matchId, pick, amount] = parts;
    await interaction.deferUpdate();
    const result = await placeTicket(interaction.user.id, matchId, pick, amount === 'all' ? 'all' : amount);
    if (result.error) {
        return interaction.editReply({ content: `❌ ${failText(result.error, result.bal)}`, embeds: [], components: [] });
    }
    const label = sideName(result.match, pick);
    const win = Math.floor(result.stake * result.odds);
    const embed = new EmbedBuilder()
        .setColor(ui.COLORS.casino)
        .setTitle('Ticket pris')
        .setDescription(
            `**${result.match.home}** vs **${result.match.away}**\n\n` +
            `**${label}** à **${Number(result.odds).toFixed(2)}**\n` +
            `Mise : **${fmt(result.stake)}** ${RB()}${result.capped ? ` (plafond ${fmt(sports.MAX_STAKE)})` : ''}\n` +
            `Si ça passe : **${fmt(win)}** ${RB()}`,
        );
    return interaction.editReply({ content: '', embeds: [embed], components: [] });
}

module.exports = [
    {
        name: 'matchs',
        aliases: ['matches', 'cotes'],
        category: 'sport',
        description: 'Clique un match, puis qui gagne',
        usage: '[foot|lol]',
        example: 'matchs lol',
        options: [{ name: 'filtre', type: 'string', description: 'foot ou lol' }],
        async run(ctx, { filtre }) {
            const f = normalize(filtre || '');
            let source = null;
            if (['foot', 'football', 'soccer'].includes(f)) source = 'foot';
            else if (['lol', 'league', 'esport', 'worlds', 'lec'].includes(f)) source = 'lol';
            else if (f) return ctx.fail('Filtre : `foot` ou `lol`.');
            const rows = await upcoming(source);
            if (!rows.length) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setColor(ui.COLORS.info)
                        .setTitle('⚽ Paris')
                        .setDescription('Aucun gros match en vue pour l\'instant. Le calendrier se met à jour tout seul, réessaie dans quelques minutes.')],
                });
            }
            const menu = matchMenu(rows);
            const embed = new EmbedBuilder()
                .setColor(ui.COLORS.info)
                .setTitle(source === 'lol' ? '🎮 Worlds, LEC, MSI' : source === 'foot' ? '⚽ Gros championnats' : '⚽ Paris · foot et LoL')
                .setDescription(rows.map(line).join('\n\n').slice(0, 4000))
                .setFooter({ text: menu ? 'Clique un match dans le menu, puis qui gagne. Mise de base : 500.' : 'Cotes pas encore là.' });
            return ctx.reply({ embeds: [embed], components: menu ? [menu] : [] });
        },
    },
    {
        name: 'parier',
        aliases: ['bet'],
        category: 'sport',
        description: 'Mise en tapant. Sinon clique dans =matchs',
        usage: '<n°> <1|N|2> <mise>',
        example: 'parier 12 1 500',
        options: [
            { name: 'numero', type: 'integer', required: true, description: 'Numéro du match' },
            { name: 'choix', type: 'string', required: true, description: '1, N, 2 ou le nom de l\'équipe' },
            { name: 'montant', type: 'string', required: true, description: 'Mise (nombre, 1k, half, all)' },
        ],
        async run(ctx, { numero, choix, montant }) {
            const id = Number(numero);
            const rows = await db.q('SELECT * FROM sport_matches WHERE id = ? LIMIT 1', [id]);
            const match = rows[0];
            if (!match) return ctx.fail(`Match #${id} introuvable. \`${config.prefix}matchs\` pour la liste.`);
            const pick = pickOf(choix, match);
            if (!pick) return ctx.fail('Choix : `1`, `N` ou `2`, ou le nom de l\'équipe.');
            const result = await placeTicket(ctx.user.id, id, pick, montant);
            if (result.error) return ctx.fail(failText(result.error, result.bal));
            const win = Math.floor(result.stake * result.odds);
            const embed = new EmbedBuilder()
                .setColor(ui.COLORS.casino)
                .setAuthor({ name: `${ctx.displayName} · ticket` })
                .setDescription(
                    `**${match.home}** vs **${match.away}**\n${match.competition}\n\n` +
                    `Choix : **${sideName(match, pick)}** à **${Number(result.odds).toFixed(2)}**\n` +
                    `Mise : **${fmt(result.stake)}** ${RB()}${result.capped ? ` (plafond ${fmt(sports.MAX_STAKE)})` : ''}\n` +
                    `Si ça passe : **${fmt(win)}** ${RB()}`,
                )
                .setFooter({ text: `#${match.id} · cote figée` });
            return ctx.reply({ embeds: [embed] });
        },
    },
    {
        name: 'mesparis',
        aliases: ['tickets', 'mybets'],
        category: 'sport',
        description: 'Tes tickets en cours et les derniers réglés',
        async run(ctx) {
            const rows = await db.q(
                `SELECT b.pick, b.stake, b.odds, b.status, b.payout, m.home, m.away, m.competition, m.start_at
                 FROM sport_bets b JOIN sport_matches m ON m.id = b.match_id
                 WHERE b.id_user = ?
                 ORDER BY b.created_at DESC
                 LIMIT 10`,
                [String(ctx.user.id)],
            );
            if (!rows.length) return ctx.reply(`Aucun ticket. \`${config.prefix}matchs\` pour voir les matchs.`);
            const tag = { open: '⏳', won: '✅', lost: '💀', void: '↩️' };
            const body = rows.map((r) => {
                const side = r.pick === '1' ? r.home : r.pick === '2' ? r.away : 'Nul';
                const money = r.status === 'open'
                    ? `mise ${fmt(r.stake)} → ${fmt(Math.floor(Number(r.stake) * Number(r.odds)))}`
                    : r.status === 'won'
                        ? `+${fmt(Number(r.payout) - Number(r.stake))}`
                        : r.status === 'void'
                            ? 'remboursé'
                            : `-${fmt(r.stake)}`;
                return `${tag[r.status] || '•'} **${r.home}** vs **${r.away}** · ${side} @ ${Number(r.odds).toFixed(2)}\n${money} ${RB()} · ${r.competition}`;
            }).join('\n\n');
            return ctx.reply({
                embeds: [new EmbedBuilder().setColor(ui.COLORS.info).setTitle('🎟️ Tes paris').setDescription(body.slice(0, 4000))],
            });
        },
    },
];

module.exports.handleComponent = handleComponent;
