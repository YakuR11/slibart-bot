// Musique de fond en boucle. Le fichier n'est pas dans le depot : on le pose soi-meme
// dans activity/music/casino.mp3 (voir activity/music/LISEZMOI.md). Sans fichier, le bouton disparait.
const SRC = 'music/casino.mp3';
const KEY = 'casino-music';
const VOL = 0.18;

export class Music {
    constructor(btn, isMuted) {
        this.btn = btn;
        this.isMuted = isMuted;
        this.audio = null;
        this.ok = false;
        this.duckUntil = 0;
        try { this.on = localStorage.getItem(KEY) !== 'off'; } catch { this.on = true; }
        btn.hidden = true;
        btn.addEventListener('click', () => this.toggle());
        this.probe();
    }

    async probe() {
        try {
            const r = await fetch(SRC, { method: 'HEAD', cache: 'no-store' });
            if (!r.ok) return;
        } catch { return; }
        this.ok = true;
        this.audio = new Audio(SRC);
        this.audio.loop = true;
        this.audio.preload = 'auto';
        this.audio.volume = VOL;
        this.btn.hidden = false;
        this.paint();
        // les navigateurs bloquent le son avant le premier clic : on demarre au premier geste
        const kick = () => { this.sync(); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
        window.addEventListener('pointerdown', kick);
        window.addEventListener('keydown', kick);
        document.addEventListener('visibilitychange', () => this.sync());
    }

    /** joue ou coupe selon : bouton musique, bouton son general, onglet visible */
    sync() {
        if (!this.audio) return;
        const play = this.on && !this.isMuted() && !document.hidden;
        if (play && this.audio.paused) this.audio.play().catch(() => {});
        else if (!play && !this.audio.paused) this.audio.pause();
    }

    toggle() {
        this.on = !this.on;
        try { localStorage.setItem(KEY, this.on ? 'on' : 'off'); } catch { /* rien */ }
        this.paint();
        this.sync();
    }

    paint() {
        this.btn.setAttribute('aria-pressed', String(this.on));
        this.btn.setAttribute('aria-label', this.on ? 'Couper la musique' : 'Mettre la musique');
        this.btn.title = this.on ? 'Musique : on' : 'Musique : off';
        this.btn.classList.toggle('off', !this.on);
    }

    /** baisse la musique pendant un gros moment (gros gain, tapis) pour laisser passer les effets */
    duck(ms = 2500) {
        if (!this.audio) return;
        this.duckUntil = Date.now() + ms;
        this.audio.volume = VOL * 0.3;
        setTimeout(() => { if (Date.now() >= this.duckUntil && this.audio) this.audio.volume = VOL; }, ms + 20);
    }
}
