const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
const spotify = require('../lib/spotify');
const log = require('../lib/logger');
const media = require('../lib/media');
const { pick, avatar, baseEmbed } = require('../lib/utils');

const C = config.content;

const LANGS = {
    zh: 'chinois', en: 'anglais', es: 'espagnol', ar: 'arabe', ja: 'japonais', ko: 'coréen',
    de: 'allemand', it: 'italien', pt: 'portugais', ru: 'russe', tr: 'turc', fi: 'finnois', fr: 'français',
};

module.exports = [
    {
        name: 'cold',
        category: 'general',
        description: 'Montre a quel point tu es cold',
        async run(ctx) {
            await ctx.deleteInvocation();
            const special = C.cold.special[ctx.user.id];
            const embed = baseEmbed(ctx, '#000000')
                .setTitle(special?.title || 'cold af.')
                .setDescription(special?.description || `Ain't gonna lie, ${ctx.displayName} is such a cold guy.`)
                .setImage(media.ok(special?.image) || media.pick(C.cold.images));
            await ctx.send({ embeds: [embed] });
        },
    },
    {
        name: 'remember',
        category: 'general',
        description: 'never forget 29/11/2024',
        async run(ctx) {
            const embed = baseEmbed(ctx)
                .setTitle(C.remember.title)
                .setDescription(C.remember.description)
                .setImage(media.pick(C.remember.images));
            await ctx.send({ embeds: [embed] });
        },
    },
    {
        name: 'bubble',
        category: 'general',
        description: 'Balance un speech bubble au hasard',
        async run(ctx) {
            await ctx.deleteInvocation();
            // envoye comme lien (et pas en fichier) : Discord l'affiche direct, et un lien mort ne fait pas planter
            await ctx.send(media.pick(C.bubble) || '💬');
        },
    },
    {
        name: 'trad',
        aliases: ['translate', 'tr'],
        category: 'general',
        description: 'Traduit un texte (chinois par defaut)',
        usage: '[langue] <texte>',
        example: 'trad en salut ca va',
        options: [
            { name: 'texte', type: 'text', required: true, description: 'Texte a traduire' },
            {
                name: 'langue', type: 'string', description: 'Langue cible (zh par defaut)',
                choices: Object.entries(LANGS).map(([value, name]) => ({ name, value })),
            },
        ],
        // en prefixe la langue est le 1er mot : on la detecte nous-memes
        async run(ctx, { texte, langue }) {
            let target = langue || config.translate.defaultTarget;
            let text = texte;
            if (!ctx.isSlash) {
                const [first, ...rest] = texte.split(/\s+/);
                if (LANGS[first.toLowerCase()] && rest.length) {
                    target = first.toLowerCase();
                    text = rest.join(' ');
                }
            }
            if (text.length > 500) return ctx.fail('500 caractères max.');
            const url = new URL('https://api.mymemory.translated.net/get');
            url.searchParams.set('q', text);
            // le serveur parle francais : source fr (sauf si on traduit VERS le francais -> source en)
            url.searchParams.set('langpair', target === 'fr' ? 'en|fr' : `fr|${target}`);
            if (config.translate.email) url.searchParams.set('de', config.translate.email);
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
                const data = await res.json();
                const out = data?.responseData?.translatedText;
                if (!out || data.responseStatus !== 200) throw new Error(data?.responseDetails || 'reponse vide');
                const embed = baseEmbed(ctx, '#ffd6a5')
                    .setTitle(`🌐 Traduction · ${LANGS[target] || target}`)
                    .addFields({ name: 'Original', value: text.slice(0, 1024) }, { name: 'Traduit', value: out.slice(0, 1024) });
                await ctx.reply({ embeds: [embed] });
            } catch (e) {
                log.warn('[trad]', e.message);
                await ctx.fail('Le service de traduction ne répond pas, réessaie plus tard.');
            }
        },
    },
    {
        name: 'musique',
        aliases: ['music', 'song'],
        category: 'general',
        description: 'Une musique au hasard dans une playlist du serveur',
        usage: '<type>',
        options: [
            {
                name: 'type', type: 'string', description: 'Playlist',
                choices: Object.keys(C.playlists),
            },
        ],
        async run(ctx, { type }) {
            const genre = type?.toLowerCase();
            const playlistId = C.playlists[genre];
            if (!playlistId) {
                const embed = baseEmbed(ctx, '#ffffff')
                    .setTitle('Lets jam! 🎶')
                    .setDescription(
                        `__Quel type de musique souhaites-tu écouter ?__\nRajoute l'argument à ta commande : \`${config.prefix}musique [type]\`\n\n` +
                        Object.keys(C.playlists).map((g) => `\`${g}\``).join(' · '),
                    );
                return ctx.reply({ embeds: [embed] });
            }
            try {
                const t = await spotify.randomTrack(playlistId);
                const embed = new EmbedBuilder()
                    .setTitle('Song of the day! 🎶')
                    .setDescription(`[${t.artists} - ${t.title}](${t.link})\n${t.album}`)
                    .setThumbnail(t.cover)
                    .setColor('#1db954')
                    .setFooter({ text: `${ctx.displayName} · ${genre} · ${t.total} sons`, iconURL: avatar(ctx.user) });
                await ctx.send({ embeds: [embed] });
            } catch (e) {
                log.warn('[musique]', e.message);
                await ctx.reply(
                    `Spotify ne veut pas me donner la playlist 😭 (${e.message}).\n` +
                    `En attendant : https://open.spotify.com/playlist/${playlistId}`,
                );
            }
        },
    },
    {
        name: 'changemot',
        aliases: ['setmot'],
        category: 'general',
        description: 'Definit ton mot favori',
        usage: '<mot>',
        options: [{ name: 'mot', type: 'text', required: true, description: 'Ton mot favori' }],
        async run(ctx, { mot }) {
            const value = mot.slice(0, 255);
            const res = await db.exec('UPDATE motfav SET mot = ? WHERE id_user = ?', [value, ctx.user.id]);
            if (!res.affectedRows) await db.exec('INSERT INTO motfav (id_user, mot) VALUES (?, ?)', [ctx.user.id, value]);
            await ctx.reply(`Ton mot favori est maintenant : **${value}**`);
        },
    },
    {
        name: 'motfav',
        category: 'general',
        description: 'Affiche le mot favori de quelqu\'un',
        usage: '[@user]',
        options: [{ name: 'membre', type: 'user', description: 'Membre (toi par defaut)' }],
        async run(ctx, { membre }) {
            const target = membre || ctx.user;
            const rows = await db.q('SELECT mot FROM motfav WHERE id_user = ?', [target.id]);
            const mot = rows[0]?.mot;
            if (!mot) {
                return ctx.reply(target.id === ctx.user.id
                    ? `Tu n'as pas de mot favori. Utilise \`${config.prefix}changemot <mot>\`.`
                    : `**${target.username}** n'a pas de mot favori.`);
            }
            await ctx.reply(`Le mot favori de **${target.id === ctx.user.id ? ctx.displayName : target.username}** est : **${mot}**`);
        },
    },
];
