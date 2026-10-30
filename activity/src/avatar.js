// Avatars avec cadre (skins) : anneaux en CSS, decorations et drapeaux en SVG dessines ici.
import catalog from '../../src/lib/skins-catalog.js';

export const { SKINS, FLAGS, DEFAULTS, PRICE, GIF_PRICE } = catalog;

export function frameLook(skins) {
    const id = skins?.frame && SKINS[skins.frame] ? skins.frame : DEFAULTS.frame;
    return SKINS[id].look;
}

// ---------------------------------------------------------------------------
// decorations : viewBox 0 0 100 100, l'avatar occupe le cercle (50, 50) r 36
// ---------------------------------------------------------------------------
const STAR = (cx, cy, r, fill) => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r;
        pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
};

const DECOS = {
    crown: `
        <path d="M27 24 L33 6 L42 18 L50 2 L58 18 L67 6 L73 24 Z" fill="#ffd34d" stroke="#a8740c" stroke-width="2" stroke-linejoin="round"/>
        <rect x="27" y="22" width="46" height="6" rx="2" fill="#f2b51f" stroke="#a8740c" stroke-width="1.5"/>
        <circle cx="50" cy="12" r="3" fill="#e0245e"/><circle cx="36" cy="16" r="2.2" fill="#3d8bff"/><circle cx="64" cy="16" r="2.2" fill="#25d07a"/>`,
    communism: `
        <circle cx="50" cy="50" r="40" fill="none" stroke="#d40000" stroke-width="7"/>
        <circle cx="50" cy="50" r="43.5" fill="none" stroke="#ffd700" stroke-width="1.2"/>
        <g transform="translate(78 78)">
            <circle r="15" fill="#d40000" stroke="#ffd700" stroke-width="2"/>
            <path d="M-7 4 A8 8 0 1 0 2 -7" fill="none" stroke="#ffd700" stroke-width="3" stroke-linecap="round"/>
            <path d="M-6 -6 L6 6" stroke="#ffd700" stroke-width="3.2" stroke-linecap="round"/>
            <rect x="1" y="-9" width="9" height="4.5" rx="1" fill="#ffd700" transform="rotate(45 5.5 -6.75)"/>
        </g>
        ${STAR(50, 8, 5, '#ffd700')}${STAR(18, 22, 3.5, '#ffd700')}${STAR(82, 22, 3.5, '#ffd700')}`,
    gilet: `
        <circle cx="50" cy="50" r="40" fill="none" stroke="#e6ff00" stroke-width="5"/>
        <path d="M14 78 Q20 95 50 98 Q80 95 86 78 L66 70 L50 88 L34 70 Z" fill="#d7f20c" stroke="#9fb400" stroke-width="1.5"/>
        <path d="M18 85 L40 80 M60 80 L82 85" stroke="#e8eef2" stroke-width="4" stroke-linecap="round"/>
        <path d="M22 92 L42 88 M58 88 L78 92" stroke="#e8eef2" stroke-width="3" stroke-linecap="round"/>
        <text x="50" y="97" font-size="7" font-weight="900" text-anchor="middle" fill="#3d4a00" font-family="Arial,sans-serif">GJ</text>`,
    chapka: `
        <path d="M20 30 Q50 -6 80 30 L80 34 L20 34 Z" fill="#6b4a2e"/>
        <path d="M18 28 Q50 18 82 28 L84 38 Q50 30 16 38 Z" fill="#a37a52"/>
        <path d="M14 34 Q10 52 18 62 L24 60 Q20 48 22 36 Z" fill="#a37a52"/>
        <path d="M86 34 Q90 52 82 62 L76 60 Q80 48 78 36 Z" fill="#a37a52"/>
        ${STAR(50, 22, 6, '#d40000')}`,
    tophat: `
        <rect x="32" y="0" width="36" height="24" rx="3" fill="#1b1b22"/>
        <rect x="32" y="16" width="36" height="5" fill="#c8102e"/>
        <ellipse cx="50" cy="24" rx="30" ry="5" fill="#26262e"/>`,
    beret: `
        <ellipse cx="44" cy="18" rx="28" ry="11" fill="#1d1d24" transform="rotate(-10 44 18)"/>
        <rect x="42" y="3" width="3" height="6" rx="1.5" fill="#1d1d24"/>
        <g transform="rotate(-35 80 70)"><rect x="66" y="66" width="34" height="9" rx="4.5" fill="#d99b4a" stroke="#9b6326" stroke-width="1"/>
        <path d="M72 67 l3 7 M79 67 l3 7 M86 67 l3 7 M93 67 l3 7" stroke="#f2cf8d" stroke-width="1.5"/></g>`,
    bunny: `
        <ellipse cx="34" cy="8" rx="8" ry="22" fill="#f4f4f8" stroke="#d8d8e0" stroke-width="1" transform="rotate(-14 34 8)"/>
        <ellipse cx="34" cy="9" rx="4" ry="15" fill="#ffb3c7" transform="rotate(-14 34 9)"/>
        <ellipse cx="66" cy="8" rx="8" ry="22" fill="#f4f4f8" stroke="#d8d8e0" stroke-width="1" transform="rotate(14 66 8)"/>
        <ellipse cx="66" cy="9" rx="4" ry="15" fill="#ffb3c7" transform="rotate(14 66 9)"/>`,
    cat: `
        <path d="M18 28 L22 2 L42 18 Z" fill="#f08c2e" stroke="#a85412" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M23 21 L25 9 L35 17 Z" fill="#ffc9a3"/>
        <path d="M82 28 L78 2 L58 18 Z" fill="#f08c2e" stroke="#a85412" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M77 21 L75 9 L65 17 Z" fill="#ffc9a3"/>
        <path d="M2 58 L16 60 M2 66 L16 64 M98 58 L84 60 M98 66 L84 64" stroke="#2b2b2b" stroke-width="1.6" stroke-linecap="round"/>`,
    dog: `
        <path d="M22 16 Q4 20 6 48 Q8 64 18 60 Q22 40 30 24 Z" fill="#8b5a2b" stroke="#5b3a1b" stroke-width="1.5"/>
        <path d="M78 16 Q96 20 94 48 Q92 64 82 60 Q78 40 70 24 Z" fill="#8b5a2b" stroke="#5b3a1b" stroke-width="1.5"/>
        <ellipse cx="50" cy="92" rx="7" ry="5" fill="#2b2b2b"/>`,
    halo: `
        <ellipse cx="50" cy="8" rx="24" ry="6" fill="none" stroke="#fff3a6" stroke-width="4"/>
        <ellipse cx="50" cy="8" rx="24" ry="6" fill="none" stroke="#ffd34d" stroke-width="1.5"/>`,
    horns: `
        <path d="M24 26 Q14 10 20 0 Q24 14 34 20 Z" fill="#d42020" stroke="#7a0d0d" stroke-width="1.5"/>
        <path d="M76 26 Q86 10 80 0 Q76 14 66 20 Z" fill="#d42020" stroke="#7a0d0d" stroke-width="1.5"/>
        <path d="M84 84 Q96 84 94 96 Q90 88 84 92 Z" fill="#d42020"/>`,
    hardhat: `
        <path d="M20 26 Q22 2 50 2 Q78 2 80 26 Z" fill="#ffc400" stroke="#b38900" stroke-width="1.5"/>
        <rect x="14" y="24" width="72" height="6" rx="3" fill="#ffb000" stroke="#b38900" stroke-width="1.2"/>
        <rect x="46" y="2" width="8" height="22" rx="2" fill="#ffd84d"/>`,
    headphones: `
        <path d="M14 52 Q14 6 50 6 Q86 6 86 52" fill="none" stroke="#2b2d42" stroke-width="6" stroke-linecap="round"/>
        <rect x="6" y="44" width="14" height="24" rx="6" fill="#ef233c"/>
        <rect x="80" y="44" width="14" height="24" rx="6" fill="#ef233c"/>`,
    slip: `
        <circle cx="50" cy="50" r="40" fill="none" stroke="#ffd76a" stroke-width="4"/>
        <circle cx="50" cy="50" r="44" fill="none" stroke="#ffd76a" stroke-width="1" opacity="0.6"/>
        <g transform="translate(50 9)">
            <path d="M-16 -6 L16 -6 L14 2 Q6 3 3 10 L-3 10 Q-6 3 -14 2 Z" fill="#ffd34d" stroke="#a8740c" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M-16 -6 L16 -6" stroke="#fff3c4" stroke-width="2"/>
        </g>
        ${STAR(16, 30, 3, '#fff3c4')}${STAR(86, 72, 3.5, '#fff3c4')}${STAR(84, 26, 2.5, '#fff3c4')}`,
};

/** medaillon de drapeau (en bas a droite) */
function flagBadge(code, colors) {
    const id = `fc-${code}`;
    const [a, b, c] = colors;
    let body;
    const H = (cols) => cols.map((col, i) => `<rect x="-14" y="${-14 + (i * 28) / cols.length}" width="28" height="${28 / cols.length + 0.3}" fill="${col}"/>`).join('');
    const V = (cols) => cols.map((col, i) => `<rect x="${-14 + (i * 28) / cols.length}" y="-14" width="${28 / cols.length + 0.3}" height="28" fill="${col}"/>`).join('');
    switch (code) {
        case 'dz': body = `${V([a, b])}<circle cx="1" cy="0" r="7" fill="${c}"/><circle cx="3.2" cy="0" r="5.6" fill="${b}"/>${STAR(4.6, 0, 3.2, c)}`; break;
        case 'ma': body = `<rect x="-14" y="-14" width="28" height="28" fill="${a}"/>${STAR(0, 1, 8, 'none').replace('fill="none"', `fill="none" stroke="${c}" stroke-width="1.6"`)}`; break;
        case 'tn': body = `<rect x="-14" y="-14" width="28" height="28" fill="${a}"/><circle r="8" fill="#fff"/><circle cx="-1" r="5.5" fill="${a}"/><circle cx="0.6" r="4.4" fill="#fff"/>${STAR(1.5, 0, 2.8, a)}`; break;
        case 'tr': body = `<rect x="-14" y="-14" width="28" height="28" fill="${a}"/><circle cx="-3" r="7" fill="#fff"/><circle cx="-1" r="5.6" fill="${a}"/>${STAR(5, 0, 3.4, '#fff')}`; break;
        case 'jp': body = `<rect x="-14" y="-14" width="28" height="28" fill="#fff"/><circle r="7" fill="${b}"/>`; break;
        case 'sn': body = `${V(colors)}${STAR(0, 0, 4, a)}`; break;
        case 'cm': body = `${V(colors)}${STAR(0, 0, 4, c)}`; break;
        case 'br': body = `<rect x="-14" y="-14" width="28" height="28" fill="${a}"/><path d="M0 -10 L13 0 L0 10 L-13 0 Z" fill="${b}"/><circle r="5.5" fill="${c}"/>`; break;
        case 'pt': body = `<rect x="-14" y="-14" width="11" height="28" fill="${a}"/><rect x="-3" y="-14" width="17" height="28" fill="${c}"/><circle cx="-3" r="5" fill="${b}"/>`; break;
        case 'es': body = `<rect x="-14" y="-14" width="28" height="28" fill="${a}"/><rect x="-14" y="-7" width="28" height="14" fill="${b}"/>`; break;
        case 'km': body = `${H(['#ffc61e', '#ffffff', '#ce1126', '#3a75c4'])}<path d="M-14 -14 L2 0 L-14 14 Z" fill="${c}"/>`; break;
        case 'fr': case 'it': case 'be': case 'ci': case 'ml':
        default: body = V(colors);
    }
    return `<g transform="translate(80 80)"><clipPath id="${id}"><circle r="14"/></clipPath><g clip-path="url(#${id})">${body}</g><circle r="14" fill="none" stroke="#fff" stroke-width="2.4"/></g>`;
}

function flagRing(colors) {
    // anneau aux 3 couleurs (arcs)
    const r = 40;
    const C = 2 * Math.PI * r;
    return colors.map((col, i) => `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-dasharray="${C / 3} ${C}" stroke-dashoffset="${-(C / 3) * i}" transform="rotate(-90 50 50)"/>`).join('')
        + `<circle cx="50" cy="50" r="43" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1"/>`;
}

const svgCache = new Map();
export function decoSvg(look) {
    const key = look.kind === 'flag' ? `flag:${look.flag}` : look.deco;
    if (svgCache.has(key)) return svgCache.get(key);
    let inner = '';
    if (look.kind === 'deco') inner = DECOS[look.deco] || '';
    if (look.kind === 'flag') inner = flagRing(look.colors) + flagBadge(look.flag, look.colors);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" overflow="visible">${inner}</svg>`)}`;
    svgCache.set(key, url);
    return url;
}

/**
 * Avatar avec son cadre. size en px. Renvoie un <span class="av-wrap">.
 * opts.onClick(id) : ouvre le profil
 */
export function avatarEl(user, size = 32, opts = {}) {
    const wrap = document.createElement('span');
    wrap.className = 'av-wrap';
    wrap.style.setProperty('--s', `${size}px`);
    const img = document.createElement('img');
    img.className = 'av';
    img.alt = '';
    img.src = user?.avatar || '';
    img.loading = 'lazy';
    wrap.append(img);
    setFrame(wrap, user?.skins);
    if (opts.color) wrap.style.setProperty('--c', opts.color);
    if (opts.onClick && user?.id) {
        wrap.classList.add('click');
        wrap.title = `Voir le profil de ${user.name || ''}`;
        wrap.addEventListener('click', (e) => {
            e.stopPropagation();
            opts.onClick(user.id);
        });
    }
    return wrap;
}

export function setFrame(wrap, skins) {
    const look = frameLook(skins);
    wrap.dataset.frame = look.kind;
    const img = wrap.querySelector('.av');
    if (look.colors && look.kind !== 'flag') {
        img.style.setProperty('--f1', look.colors[0]);
        img.style.setProperty('--f2', look.colors[1] || look.colors[0]);
    }
    let deco = wrap.querySelector('.deco');
    if (look.kind === 'deco' || look.kind === 'flag') {
        if (!deco) {
            deco = document.createElement('img');
            deco.className = 'deco';
            deco.alt = '';
            wrap.append(deco);
        }
        deco.src = decoSvg(look);
    } else deco?.remove();
}

/** version canvas (carte) : image du cadre a dessiner par-dessus l'avatar */
const imgCache = new Map();
export function decoImage(skins) {
    const look = frameLook(skins);
    if (look.kind !== 'deco' && look.kind !== 'flag') return null;
    const url = decoSvg(look);
    let img = imgCache.get(url);
    if (!img) {
        img = new Image();
        img.src = url;
        imgCache.set(url, img);
    }
    return img;
}
