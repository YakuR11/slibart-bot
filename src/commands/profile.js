const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
const media = require('../lib/media');
const progress = require('../lib/progress');
const ui = require('../lib/ui');
const { fmt, avatar, isUrl, displayName } = require('../lib/utils');

const C = config.content;

/** Badges calcules a la volee (avant le badge Toxic King n'etait jamais attribue) */
async function badgesFor(p) {
    const tops = await db.q(
        `SELECT
            (SELECT id_user FROM profile WHERE id_user != ? ORDER BY rb DESC LIMIT 1) AS rich,
            (SELECT id_user FROM profile WHERE insultcount > 0 ORDER BY insultcount DESC LIMIT 1) AS toxic,
            (SELECT id_user FROM profile WHERE minecount > 0 ORDER BY minecount DESC LIMIT 1) AS miner,
            (SELECT id_user FROM profile WHERE wacount > 0 ORDER BY wacount DESC LIMIT 1) AS roller,
            (SELECT id_user FROM profile WHERE pertecount > 0 ORDER BY pertecount DESC LIMIT 1) AS loser`,
        [config.casinoId],
    );
    const t = tops[0] || {};
    const me = p.id_user;
    const b = [];
    if (String(t.rich) === me) b.push('👑 **Capitaliste suprême**');
    if (String(t.toxic) === me) b.push('🤬 **Toxic King**');
    if (String(t.miner) === me) b.push('⛏️ **Mineur en chef**');
    if (String(t.roller) === me) b.push('🎎 **Roll addict**');
    if (String(t.loser) === me) b.push('🎰 **Ami du casino**');
    if (p.daily_streak >= 7) b.push(`🔥 **Streak ${p.daily_streak}j**`);
    if (p.slavecount >= 15) b.push('🏭 **Magnat**');
    return b;
}

async function setField(ctx, field, raw) {
    const value = String(raw || '').trim();
    let final = value;
    if (field === 'img') {
        const n = parseInt(value, 10);
        if (['reset', 'default', 'defaut'].includes(value.toLowerCase())) final = null;
        else if (String(n) === value && n >= 1 && n <= C.presetProfileImages.length) final = C.presetProfileImages[n - 1];
        else if (isUrl(value)) final = value;
        else {
            return ctx.reply({
                content: `Donne un numéro entre 1 et ${C.presetProfileImages.length} ou un lien d'image (\`${config.prefix}set img 3\` / \`${config.prefix}set img https://...\`).`,
                files: media.ok(C.presetProfileImagesPreview) ? [C.presetProfileImagesPreview] : [],
            }).catch(() => ctx.reply(`Donne un numéro entre 1 et ${C.presetProfileImages.length} ou un lien d'image.`));
        }
        if (final && /cdn\.discordapp\.com|media\.discordapp\.net/.test(final)) {
            await ctx.whisper('⚠️ Les liens Discord expirent au bout de 24h, ton image va disparaître. Héberge-la ailleurs (imgur, image-heberg...).');
        }
    } else if (field === 'acc') {
        if (value.length > 100) return ctx.fail('100 caractères max pour l\'accroche.');
    } else if (field === 'bio') {
        if (value.length > 1000) return ctx.fail('1000 caractères max pour la bio.');
    }
    await db.ensureProfile(ctx.user.id);
    await db.exec(`UPDATE profile SET ${field} = ? WHERE id_user = ?`, [final, ctx.user.id]);
    return ctx.react('🔥');
}

module.exports = [
    {
        name: 'profile',
        aliases: ['p', 'profil'],
        category: 'profil',
        description: 'Affiche un profil',
        usage: '[@user]',
        options: [{ name: 'membre', type: 'user', description: 'Membre (toi par defaut)' }],
        async run(ctx, { membre }) {
            const user = membre || ctx.user;
            if (user.bot && user.id !== ctx.client.user.id) return ctx.fail('Les bots n\'ont pas de profil.');
            const member = ctx.guild?.members.cache.get(user.id) || (await ctx.guild?.members.fetch(user.id).catch(() => null));
            const p = await db.getProfile(user.id);
            const [{ pos }] = await db.q(
                'SELECT COUNT(*) + 1 AS pos FROM profile WHERE rb > ? AND id_user != ?',
                [p.rb, config.casinoId],
            );
            const [{ champs }] = await db.q('SELECT COUNT(*) AS champs FROM champions WHERE belong = ?', [user.id]);
            const badges = await badgesFor(p);
            const lvl = progress.levelInfo(p.xp);
            const [{ achs }] = await db.q('SELECT COUNT(*) AS achs FROM achievements WHERE id_user = ?', [user.id]);
            const games = p.gamblecount;

            const embed = new EmbedBuilder().setColor('#eeebff')
                .setTitle(`📋 · ${p.acc || displayName(user, member)}`)
                .setDescription(p.bio || '*Aucune bio définie.* ' + (user.id === ctx.user.id ? `(\`${config.prefix}set bio ...\`)` : ''))
                .addFields(
                    {
                        name: '💰 Capital',
                        value: `**${fmt(p.rb)}** ${config.rbEmoji}\nRang **#${pos}**`,
                        inline: true,
                    },
                    {
                        name: '📊 Stats',
                        value: `🎎 Rolls : **${fmt(p.wacount)}**\n😤 Insultes : **${fmt(p.insultcount)}**\n⛏️ Miné : **${fmt(p.minecount)}**`,
                        inline: true,
                    },
                    {
                        name: '🎰 Casino',
                        value: `Parties : **${fmt(games)}**\n📈 +${fmt(p.wincount)}\n📉 -${fmt(p.pertecount)}`,
                        inline: true,
                    },
                    {
                        name: '🏠 Empire',
                        value: `Caves : **${p.cavecount}**\nEsclaves : **${p.slavecount}**\n⛓️ Champions : **${champs}**`,
                        inline: true,
                    },
                    { name: '🏅 Badges', value: badges.length ? badges.join('\n') : 'Aucun badge', inline: true },
                    {
                        name: `⭐ Niveau ${lvl.level}`,
                        value: `\`${ui.bar(lvl.cur, lvl.need, 10)}\`\n${fmt(lvl.cur)}/${fmt(lvl.need)} XP\n🏆 ${achs}/${Object.keys(progress.ACHIEVEMENTS).length} succès`,
                        inline: true,
                    },
                )
                .setThumbnail(avatar(user))
                .setImage(p.img || media.ok(C.defaultProfileImage))
                .setFooter({ text: `demandé par ${ctx.displayName}`, iconURL: avatar(ctx.user) });
            await ctx.send({ embeds: [embed] });
        },
    },
    {
        name: 'set',
        category: 'profil',
        description: 'Modifie ton profil (image, accroche, bio)',
        usage: '<img|acc|bio> <valeur>',
        example: 'set bio je suis le plus cold du serveur',
        options: [
            {
                name: 'champ', type: 'string', required: true, description: 'Ce que tu modifies',
                choices: [{ name: 'image', value: 'img' }, { name: 'accroche (titre)', value: 'acc' }, { name: 'bio', value: 'bio' }],
            },
            { name: 'valeur', type: 'text', required: true, description: 'Numero d\'image 1-6, lien, ou texte. "reset" pour l\'image par defaut' },
        ],
        async run(ctx, { champ, valeur }) {
            const field = { image: 'img', titre: 'acc', accroche: 'acc' }[champ.toLowerCase()] || champ.toLowerCase();
            if (!['img', 'acc', 'bio'].includes(field)) return ctx.fail(`Utilisation : \`${config.prefix}set <img|acc|bio> <valeur>\``);
            return setField(ctx, field, valeur);
        },
    },
    // anciens raccourcis =setimg / =setbio / =setacc (prefixe seulement)
    ...['img', 'bio', 'acc'].map((field) => ({
        name: `set${field}`,
        category: 'profil',
        slash: false,
        hidden: true,
        options: [{ name: 'valeur', type: 'text' }],
        async run(ctx, { valeur }) {
            if (!valeur) {
                if (field === 'img') {
                    return ctx.reply({
                        content: `**${ctx.displayName}**, \`${config.prefix}setimg <numéro>\` ou \`${config.prefix}setimg <lien>\`. Les images prédéfinies :`,
                        files: media.ok(C.presetProfileImagesPreview) ? [C.presetProfileImagesPreview] : [],
                    }).catch(() => ctx.reply(`\`${config.prefix}setimg <numéro 1-6>\` ou \`${config.prefix}setimg <lien>\``));
                }
                return ctx.fail(`Utilisation : \`${config.prefix}set${field} <valeur>\``);
            }
            return setField(ctx, field, valeur);
        },
    })),
    {
        name: 'wacount',
        aliases: ['rolls'],
        category: 'profil',
        description: 'Combien de fois tu as roll sur Mudae',
        usage: '[@user]',
        options: [{ name: 'membre', type: 'user', description: 'Membre (toi par defaut)' }],
        async run(ctx, { membre }) {
            const user = membre || ctx.user;
            const p = await db.getProfile(user.id);
            if (!p.wacount) {
                return ctx.reply(user.id === ctx.user.id ? 'Tu n\'as pas encore écrit de $wa. Essaie maintenant !' : `**${user.username}** n'a jamais roll.`);
            }
            await ctx.reply(`${user.id === ctx.user.id ? 'Tu as' : `**${user.username}** a`} roll **${fmt(p.wacount)}** fois ! 🚀`);
        },
    },
];
