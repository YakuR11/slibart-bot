// Catalogue des skins (cosmetiques uniquement, aucun effet sur les gains).
// Fichier "pur" : utilise par le bot (achat, coffres) ET compile dans l'interface de l'Activity.

const RARITIES = {
    commun: { label: 'Commun', color: '#b9c2c9', price: 2_500, rank: 1 },
    rare: { label: 'Rare', color: '#4fa3ff', price: 10_000, rank: 2 },
    epique: { label: 'Épique', color: '#b56bff', price: 40_000, rank: 3 },
    legendaire: { label: 'Légendaire', color: '#ffb627', price: 150_000, rank: 4 },
};

const SLOTS = {
    ball: { label: 'Billes', hint: 'Ta bille au Plinko et ta fusée au Crash' },
    trail: { label: 'Traînées', hint: 'Ce que ta bille laisse derrière elle' },
    board: { label: 'Tables', hint: 'Le tapis de jeu (Plinko et Crash)' },
    frame: { label: 'Cadres', hint: 'Autour de ton avatar, visible par tout le vocal' },
};

// look : description visuelle lue par l'interface
// chest : uniquement dans les coffres (pas en vente)
const SKINS = {
    // ---- billes ----
    'ball:or': { slot: 'ball', name: 'Or', rarity: 'commun', default: true, look: { kind: 'grad', colors: ['#fff6d8', '#ffd76a', '#8a5a12'] } },
    'ball:rubis': { slot: 'ball', name: 'Rubis', rarity: 'commun', look: { kind: 'grad', colors: ['#ffd0d6', '#ff3355', '#5a0012'] } },
    'ball:emeraude': { slot: 'ball', name: 'Émeraude', rarity: 'commun', look: { kind: 'grad', colors: ['#d8ffe6', '#25d07a', '#063d22'] } },
    'ball:saphir': { slot: 'ball', name: 'Saphir', rarity: 'commun', look: { kind: 'grad', colors: ['#d6ecff', '#3d8bff', '#0b2257'] } },
    'ball:neon-rose': { slot: 'ball', name: 'Néon rose', rarity: 'rare', look: { kind: 'glow', colors: ['#ffffff', '#ff4fd8', '#7a0a63'], glow: '#ff4fd8' } },
    'ball:neon-cyan': { slot: 'ball', name: 'Néon cyan', rarity: 'rare', look: { kind: 'glow', colors: ['#ffffff', '#3df2ff', '#06606b'], glow: '#3df2ff' } },
    'ball:lave': { slot: 'ball', name: 'Lave', rarity: 'epique', look: { kind: 'lava', glow: '#ff6a00' } },
    'ball:galaxie': { slot: 'ball', name: 'Galaxie', rarity: 'epique', look: { kind: 'galaxy', glow: '#9b7bff' } },
    'ball:caca': { slot: 'ball', name: 'La Puante', rarity: 'epique', chest: true, look: { kind: 'emoji', emoji: '💩', glow: '#9be15d' } },
    'ball:disco': { slot: 'ball', name: 'Boule disco', rarity: 'legendaire', look: { kind: 'rainbow', glow: '#ffffff' } },
    'ball:slip': { slot: 'ball', name: 'Slip doré', rarity: 'legendaire', chest: true, look: { kind: 'emoji', emoji: '🩲', glow: '#ffd76a' } },

    // ---- trainees ----
    'trail:classique': { slot: 'trail', name: 'Classique', rarity: 'commun', default: true, look: { kind: 'same' } },
    'trail:etincelles': { slot: 'trail', name: 'Étincelles', rarity: 'rare', look: { kind: 'sparks', color: '#fff1c4' } },
    'trail:feu': { slot: 'trail', name: 'Feu', rarity: 'rare', look: { kind: 'fire' } },
    'trail:arc': { slot: 'trail', name: 'Arc-en-ciel', rarity: 'epique', look: { kind: 'rainbow' } },
    'trail:puante': { slot: 'trail', name: 'Nuage puant', rarity: 'epique', chest: true, look: { kind: 'stink', color: '#9be15d' } },
    'trail:comete': { slot: 'trail', name: 'Comète', rarity: 'legendaire', look: { kind: 'comet', color: '#bfe9ff' } },

    // ---- tables ----
    'board:canard': { slot: 'board', name: 'Feutrine canard', rarity: 'commun', default: true, look: { felt: '#0f4c4a', felt2: '#13615e', peg: ['#f3cf7a', '#d9a441', '#8f6420'] } },
    'board:nuit': { slot: 'board', name: 'Nuit bleue', rarity: 'commun', look: { felt: '#0e1a3a', felt2: '#1d2f66', peg: ['#eef4ff', '#9fb4e6', '#4a5a8a'] } },
    'board:velours': { slot: 'board', name: 'Velours', rarity: 'rare', look: { felt: '#3b0f3f', felt2: '#5e1d63', peg: ['#ffd6f5', '#e58fd0', '#7a2d6a'] } },
    'board:egout': { slot: 'board', name: 'Égout du slip', rarity: 'epique', chest: true, look: { felt: '#1f2a12', felt2: '#34451d', peg: ['#e6ffb3', '#9be15d', '#3f5c1c'] } },
    'board:neon': { slot: 'board', name: 'Néon', rarity: 'epique', look: { felt: '#07080f', felt2: '#141a33', peg: ['#c9fbff', '#3df2ff', '#0a6b75'], neon: '#3df2ff' } },
    'board:or': { slot: 'board', name: 'Salon doré', rarity: 'legendaire', look: { felt: '#120d05', felt2: '#2b2110', peg: ['#fff3c4', '#ffd76a', '#9a6a10'], neon: '#ffd76a' } },

    // ---- cadres d'avatar ----
    'frame:aucun': { slot: 'frame', name: 'Aucun', rarity: 'commun', default: true, look: { kind: 'none' } },
    'frame:laiton': { slot: 'frame', name: 'Laiton', rarity: 'commun', look: { kind: 'ring', colors: ['#f3cf7a', '#8f6420'] } },
    'frame:argent': { slot: 'frame', name: 'Argent', rarity: 'commun', look: { kind: 'ring', colors: ['#ffffff', '#8d97a0'] } },
    'frame:neon': { slot: 'frame', name: 'Néon', rarity: 'rare', look: { kind: 'glow', colors: ['#3df2ff'] } },
    'frame:flammes': { slot: 'frame', name: 'Flammes', rarity: 'epique', look: { kind: 'fire' } },
    'frame:couronne': { slot: 'frame', name: 'Couronne', rarity: 'legendaire', look: { kind: 'crown' } },
    'frame:arc': { slot: 'frame', name: 'Arc-en-ciel', rarity: 'legendaire', chest: true, look: { kind: 'rainbow' } },
};

const price = (id) => (SKINS[id] && !SKINS[id].chest && !SKINS[id].default ? RARITIES[SKINS[id].rarity].price : null);

const DEFAULTS = Object.fromEntries(Object.keys(SLOTS).map((slot) => [slot, Object.keys(SKINS).find((k) => SKINS[k].slot === slot && SKINS[k].default)]));

module.exports = { RARITIES, SLOTS, SKINS, DEFAULTS, price };
