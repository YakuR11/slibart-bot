// Catalogue des cadres d'avatar (cosmetique, visible par tout le monde dans l'app).
// Fichier "pur" : utilise par le bot (achat, coffres) ET compile dans l'interface de l'Activity.
//
// look.kind :
//   none / ring / glow / fire / rainbow : anneau autour de l'avatar (CSS)
//   deco  : decoration dessinee (chapeau, oreilles...) -> look.deco
//   flag  : drapeau -> look.flag (anneau aux couleurs + medaillon)

const PRICE = 500;
const GIF_PRICE = 1000; // GIF perso affiche quand tu gagnes gros

const SLOTS = {
    frame: { label: 'Cadres', hint: 'Autour de ta pp, visible par tout le vocal' },
};

const FLAGS = {
    fr: { name: 'France', colors: ['#0055a4', '#ffffff', '#ef4135'] },
    dz: { name: 'Algérie', colors: ['#006233', '#ffffff', '#d21034'] },
    ma: { name: 'Maroc', colors: ['#c1272d', '#c1272d', '#006233'] },
    tn: { name: 'Tunisie', colors: ['#e70013', '#ffffff', '#e70013'] },
    sn: { name: 'Sénégal', colors: ['#00853f', '#fdef42', '#e31b23'] },
    ci: { name: 'Côte d\'Ivoire', colors: ['#f77f00', '#ffffff', '#009e60'] },
    ml: { name: 'Mali', colors: ['#14b53a', '#fcd116', '#ce1126'] },
    cm: { name: 'Cameroun', colors: ['#007a5e', '#ce1126', '#fcd116'] },
    pt: { name: 'Portugal', colors: ['#006600', '#ffcc00', '#ff0000'] },
    es: { name: 'Espagne', colors: ['#aa151b', '#f1bf00', '#aa151b'] },
    it: { name: 'Italie', colors: ['#009246', '#ffffff', '#ce2b37'] },
    be: { name: 'Belgique', colors: ['#000000', '#fae042', '#ed2939'] },
    tr: { name: 'Turquie', colors: ['#e30a17', '#ffffff', '#e30a17'] },
    br: { name: 'Brésil', colors: ['#009c3b', '#ffdf00', '#002776'] },
    jp: { name: 'Japon', colors: ['#ffffff', '#bc002d', '#ffffff'] },
    km: { name: 'Comores', colors: ['#ffc61e', '#3a75c4', '#3d8e33'] },
};

const SKINS = {
    'frame:aucun': { slot: 'frame', name: 'Aucun', default: true, look: { kind: 'none' } },
    // anneaux
    'frame:laiton': { slot: 'frame', name: 'Laiton', look: { kind: 'ring', colors: ['#f3cf7a', '#8f6420'] } },
    'frame:argent': { slot: 'frame', name: 'Argent', look: { kind: 'ring', colors: ['#ffffff', '#8d97a0'] } },
    'frame:neon': { slot: 'frame', name: 'Néon', look: { kind: 'glow', colors: ['#3df2ff'] } },
    'frame:flammes': { slot: 'frame', name: 'Flammes', look: { kind: 'fire' } },
    'frame:arc': { slot: 'frame', name: 'Arc-en-ciel', look: { kind: 'rainbow' } },
    // decorations
    'frame:couronne': { slot: 'frame', name: 'Couronne', look: { kind: 'deco', deco: 'crown' } },
    'frame:communisme': { slot: 'frame', name: 'Camarade', look: { kind: 'deco', deco: 'communism' } },
    'frame:gilet': { slot: 'frame', name: 'Gilet jaune', look: { kind: 'deco', deco: 'gilet' } },
    'frame:chapka': { slot: 'frame', name: 'Chapka', look: { kind: 'deco', deco: 'chapka' } },
    'frame:chapeau': { slot: 'frame', name: 'Haut-de-forme', look: { kind: 'deco', deco: 'tophat' } },
    'frame:beret': { slot: 'frame', name: 'Béret baguette', look: { kind: 'deco', deco: 'beret' } },
    'frame:lapin': { slot: 'frame', name: 'Oreilles de lapin', look: { kind: 'deco', deco: 'bunny' } },
    'frame:chat': { slot: 'frame', name: 'Chat', look: { kind: 'deco', deco: 'cat' } },
    'frame:chien': { slot: 'frame', name: 'Chien', look: { kind: 'deco', deco: 'dog' } },
    'frame:aureole': { slot: 'frame', name: 'Auréole', look: { kind: 'deco', deco: 'halo' } },
    'frame:diable': { slot: 'frame', name: 'Cornes du diable', look: { kind: 'deco', deco: 'horns' } },
    'frame:chantier': { slot: 'frame', name: 'Casque de chantier', look: { kind: 'deco', deco: 'hardhat' } },
    'frame:casque': { slot: 'frame', name: 'Casque audio', look: { kind: 'deco', deco: 'headphones' } },
    'frame:slip': { slot: 'frame', name: 'Slip doré', chest: true, look: { kind: 'deco', deco: 'slip' } },
};
for (const [code, f] of Object.entries(FLAGS)) {
    SKINS[`frame:flag-${code}`] = { slot: 'frame', name: f.name, flag: true, look: { kind: 'flag', flag: code, colors: f.colors } };
}

const price = (id) => (SKINS[id] && !SKINS[id].chest && !SKINS[id].default ? PRICE : null);

const DEFAULTS = { frame: 'frame:aucun' };

// pour l'affichage (le shop n'a plus de raretes, tout est au meme prix)
const RARITIES = {};

module.exports = { SLOTS, SKINS, FLAGS, DEFAULTS, RARITIES, PRICE, GIF_PRICE, price };
