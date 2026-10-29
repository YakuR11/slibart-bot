// Contexte unifie : une commande s'ecrit une seule fois et marche
// a la fois en prefixe (=gamble r 100) et en slash (/gamble couleur:red montant:100).
const { MessageFlags } = require('discord.js');
const { displayName } = require('./utils');

const NO_PING = { repliedUser: false, parse: ['users'] };

const asPayload = (p) => (typeof p === 'string' ? { content: p } : { ...p });

class Ctx {
    constructor(client, { message = null, interaction = null, command = null, alias = null }) {
        this.client = client;
        this.message = message;
        this.interaction = interaction;
        this.command = command;
        this.alias = alias; // nom tape par l'utilisateur (=topc, =topi...)
        this.args = {};
        this._answered = false;
        this._defer = null;
    }

    get isSlash() { return !!this.interaction; }
    get user() { return this.interaction?.user ?? this.message.author; }
    get member() { return this.interaction?.member ?? this.message.member; }
    get guild() { return this.interaction?.guild ?? this.message.guild; }
    get channel() { return this.interaction?.channel ?? this.message.channel; }
    get displayName() { return displayName(this.user, this.member); }

    /** Pour les commandes lentes en slash (Spotify, API...) : evite le "l'application ne repond plus" */
    autoDefer(afterMs = 2000) {
        if (!this.isSlash) return () => {};
        const t = setTimeout(() => {
            if (this._answered || this.interaction.replied || this.interaction.deferred) return;
            this._defer = this.interaction.deferReply().catch(() => {});
        }, afterMs);
        return () => clearTimeout(t);
    }

    /** Repond a l'utilisateur. Retourne le Message envoye. */
    async reply(p) {
        const payload = { allowedMentions: NO_PING, ...asPayload(p) };
        this._answered = true;
        if (this._defer) await this._defer;
        if (this.isSlash) {
            const i = this.interaction;
            if (i.deferred && !i.replied) return i.editReply(payload);
            if (i.replied) return i.followUp(payload);
            await i.reply(payload);
            return i.fetchReply().catch(() => null);
        }
        try {
            return await this.message.reply(payload);
        } catch {
            // message d'origine supprime -> on envoie juste dans le salon
            return this.channel.send(payload);
        }
    }

    /** Envoie dans le salon sans "repondre a" (en slash = reply, il faut bien acquitter) */
    async send(p) {
        if (this.isSlash) return this.reply(p);
        this._answered = true;
        return this.channel.send({ allowedMentions: NO_PING, ...asPayload(p) });
    }

    /** Message visible uniquement par l'utilisateur en slash (normal en prefixe) */
    async whisper(p) {
        const payload = asPayload(p);
        if (this.isSlash) payload.flags = MessageFlags.Ephemeral;
        return this.reply(payload);
    }

    /** Erreur d'utilisation / refus */
    fail(text) {
        return this.whisper(`❌ ${text}`);
    }

    async react(emoji) {
        if (this.isSlash) return this.whisper(emoji);
        this._answered = true;
        return this.message.react(emoji).catch(() => {});
    }

    /** Supprime la commande tapee (=cold, =bubble) ; rien en slash */
    async deleteInvocation() {
        if (!this.isSlash) await this.message.delete().catch(() => {});
    }
}

module.exports = { Ctx };
