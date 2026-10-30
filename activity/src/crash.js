// Vue Crash : une fusee partagee par tout le vocal.
// Le serveur envoie les phases (mises -> vol -> crash) ; l'affichage calcule le multiplicateur
// en direct avec la meme formule, recale sur l'horloge du serveur.
const withAlpha = (c, a) => {
    if (c.startsWith('hsl(')) return c.replace('hsl(', 'hsla(').replace(')', `, ${a})`);
    const n = parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.trunc(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ');
const rand = (a, b) => a + Math.random() * (b - a);

export class CrashView {
    /**
     * opts: { send(msg) -> bool, me() -> {id, name, avatar}, mySkins(), onBalance(bal, won),
     *         toast(text, err), sound, celebrate(mult, net, bet), friendWin(player, mult, net),
     *         avatarImg(url), colorOf(id), parseBet(str), maxBet(), minBet }
     */
    constructor(opts) {
        this.o = opts;
        this.canvas = $('crash-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.phase = 'idle';
        this.bets = new Map();
        this.history = [];
        this.offset = 0;
        this.k = 0.09;
        this.parts = [];
        this.stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: rand(0.3, 1) }));
        this.reqId = 0;
        this.pending = new Map();
        this.queued = false; // mise programmee pour la prochaine manche
        this.visible = false;
        this.shake = 0;
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(this.canvas.parentElement);
        this.bind();
    }

    // -----------------------------------------------------------------------
    // reseau
    // -----------------------------------------------------------------------
    serverNow() { return Date.now() + this.offset; }
    multAt(ms) { return Math.floor(Math.exp((this.k * Math.max(0, ms)) / 1000) * 100) / 100; }
    liveMult() { return this.phase === 'flying' ? this.multAt(this.serverNow() - this.startAt) : this.phase === 'crashed' ? this.point : 1; }

    request(type, extra = {}) {
        const id = ++this.reqId;
        return new Promise((resolve) => {
            if (!this.o.send({ type, id, ...extra })) return resolve({ error: 'Connexion perdue, réessaie dans une seconde.' });
            this.pending.set(id, resolve);
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    resolve({ error: 'Pas de réponse du serveur.' });
                }
            }, 8000);
        });
    }

    /** a appeler a la (re)connexion */
    join() { this.o.send({ type: 'crash:join' }); }

    onMessage(m) {
        switch (m.type) {
            case 'crash:state': return this.onState(m);
            case 'crash:bet': return this.onBet(m.bet);
            case 'crash:cancel': this.bets.delete(m.id); return this.renderPlayers();
            case 'crash:cashout': return this.onCashout(m);
            case 'crash:balance': return this.o.onBalance(m.balance);
            case 'crash:res': {
                const r = this.pending.get(m.id);
                this.pending.delete(m.id);
                return r?.(m);
            }
            default:
        }
    }

    onState(m) {
        this.offset = m.now - Date.now();
        this.k = m.k || this.k;
        const prev = this.phase;
        this.phase = m.phase;
        this.endsAt = m.endsAt;
        this.startAt = m.startAt;
        this.point = m.point;
        this.history = m.history || this.history;
        this.bets = new Map((m.bets || []).map((b) => [b.player.id, b]));
        this.renderHistory();
        this.renderPlayers();
        $('crash-live').hidden = this.phase !== 'flying';

        if (this.phase === 'betting') {
            this.lastTick = null;
            if (this.queued) {
                this.queued = false;
                this.placeBet();
            }
        }
        if (this.phase === 'flying' && prev !== 'flying') {
            this.o.sound.launch();
            if (this.visible) this.o.sound.engine(true);
        }
        if (this.phase === 'crashed' && prev === 'flying') this.boom();
        this.updateButton();
        this.kick();
    }

    onBet(b) {
        this.bets.set(b.player.id, b);
        this.renderPlayers();
        if (b.player.id !== this.o.me()?.id && this.visible) this.o.sound.chip();
        this.updateButton();
    }

    onCashout(m) {
        const b = this.bets.get(m.id);
        if (!b) return;
        b.cashed = m.mult;
        b.payout = m.payout;
        this.renderPlayers();
        this.updateButton();
        const mine = m.id === this.o.me()?.id;
        const net = m.payout - m.bet;
        // petite gerbe a l'endroit de l'encaissement
        const p = this.toScreen(this.timeOf(m.mult), m.mult);
        if (p) this.burst(p.x, p.y, mine ? '#8fe3a1' : b.player.color || '#4fd1ff', mine ? 26 : 12);
        if (mine) {
            this.o.sound.cashout(m.mult);
            this.o.celebrate(m.mult, net, m.bet);
        } else {
            if (this.visible) this.o.sound.friendCash();
            if (m.mult >= 5 && net > 0) this.o.friendWin(b.player, m.mult, net);
        }
    }

    // -----------------------------------------------------------------------
    // actions
    // -----------------------------------------------------------------------
    myBet() { return this.bets.get(this.o.me()?.id); }

    async placeBet() {
        const bet = this.o.parseBet($('crash-bet').value);
        if (!Number.isFinite(bet) || bet < this.o.minBet) return this.o.toast(`Mise minimum : ${fmt(this.o.minBet)}`, true);
        if (bet > this.o.maxBet()) return this.o.toast(`Pas assez de Rokbux pour miser ${fmt(bet)}`, true);
        const rawAuto = $('crash-auto').value.trim().replace(',', '.').replace(/^x/i, '');
        const auto = rawAuto ? Number(rawAuto) : null;
        if (rawAuto && !(auto >= 1.01)) return this.o.toast('Encaissement auto : minimum ×1.01', true);
        this.busy = true;
        this.updateButton();
        this.o.sound.unlock();
        const r = await this.request('crash:bet', { bet, auto });
        this.busy = false;
        if (r.error) this.o.toast(r.error, true);
        else {
            this.o.onBalance(r.balance);
            this.o.sound.chip(true);
        }
        this.updateButton();
    }

    async cancelBet() {
        this.busy = true;
        this.updateButton();
        const r = await this.request('crash:cancel');
        this.busy = false;
        if (r.error) this.o.toast(r.error, true);
        else this.o.onBalance(r.balance);
        this.updateButton();
    }

    async cashout() {
        this.busy = true;
        this.updateButton();
        const r = await this.request('crash:cash');
        this.busy = false;
        if (r.error) this.o.toast(r.error, true);
        this.updateButton();
    }

    /** le gros bouton : miser / annuler / encaisser / programmer la prochaine manche */
    press() {
        if (this.busy) return;
        const b = this.myBet();
        if (this.phase === 'betting') return b ? this.cancelBet() : this.placeBet();
        if (this.phase === 'flying' && b && !b.cashed) return this.cashout();
        // pendant le vol (sans mise) ou apres le crash : on programme la suivante
        this.queued = !this.queued;
        this.o.sound.chip(this.queued);
        this.updateButton();
    }

    updateButton() {
        const btn = $('crash-btn');
        const b = this.myBet();
        const hint = $('crash-hint');
        btn.className = 'drop crash-btn';
        btn.disabled = !!this.busy;
        if (this.phase === 'betting') {
            if (b) {
                btn.textContent = 'Annuler ma mise';
                btn.classList.add('ghost');
                hint.textContent = b.auto ? `Misé ${fmt(b.bet)} · encaissement auto à ×${b.auto}` : `Misé ${fmt(b.bet)} · prépare-toi à encaisser`;
            } else {
                btn.textContent = `Miser ${fmt(this.o.parseBet($('crash-bet').value) || 0)}`;
                hint.textContent = 'Mise pendant le compte à rebours, encaisse avant l\'explosion.';
            }
        } else if (this.phase === 'flying' && b && !b.cashed) {
            btn.classList.add('cash');
            this.cashLabel(btn, b);
            hint.textContent = b.auto ? `Auto à ×${b.auto} · ou clique avant !` : 'Clique (ou Espace) pour encaisser !';
        } else if (b?.cashed) {
            btn.disabled = true;
            btn.classList.add('done');
            btn.textContent = `Encaissé ×${b.cashed.toFixed(2)} · +${fmt(b.payout - b.bet)}`;
            hint.textContent = this.queued ? 'Mise programmée pour la prochaine manche.' : 'Bien joué. Clique pour miser à la prochaine.';
            btn.disabled = false;
        } else {
            btn.textContent = this.queued ? 'Annuler (prochaine manche)' : 'Miser à la prochaine';
            if (this.queued) btn.classList.add('ghost');
            hint.textContent = this.phase === 'crashed' && b ? `💥 Perdu ${fmt(b.bet)}…` : 'Manche en cours. Tu peux programmer ta mise.';
        }
    }

    cashLabel(btn, b) {
        btn.textContent = `Encaisser ${fmt(Math.floor(b.bet * this.liveMult()))}`;
    }

    bind() {
        $('crash-btn').addEventListener('click', () => this.press());
        $('crash-bet-row').addEventListener('click', (e) => {
            const c = e.target.closest('[data-bet]');
            if (!c) return;
            const cur = this.o.parseBet($('crash-bet').value) || this.o.minBet;
            let v = cur;
            if (c.dataset.bet === 'half') v = cur / 2;
            if (c.dataset.bet === 'double') v = cur * 2;
            if (c.dataset.bet === 'max') v = this.o.maxBet();
            $('crash-bet').value = String(Math.max(this.o.minBet, Math.floor(v)));
            this.updateButton();
        });
        $('crash-bet').addEventListener('input', () => this.updateButton());
        $('crash-auto-row').addEventListener('click', (e) => {
            const c = e.target.closest('[data-auto]');
            if (c) $('crash-auto').value = c.dataset.auto;
        });
    }

    show(on) {
        this.visible = on;
        if (on) {
            this.resize();
            this.kick();
            if (this.phase === 'flying') this.o.sound.engine(true);
        } else {
            this.o.sound.engine(false);
        }
    }

    // -----------------------------------------------------------------------
    // listes
    // -----------------------------------------------------------------------
    renderHistory() {
        const el = $('crash-hist');
        el.replaceChildren(...this.history.slice(-12).reverse().map((p) => {
            const s = document.createElement('span');
            s.textContent = `${p.toFixed(2)}×`;
            s.className = p >= 10 ? 'h3' : p >= 2 ? 'h2' : 'h1';
            return s;
        }));
    }

    renderPlayers() {
        const ol = $('crash-players');
        const list = [...this.bets.values()].sort((a, b) => b.bet - a.bet);
        if (!list.length) {
            const li = document.createElement('li');
            li.className = 'empty';
            li.textContent = this.phase === 'betting' ? 'Personne n\'a encore misé…' : 'Aucune mise sur cette manche.';
            return ol.replaceChildren(li);
        }
        ol.replaceChildren(...list.map((b) => {
            const li = document.createElement('li');
            const img = document.createElement('img');
            img.src = b.player.avatar;
            img.alt = '';
            img.style.setProperty('--c', b.player.color || '#ffd76a');
            const name = document.createElement('b');
            name.textContent = b.player.name;
            name.style.color = b.player.id === this.o.me()?.id ? '#ffd76a' : (b.player.color || '');
            const amt = document.createElement('span');
            amt.className = 'amt';
            amt.textContent = fmt(b.bet);
            const st = document.createElement('span');
            if (b.cashed) {
                st.className = 'w';
                st.textContent = `×${b.cashed.toFixed(2)} +${fmt(b.payout - b.bet)}`;
            } else if (this.phase === 'crashed') {
                st.className = 'l';
                st.textContent = '💥';
            } else {
                st.className = 'p';
                st.textContent = b.auto ? `auto ×${b.auto}` : this.phase === 'flying' ? 'en vol' : 'prêt';
            }
            li.append(img, name, amt, st);
            if (b.cashed) li.classList.add('won');
            return li;
        }));
    }

    // -----------------------------------------------------------------------
    // dessin
    // -----------------------------------------------------------------------
    resize() {
        const box = this.canvas.parentElement.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = Math.round(box.width);
        this.H = Math.round(Math.min(box.height, window.innerHeight));
        this.canvas.width = Math.round(this.W * dpr);
        this.canvas.height = Math.round(this.H * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw(performance.now());
    }

    timeOf(m) { return (Math.log(m) / this.k) * 1000; }

    /** echelle : axes qui s'agrandissent avec la manche */
    scale() {
        const t = this.phase === 'flying' ? this.serverNow() - this.startAt : this.phase === 'crashed' ? this.timeOf(this.point) : 0;
        const m = Math.max(1, this.liveMult());
        return { t, m, tMax: Math.max(9000, t * 1.18), mMax: Math.max(2, 1 + (m - 1) * 1.25) };
    }

    toScreen(t, m, sc = this.scale()) {
        if (!this.W) return null;
        const L = 50;
        const B = 36;
        const T = 40;
        const R = 30;
        return {
            x: L + (t / sc.tMax) * (this.W - L - R),
            y: this.H - B - ((m - 1) / (sc.mMax - 1)) * (this.H - B - T),
        };
    }

    burst(x, y, color, n = 16, power = 1) {
        for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2);
            const v = rand(0.05, 0.35) * power;
            this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(500, 1100), age: 0, size: rand(1.5, 3.5), color });
        }
        this.kick();
    }

    boom() {
        this.o.sound.engine(false);
        if (!this.visible) return;
        this.o.sound.boom();
        const sc = this.scale();
        const p = this.toScreen(sc.t, this.point, sc);
        if (!p) return;
        for (const c of ['#ff5a4e', '#ffb627', '#fff1c4', '#3a0d17']) this.burst(p.x, p.y, c, 22, 1.4);
        this.shake = 12;
        this.flash = performance.now();
    }

    kick() {
        if (this.running || !this.visible) return;
        this.running = true;
        this.last = performance.now();
        const tick = (now) => {
            this.step(now);
            this.draw(now);
            if (this.visible) requestAnimationFrame(tick);
            else this.running = false;
        };
        requestAnimationFrame(tick);
    }

    step(now) {
        const dt = Math.min(50, now - this.last);
        this.last = now;
        for (const p of this.parts) {
            p.age += dt;
            p.vy += 0.0006 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
        this.parts = this.parts.filter((p) => p.age < p.life);
        this.shake *= Math.pow(0.88, dt / 16);

        // HUD
        const mult = $('crash-mult');
        const sub = $('crash-sub');
        const bar = $('crash-bar');
        if (this.phase === 'betting') {
            const left = Math.max(0, this.endsAt - this.serverNow());
            mult.textContent = `${(left / 1000).toFixed(1)} s`;
            mult.className = 'crash-mult wait';
            sub.textContent = 'Faites vos mises !';
            bar.style.width = `${(left / 8000) * 100}%`;
            $('crash-bar-wrap').hidden = false;
            const sec = Math.ceil(left / 1000);
            if (this.visible && sec <= 3 && sec > 0 && this.lastTick !== sec) {
                this.lastTick = sec;
                this.o.sound.countdown(sec);
            }
        } else if (this.phase === 'flying') {
            const m = this.liveMult();
            mult.textContent = `${m.toFixed(2)}×`;
            mult.className = `crash-mult fly ${m >= 10 ? 'm4' : m >= 5 ? 'm3' : m >= 2 ? 'm2' : 'm1'}`;
            const b = this.myBet();
            sub.textContent = b && !b.cashed ? `Ta mise : ${fmt(Math.floor(b.bet * m))}` : 'En vol…';
            $('crash-bar-wrap').hidden = true;
            this.o.sound.engineAt(m);
            if (b && !b.cashed) this.cashLabel($('crash-btn'), b);
        } else if (this.phase === 'crashed') {
            mult.textContent = `${this.point.toFixed(2)}×`;
            mult.className = 'crash-mult boom';
            sub.textContent = '💥 CRASH';
            $('crash-bar-wrap').hidden = true;
        }
    }

    draw(now) {
        const { ctx, W, H } = this;
        if (!W) return;
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        if (this.shake > 0.3) ctx.translate(rand(-1, 1) * this.shake, rand(-1, 1) * this.shake);

        const sc = this.scale();
        const flying = this.phase === 'flying';
        // etoiles qui defilent (plus vite quand ca monte)
        const speed = flying ? Math.min(6, 0.6 + Math.log(sc.m) * 2) : 0.15;
        ctx.fillStyle = '#fff6d8';
        for (const s of this.stars) {
            s.x -= 0.0007 * speed * s.z;
            s.y += 0.0004 * speed * s.z;
            if (s.x < 0) s.x += 1;
            if (s.y > 1) s.y -= 1;
            ctx.globalAlpha = 0.15 + 0.35 * s.z;
            ctx.fillRect(s.x * W, s.y * H, 1.5 * s.z, 1.5 * s.z);
        }
        ctx.globalAlpha = 1;

        // axes
        const o = this.toScreen(0, 1, sc);
        ctx.strokeStyle = 'rgba(247, 235, 215, 0.12)';
        ctx.fillStyle = 'rgba(247, 235, 215, 0.45)';
        ctx.lineWidth = 1;
        ctx.font = '600 12px Bricolage, system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const m of niceSteps(sc.mMax)) {
            const p = this.toScreen(0, m, sc);
            ctx.beginPath();
            ctx.moveTo(o.x, p.y);
            ctx.lineTo(W - 30, p.y);
            ctx.stroke();
            ctx.fillText(`${m}×`, o.x - 8, p.y);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const stepS = sc.tMax > 60000 ? 20 : sc.tMax > 25000 ? 10 : 5;
        for (let s = stepS; s * 1000 < sc.tMax; s += stepS) {
            const p = this.toScreen(s * 1000, 1, sc);
            ctx.fillText(`${s}s`, p.x, o.y + 8);
        }

        // courbe
        const me = this.myBet();
        const crashed = this.phase === 'crashed';
        if (this.phase !== 'betting') {
            const pts = [];
            const N = 80;
            for (let i = 0; i <= N; i++) {
                const t = (sc.t * i) / N;
                pts.push(this.toScreen(t, Math.exp((this.k * t) / 1000), sc));
            }
            const top = crashed ? '#ff5a4e' : sc.m >= 10 ? '#ff6fb5' : sc.m >= 2 ? '#ffb627' : '#8fe3a1';
            const fill = ctx.createLinearGradient(0, pts[pts.length - 1].y, 0, o.y);
            fill.addColorStop(0, withAlpha(top, 0.35));
            fill.addColorStop(1, withAlpha(top, 0));
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.moveTo(o.x, o.y);
            for (const p of pts) ctx.lineTo(p.x, p.y);
            ctx.lineTo(pts[pts.length - 1].x, o.y);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = top;
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.shadowColor = top;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.stroke();
            ctx.shadowBlur = 0;

            // encaissements : avatar pose sur la courbe
            for (const b of this.bets.values()) {
                if (!b.cashed) continue;
                const p = this.toScreen(this.timeOf(b.cashed), b.cashed, sc);
                const img = this.o.avatarImg(b.player.avatar);
                const r = 11;
                const c = b.player.id === this.o.me()?.id ? '#ffd76a' : (b.player.color || '#4fd1ff');
                ctx.fillStyle = c;
                ctx.beginPath();
                ctx.arc(p.x, p.y - 18, r + 2, 0, Math.PI * 2);
                ctx.fill();
                if (img?.complete && img.naturalWidth) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(p.x, p.y - 18, r, 0, Math.PI * 2);
                    ctx.clip();
                    ctx.drawImage(img, p.x - r, p.y - 18 - r, r * 2, r * 2);
                    ctx.restore();
                }
                ctx.fillStyle = c;
                ctx.font = '600 12px Bricolage, system-ui, sans-serif';
                ctx.textBaseline = 'bottom';
                ctx.fillText(`${b.cashed.toFixed(2)}×`, p.x, p.y - 32);
                ctx.fillStyle = withAlpha(c, 0.9);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fill();
            }

            // la fusee (ou l'explosion)
            const tip = pts[pts.length - 1];
            const prev = pts[pts.length - 4] || pts[0];
            const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
            if (!crashed) {
                // flammes
                for (let i = 0; i < 3; i++) {
                    if (Math.random() < 0.7) {
                        this.parts.push({
                            x: tip.x - Math.cos(ang) * 16, y: tip.y - Math.sin(ang) * 16,
                            vx: -Math.cos(ang) * rand(0.05, 0.15) + rand(-0.03, 0.03), vy: -Math.sin(ang) * rand(0.05, 0.15) + rand(-0.03, 0.03),
                            life: rand(200, 420), age: 0, size: rand(2, 4.5), color: i ? '#ffb627' : '#ff5a1f',
                        });
                    }
                }
                ctx.save();
                ctx.translate(tip.x, tip.y);
                ctx.rotate(ang + Math.PI / 4);
                ctx.font = '30px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('🚀', 0, 0);
                ctx.restore();
            } else {
                ctx.font = '34px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('💥', tip.x, tip.y);
            }
        } else {
            // au sol, la fusee attend
            const bob = Math.sin(now / 180) * 2;
            ctx.save();
            ctx.translate(o.x + 14, o.y - 18 + bob);
            ctx.rotate(Math.PI / 4 - 0.6);
            ctx.font = '30px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🚀', 0, 0);
            ctx.restore();
        }

        // particules
        for (const p of this.parts) {
            ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        if (this.flash && now - this.flash < 350) {
            ctx.fillStyle = `rgba(255, 90, 78, ${0.35 * (1 - (now - this.flash) / 350)})`;
            ctx.fillRect(0, 0, W, H);
        }
    }
}

function niceSteps(max) {
    const raw = (max - 1) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((x) => x * mag).find((x) => x >= raw) || raw;
    const out = [];
    for (let v = 1 + step; v < max; v += step) out.push(Math.round(v * 100) / 100);
    return out;
}
