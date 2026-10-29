const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { fmt, rankEmoji, nameOf, avatar } = require('../lib/utils');
const { paginate, chunk } = require('../lib/paginate');

const RB = () => config.rbEmoji;

const BOARDS = {
    capital: { title: () => `CAPITALISM RANKING · ${RB()}`, col: 'rb', color: '#f7ffcc', unit: () => RB() },
    insult: { title: () => 'INSULTER RANKING · 😤', col: 'insultcount', color: '#ffc7c7', unit: () => 'insultes' },
    rolls: { title: () => 'ROLLSCOUNT RANKING · 🎎', col: 'wacount', color: '#ffc7c7', unit: () => 'rolls' },
    mine: { title: () => 'TOP MINAGE · ⛏️', col: 'minecount', color: '#34a853', unit: () => `${RB()} minés` },
    pertes: { title: () => 'PERTE RANKING · 📉', col: 'pertecount', color: '#a8ffd8', unit: () => `${RB()} perdus` },
    gains: { title: () => 'GAINS CASINO · 📈', col: 'wincount', color: '#a8ffd8', unit: () => `${RB()} gagnés` },
    streak: { title: () => 'DAILY STREAK · 🔥', col: 'daily_streak', color: '#ff9f43', unit: () => 'jours' },
    niveau: { title: () => 'NIVEAUX · ⭐', col: 'xp', color: '#00d2ff', unit: () => 'XP', level: true },
    succes: { title: () => 'CHASSEURS DE SUCCÈS · 🏆', ach: true, color: '#ffd700', unit: () => 'succès' },
    winstreak: { title: () => 'MEILLEURE SÉRIE · 🔥', col: 'bestwinstreak', color: '#ff6b6b', unit: () => 'victoires d\'affilée' },
    esclaves: { title: () => 'EMPIRES · 🏭', col: 'slavecount', color: '#c8a8ff', unit: () => 'esclaves' },
    champions: { title: () => 'COLLECTIONNEURS · ⛓️', champions: true, color: '#ffa8c4', unit: () => 'champions' },
};

// =topc, =topi... restent des raccourcis vers le bon classement
const ALIAS_BOARD = {
    topl: 'niveau', toplvl: 'niveau', topsucces: 'succes',
    topc: 'capital', topcapital: 'capital',
    topi: 'insult', topinsult: 'insult',
    topr: 'rolls', toprolls: 'rolls',
    topm: 'mine', topminage: 'mine',
    topp: 'pertes', toppertes: 'pertes',
    topch: 'champions',
};

const BOARD_ALIASES = {
    l: 'niveau', lvl: 'niveau', level: 'niveau', xp: 'niveau', a: 'succes', ach: 'succes', serie: 'winstreak', ws: 'winstreak',
    c: 'capital', rb: 'capital', argent: 'capital', i: 'insult', insultes: 'insult', insults: 'insult',
    r: 'rolls', wa: 'rolls', m: 'mine', minage: 'mine', p: 'pertes', perte: 'pertes', g: 'gains',
    s: 'streak', daily: 'streak', e: 'esclaves', slaves: 'esclaves', ch: 'champions', champs: 'champions',
};

async function rows(board) {
    if (board.ach) {
        return db.q('SELECT id_user, COUNT(*) AS v FROM achievements GROUP BY id_user ORDER BY v DESC LIMIT 50');
    }
    if (board.champions) {
        return db.q(
            `SELECT belong AS id_user, COUNT(*) AS v FROM champions
             WHERE belong IS NOT NULL AND belong != '' GROUP BY belong ORDER BY v DESC LIMIT 50`,
        );
    }
    return db.q(
        `SELECT id_user, ${board.col} AS v FROM profile
         WHERE id_user != ? AND ${board.col} > 0 ORDER BY ${board.col} DESC LIMIT 50`,
        [config.casinoId],
    );
}

async function buildPages(ctx, key) {
    const board = BOARDS[key];
    const list = await rows(board);
    if (!list.length) return [];
    const lines = await Promise.all(list.map(async (r, i) => {
        const name = await nameOf(ctx.client, ctx.guild, r.id_user);
        const me = String(r.id_user) === ctx.user.id ? ' ⬅️' : '';
        const val = board.level ? `niv. **${require('../lib/progress').levelInfo(r.v).level}** · ${fmt(r.v)} XP` : `**${fmt(r.v)}** ${board.unit()}`;
        return `${rankEmoji(i)} · ${i + 1}. ${name} — ${val}${me}`;
    }));
    const myPos = list.findIndex((r) => String(r.id_user) === ctx.user.id);
    const top1 = await ctx.client.users.fetch(String(list[0].id_user)).catch(() => null);
    const pages = chunk(lines, 10);
    return pages.map((p, k) => new EmbedBuilder()
        .setTitle(board.title())
        .setDescription(p.join('\n'))
        .setColor(board.color)
        .setThumbnail(top1 ? avatar(top1, 128) : null)
        .setFooter({
            text: `${ctx.displayName}${myPos >= 0 ? ` · tu es #${myPos + 1}` : ''}${pages.length > 1 ? ` · page ${k + 1}/${pages.length}` : ''}`,
            iconURL: avatar(ctx.user),
        })
        .setTimestamp());
}

module.exports = [
    {
        name: 'top',
        aliases: Object.keys(ALIAS_BOARD),
        category: 'top',
        description: 'Classements du serveur',
        usage: `<${Object.keys(BOARDS).join('|')}>`,
        options: [{ name: 'classement', type: 'string', description: 'Quel classement', choices: Object.keys(BOARDS) }],
        async run(ctx, { classement }) {
            let key = ALIAS_BOARD[ctx.alias];
            if (!key) {
                const k = (classement || 'capital').toLowerCase();
                key = BOARDS[k] ? k : BOARD_ALIASES[k];
            }
            if (!key) return ctx.fail(`Classements dispo : ${Object.keys(BOARDS).map((b) => `\`${b}\``).join(' · ')}`);
            const pages = await buildPages(ctx, key);
            if (!pages.length) return ctx.reply('Personne dans ce classement pour l\'instant.');
            await paginate(ctx, pages, { send: 'send' });
        },
    },
    {
        name: 'slipbank',
        aliases: ['casino'],
        category: 'top',
        description: 'La banque du slip et les plus gros perdants',
        async run(ctx) {
            const [casino] = await db.q('SELECT rb FROM profile WHERE id_user = ?', [config.casinoId]);
            const losers = await db.q(
                'SELECT id_user, pertecount AS v FROM profile WHERE id_user != ? AND pertecount > 0 ORDER BY pertecount DESC LIMIT 7',
                [config.casinoId],
            );
            const lines = await Promise.all(losers.map(async (r, i) =>
                `${['🥇', '🥈', '🥉'][i] || '🔻'} ${i + 1}. ${await nameOf(ctx.client, ctx.guild, r.id_user)} — **${fmt(r.v)}** ${RB()} perdus`));
            const embed = new EmbedBuilder()
                .setTitle('PERTE RANKING · 📉')
                .setDescription(
                    `🏦 **La banque du slip possède ${fmt(casino?.rb || 0)}** ${RB()}.\n\n` +
                    `💸 **Les plus grands perdants :**\n${lines.join('\n') || '*personne, bande de lâches*'}`,
                )
                .setThumbnail(require('../lib/media').ok(config.content.slipbankThumbnail))
                .setColor('#a8ffd8');
            await ctx.send({ embeds: [embed] });
        },
    },
];
