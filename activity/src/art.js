// Illustrations des cartes du lobby et logo : tout est dessine ici en SVG (aucune image externe).
// Le fil rouge : le slip. Chaque jeu a sa carte, sa couleur et son dessin.

/** un slip : (x, y) = coin haut gauche, w = largeur. tissu / ceinture / couture au choix */
export function slip(x, y, w, { fill = '#fff', band = '#2ee62b', seam = 'rgba(0,0,0,.18)', rot = 0 } = {}) {
    const s = w / 48;
    return `<g transform="translate(${x} ${y}) rotate(${rot} ${w / 2} ${w * 0.37}) scale(${s})">
<path d="M2 2H46V12Q45 27 31 35H17Q3 27 2 12Z" fill="${fill}"/>
<path d="M2 12Q13 20 17 35M46 12Q35 20 31 35M24 10V35" fill="none" stroke="${seam}" stroke-width="1.6" stroke-linecap="round"/>
<path d="M2 2H46V10H2Z" fill="${band}"/>
<path d="M6 6h4M13 6h4M20 6h8M31 6h4M38 6h4" stroke="rgba(0,0,0,.22)" stroke-width="1.4" stroke-linecap="round"/>
</g>`;
}

/** les ondes de puanteur (3 petits serpentins) */
export function stink(x, y, h = 14, color = '#9dff5c', n = 3, gap = 9) {
    let out = '';
    const q = h / 4;
    for (let i = 0; i < n; i++) {
        const dx = x + i * gap;
        out += `<path d="M${dx} ${y}q${q} ${-q} 0 ${-2 * q}q${-q} ${-q} 0 ${-2 * q}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity="${0.9 - i * 0.12}"/>`;
    }
    return out;
}

const shadow = (cx, cy, rx, ry = rx / 4) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="rgba(0,0,0,.22)"/>`;
const pips = (pts, r = 3.2, fill = '#1a2c38') => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join('');
const cardShape = (x, y, rot, inner = '') => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-20" y="-28" width="40" height="56" rx="6" fill="#fff"/><rect x="-20" y="-28" width="40" height="56" rx="6" fill="none" stroke="rgba(0,0,0,.12)"/>${inner}</g>`;
const txt = (x, y, s, size, fill = '#fff', extra = '') => `<text x="${x}" y="${y}" font-family="Bricolage, system-ui, sans-serif" font-weight="800" font-size="${size}" fill="${fill}" text-anchor="middle" ${extra}>${s}</text>`;

/** dessin de chaque jeu, dans une boite 120 x 96 */
const ART = {
    plinko: () => {
        let pegs = '';
        for (let r = 0; r < 4; r++) for (let j = 0; j <= r + 1; j++) pegs += `<circle cx="${60 + (j - (r + 1) / 2) * 20}" cy="${22 + r * 16}" r="3.4" fill="#fff" opacity="${0.55 + r * 0.12}"/>`;
        return `${pegs}<circle cx="72" cy="46" r="9" fill="#ffd23f"/><circle cx="69" cy="43" r="3" fill="#fff" opacity=".7"/>
<rect x="14" y="80" width="26" height="14" rx="5" fill="#ff4f6a"/><rect x="47" y="80" width="26" height="14" rx="5" fill="#ffb627"/><rect x="80" y="80" width="26" height="14" rx="5" fill="#ff4f6a"/>
${txt(27, 91, '33×', 10)}${txt(60, 91, '2×', 10, '#3a2500')}${txt(93, 91, '33×', 10)}`;
    },
    crash: () => `<path d="M10 86Q54 82 82 40" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
<path d="M10 86Q54 82 82 40L82 86Z" fill="rgba(255,255,255,.18)"/>
${slip(68, 8, 40, { rot: -32, fill: '#fff', band: '#ffd23f' })}
<path d="M62 52l-12 10M70 58l-8 12M56 46l-14 4" stroke="#ffd23f" stroke-width="4" stroke-linecap="round"/>`,
    mines: () => `${shadow(42, 88, 26)}<path d="M22 40L34 26H56L68 40L45 80Z" fill="#2ee62b"/><path d="M22 40H68L45 80Z" fill="#1fb81d"/><path d="M34 26L39 40L45 80L51 40L56 26" fill="none" stroke="#b8ffb0" stroke-width="2" stroke-linejoin="round" opacity=".7"/><path d="M34 26H56L51 40H39Z" fill="#8bff7a"/>
${shadow(88, 90, 18)}<circle cx="88" cy="66" r="19" fill="#1a2c38"/><circle cx="81" cy="59" r="5" fill="#fff" opacity=".25"/><rect x="83" y="40" width="10" height="9" rx="2" fill="#2f4553"/><path d="M88 40Q88 28 98 26" fill="none" stroke="#ffb627" stroke-width="3" stroke-linecap="round"/><path d="M98 18l2 5 5 1-4 3 1 6-4-3-5 3 2-6-4-3 5-1Z" fill="#ffd23f"/>`,
    roulette: () => {
        let w = '';
        for (let i = 0; i < 12; i++) {
            const a0 = (i * 30 * Math.PI) / 180;
            const a1 = ((i + 1) * 30 * Math.PI) / 180;
            const p = (r, a) => `${(60 + r * Math.sin(a)).toFixed(1)} ${(48 - r * Math.cos(a)).toFixed(1)}`;
            w += `<path d="M${p(38, a0)}A38 38 0 0 1 ${p(38, a1)}L${p(18, a1)}A18 18 0 0 0 ${p(18, a0)}Z" fill="${i === 0 ? '#2ee62b' : i % 2 ? '#e11d48' : '#1a2c38'}"/>`;
        }
        return `${shadow(60, 92, 40)}<circle cx="60" cy="48" r="44" fill="#ffd23f"/><circle cx="60" cy="48" r="40" fill="#0b1a24"/>${w}<circle cx="60" cy="48" r="18" fill="#fff"/>${slip(48, 40, 24, { fill: '#2ee62b', band: '#17901a' })}<circle cx="82" cy="24" r="6.5" fill="#fff"/><circle cx="80" cy="22" r="2" fill="#c9d2e0"/>`;
    },
    dice: () => `${shadow(60, 90, 40)}<g transform="rotate(-14 42 52)"><rect x="16" y="26" width="52" height="52" rx="10" fill="#fff"/>${pips([[30, 40], [54, 40], [42, 52], [30, 64], [54, 64]], 4.4)}</g>
<g transform="rotate(12 86 58)"><rect x="64" y="36" width="44" height="44" rx="9" fill="#ff4f6a"/>${pips([[76, 48], [96, 48], [76, 68], [96, 68], [76, 58], [96, 58]], 3.6, '#fff')}</g>`,
    limbo: () => `<path d="M12 84l22-12M22 92l26-14M40 94l14-8" stroke="rgba(255,255,255,.55)" stroke-width="5" stroke-linecap="round"/>
${slip(40, 12, 62, { rot: -24, fill: '#fff', band: '#2ee62b' })}
<rect x="6" y="14" width="46" height="24" rx="8" fill="#1a2c38" transform="rotate(-10 29 26)"/>${txt(29, 32, '999×', 15, '#ffd23f', 'transform="rotate(-10 29 26)"')}`,
    keno: () => `${shadow(60, 90, 42)}<rect x="12" y="20" width="44" height="44" rx="10" fill="#2f4553" transform="rotate(-8 34 42)"/>${txt(34, 52, '8', 30, '#fff', 'transform="rotate(-8 34 42)"')}
<rect x="62" y="34" width="46" height="46" rx="10" fill="#2ee62b" transform="rotate(9 85 57)"/>${txt(85, 68, '9', 32, '#0b2a0a', 'transform="rotate(9 85 57)"')}
<rect x="30" y="62" width="30" height="30" rx="8" fill="#fff" transform="rotate(4 45 77)"/>${txt(45, 84, '16', 17, '#1a2c38', 'transform="rotate(4 45 77)"')}`,
    tower: () => {
        let b = '';
        const rows = [['#2f4553', '#2ee62b', '#2f4553'], ['#2ee62b', '#2f4553', '#2f4553'], ['#2f4553', '#2f4553', '#2ee62b'], ['#2f4553', '#2ee62b', '#2f4553']];
        rows.forEach((row, r) => row.forEach((c, i) => { b += `<rect x="${30 + i * 21}" y="${74 - r * 16}" width="18" height="13" rx="4" fill="${c}"/>`; }));
        return `${shadow(60, 92, 40)}${b}<path d="M60 22V6" stroke="#fff" stroke-width="3" stroke-linecap="round"/>${slip(60, 4, 30, { fill: '#fff', band: '#ffd23f', rot: 8 })}
<path d="M18 86l8-8M102 86l-8-8" stroke="rgba(255,255,255,.4)" stroke-width="4" stroke-linecap="round"/>`;
    },
    hilo: () => `${shadow(56, 92, 34)}${cardShape(46, 54, -10, `${txt(-9, -10, 'J', 18, '#1a2c38')}${slip(-9, 0, 20, { fill: '#ff4f6a', band: '#c41e3a' })}`)}
<path d="M92 20l14 18H98v12H86V38h-8Z" fill="#2ee62b"/><path d="M92 90l14-18H98V60H86v12h-8Z" fill="#ff4f6a"/>`,
    slots: () => `${shadow(60, 92, 44)}<rect x="10" y="18" width="100" height="66" rx="12" fill="#1a2c38"/><rect x="16" y="26" width="26" height="50" rx="6" fill="#fff"/><rect x="47" y="26" width="26" height="50" rx="6" fill="#fff"/><rect x="78" y="26" width="26" height="50" rx="6" fill="#fff"/>
${txt(29, 61, '7', 30, '#ff4f6a')}${slip(50, 40, 20, { fill: '#ffd23f', band: '#e09b00' })}${txt(91, 61, '7', 30, '#ff4f6a')}
<path d="M10 51h100" stroke="#ffd23f" stroke-width="2" opacity=".8"/>`,
    blackjack: () => `${shadow(60, 92, 40)}${cardShape(44, 54, -14, `${txt(-10, -10, 'A', 17, '#1a2c38')}${slip(-10, 2, 20, { fill: '#1a2c38', band: '#2f4553' })}`)}${cardShape(76, 52, 12, `${txt(-10, -10, 'K', 17, '#ff4f6a')}${slip(-10, 2, 20, { fill: '#ff4f6a', band: '#c41e3a' })}`)}
<rect x="42" y="4" width="36" height="18" rx="9" fill="#ffd23f"/>${txt(60, 18, '21', 13, '#3a2500')}`,
    loto: () => `${shadow(60, 92, 44)}<g transform="rotate(-9 60 54)"><path d="M12 30H108V46A8 8 0 0 0 108 62V78H12V62A8 8 0 0 0 12 46Z" fill="#fff"/><path d="M78 32V76" stroke="#1a2c38" stroke-width="2.5" stroke-dasharray="4 4"/>
${slip(26, 38, 38, { fill: '#2ee62b', band: '#17901a' })}<path d="M93 42l3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z" fill="#ffd23f"/></g>`,
    duel: () => `${shadow(60, 92, 42)}<g stroke-linecap="round"><path d="M24 22L78 76" stroke="#fff" stroke-width="8"/><path d="M96 22L42 76" stroke="#fff" stroke-width="8"/><path d="M64 78l18-18M56 78l-18-18" stroke="#ffd23f" stroke-width="7"/><path d="M84 86l-8-8M36 86l8-8" stroke="#1a2c38" stroke-width="8"/></g>
<circle cx="60" cy="49" r="12" fill="#ff4f6a"/>${txt(60, 54, 'VS', 12)}`,
};

/** liste des jeux du lobby, dans l'ordre d'affichage par defaut */
export const GAMES = [
    { id: 'mines', name: 'Mines', g: ['#1e8bff', '#0a4fd6'], tag: '×15k max' },
    { id: 'roulette', name: 'Roulette', g: ['#12b886', '#0b6b4f'], tag: 'Vrai tapis' },
    { id: 'dice', name: 'Dice', g: ['#a44dff', '#5a1fd1'], tag: 'Nouveau' },
    { id: 'limbo', name: 'Limbo', g: ['#ffb300', '#ff6a00'], tag: 'Nouveau' },
    { id: 'plinko', name: 'Plinko', g: ['#8a4dff', '#ff3f8e'], tag: '×1000 max' },
    { id: 'crash', name: 'Crash', g: ['#ffb627', '#ff5a1f'], tag: 'En direct' },
    { id: 'keno', name: 'Keno', g: ['#2f7bff', '#1436b8'], tag: 'Nouveau' },
    { id: 'tower', name: 'Tour du Slip', g: ['#ff7a3d', '#d6213c'], tag: 'Nouveau' },
    { id: 'hilo', name: 'HiLo', g: ['#22c55e', '#0c7a3a'], tag: 'Nouveau' },
    { id: 'slots', name: 'Slots', g: ['#ff4fb0', '#8a2be2'], tag: 'Jackpot' },
    { id: 'blackjack', name: 'Blackjack', g: ['#ff4f6a', '#b3123a'], tag: 'Naturel ×2.5' },
    { id: 'loto', name: 'Loto', g: ['#19c2b0', '#0b6f8a'], tag: 'Tirage 21h' },
    { id: 'duel', name: 'Duel', g: ['#5b6cff', '#27308f'], tag: '1 contre 1' },
];

export function gameArt(id) {
    return `<svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">${(ART[id] || (() => ''))()}</svg>`;
}

/** logo : le slip qui pue + le nom */
export function logoSvg() {
    return `<svg class="logo-mark" viewBox="0 0 54 50" aria-hidden="true">${stink(15, 15, 13, '#9dff5c')}${slip(3, 16, 48, { fill: '#fff', band: '#2ee62b' })}</svg>`;
}

/** grande illustration du bandeau du lobby */
export function heroArt() {
    return `<svg viewBox="0 0 220 150" aria-hidden="true" focusable="false">
<circle cx="110" cy="80" r="64" fill="rgba(255,255,255,.08)"/><circle cx="110" cy="80" r="44" fill="rgba(255,255,255,.08)"/>
${stink(78, 36, 26, '#c8ff8a', 4, 20)}
${slip(46, 40, 128, { fill: '#fff', band: '#0b2a0a', seam: 'rgba(0,0,0,.14)', rot: -6 })}
<circle cx="34" cy="112" r="13" fill="#ffd23f"/><circle cx="34" cy="112" r="8" fill="none" stroke="#b97a00" stroke-width="2.4"/>
<circle cx="192" cy="46" r="10" fill="#ffd23f"/><circle cx="192" cy="46" r="6" fill="none" stroke="#b97a00" stroke-width="2"/>
<circle cx="184" cy="122" r="7" fill="#ffd23f"/><path d="M22 44l3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z" fill="#fff" opacity=".8"/>
</svg>`;
}
