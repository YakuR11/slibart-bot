// Rendu des skins : billes, trainees, tables, cadres d'avatar.
import catalog from '../../src/lib/skins-catalog.js';

export const { SKINS, RARITIES, SLOTS, DEFAULTS } = catalog;

export function lookOf(skins, slot) {
    const id = skins?.[slot] && SKINS[skins[slot]] ? skins[slot] : DEFAULTS[slot];
    return SKINS[id].look;
}

/** couleur principale d'une bille (pour les traces, le Crash...) */
export function ballColor(look, now = performance.now()) {
    switch (look.kind) {
        case 'grad':
        case 'glow': return look.colors[1];
        case 'lava': return '#ff6a00';
        case 'galaxy': return '#9b7bff';
        case 'rainbow': return `hsl(${(now / 6) % 360}, 95%, 62%)`;
        case 'emoji': return look.glow || '#ffd76a';
        default: return '#ffd76a';
    }
}

/** dessine une bille avec son skin */
export function paintBall(ctx, x, y, r, look, now = performance.now()) {
    if (look.glow && look.kind !== 'grad') {
        const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.1);
        halo.addColorStop(0, hexA(look.glow, 0.45));
        halo.addColorStop(1, hexA(look.glow, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
        ctx.fill();
    }
    if (look.kind === 'emoji') {
        ctx.save();
        ctx.font = `${Math.round(r * 2.3)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(look.emoji, x, y + r * 0.1);
        ctx.restore();
        return;
    }
    let c0;
    let c1;
    let c2;
    if (look.kind === 'grad' || look.kind === 'glow') [c0, c1, c2] = look.colors;
    else if (look.kind === 'lava') {
        const f = 0.5 + 0.5 * Math.sin(now / 120 + x * 0.05);
        c0 = '#fff3b0';
        c1 = f > 0.5 ? '#ff7a00' : '#ff3d00';
        c2 = '#4a0a00';
    } else if (look.kind === 'galaxy') {
        c0 = '#e9ddff';
        c1 = '#5a3bd1';
        c2 = '#0b0624';
    } else if (look.kind === 'rainbow') {
        const h = (now / 6 + x) % 360;
        c0 = '#ffffff';
        c1 = `hsl(${h}, 95%, 60%)`;
        c2 = `hsl(${(h + 60) % 360}, 80%, 25%)`;
    } else {
        [c0, c1, c2] = ['#fff6d8', '#ffd76a', '#8a5a12'];
    }
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
    g.addColorStop(0, c0);
    g.addColorStop(0.4, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (look.kind === 'galaxy') {
        // petites etoiles qui scintillent
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 4; i++) {
            const a = now / 900 + i * 1.7;
            const d = r * (0.25 + 0.15 * i);
            ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 150 + i);
            ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.4, 1.4);
        }
        ctx.globalAlpha = 1;
    }
    if (look.kind === 'rainbow') {
        // facettes de boule disco
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x - r, y);
        ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r);
        ctx.lineTo(x, y + r);
        ctx.stroke();
    }
}

/**
 * dessine la trainee d'une bille.
 * trail = [[x, y], ...] du plus ancien au plus recent ; spawn(x, y, opts) cree des particules
 */
export function paintTrail(ctx, trail, r, ball, trailLook, now, spawn) {
    const n = trail.length;
    const base = ballColor(ball, now);
    trail.forEach(([tx, ty], i) => {
        const k = (i + 1) / n;
        let color = base;
        let alpha = k * 0.3;
        let size = r * (0.35 + k * 0.55);
        switch (trailLook.kind) {
            case 'fire': color = i % 2 ? '#ffb627' : '#ff5a1f'; alpha = k * 0.55; size *= 1.1; break;
            case 'rainbow': color = `hsl(${(now / 4 + i * 30) % 360}, 95%, 60%)`; alpha = k * 0.55; break;
            case 'comet': color = trailLook.color; alpha = k * 0.5; size = r * (0.2 + k * 0.85); break;
            case 'stink': color = trailLook.color; alpha = k * 0.35; size = r * (0.6 + (1 - k) * 0.7); break;
            case 'sparks': alpha = k * 0.25; break;
            default:
        }
        ctx.fillStyle = withAlpha(color, alpha);
        ctx.beginPath();
        ctx.arc(tx, ty, size, 0, Math.PI * 2);
        ctx.fill();
    });
    if (!spawn || !n) return;
    const [x, y] = trail[n - 1];
    if (trailLook.kind === 'sparks' && Math.random() < 0.35) spawn(x, y, { color: trailLook.color, n: 1, power: 0.25 });
    if (trailLook.kind === 'fire' && Math.random() < 0.3) spawn(x, y, { color: '#ff8a3d', n: 1, power: 0.2 });
    if (trailLook.kind === 'stink' && Math.random() < 0.12) spawn(x, y, { color: trailLook.color, n: 1, power: 0.12 });
}

/** applique un theme de table a un element (variables CSS du tapis) */
export function applyTable(el, look) {
    el.style.setProperty('--felt', look.felt);
    el.style.setProperty('--felt2', look.felt2);
    el.style.setProperty('--neon', look.neon || 'transparent');
}

/** cadre d'avatar : classe + couleurs (CSS) */
export function frameAttrs(el, skins) {
    const look = lookOf(skins, 'frame');
    el.dataset.frame = look.kind;
    if (look.colors) {
        el.style.setProperty('--f1', look.colors[0]);
        el.style.setProperty('--f2', look.colors[1] || look.colors[0]);
    }
}

export function withAlpha(color, a) {
    if (color.startsWith('hsl(')) return color.replace('hsl(', 'hsla(').replace(')', `, ${a})`);
    if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `, ${a})`);
    return hexA(color, a);
}

function hexA(c, a) {
    const n = parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
