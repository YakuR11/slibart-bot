// Verifie toutes les images de config/content.json au demarrage (puis toutes les 24h).
// Les liens morts sont ignores automatiquement : une commande n'affiche jamais d'image cassee.
const config = require('../config');
const log = require('./logger');

const dead = new Set();
let lastReport = { checked: 0, dead: [] };

function allUrls() {
    const C = config.content;
    const urls = [
        ...C.cold.images,
        ...Object.values(C.cold.special || {}).map((s) => s.image),
        ...C.remember.images,
        ...C.bubble,
        ...C.presetProfileImages,
        C.defaultProfileImage,
        C.presetProfileImagesPreview,
        C.helpImage,
        C.slipbankThumbnail,
    ];
    return [...new Set(urls.filter(Boolean))];
}

async function isAlive(url) {
    const opts = { redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'Mozilla/5.0 (slibart-bot image check)' } };
    try {
        let res = await fetch(url, { ...opts, method: 'HEAD' });
        if (res.status === 405 || res.status === 403) res = await fetch(url, { ...opts, method: 'GET', headers: { ...opts.headers, Range: 'bytes=0-1023' } });
        if (!res.ok) return false;
        const type = res.headers.get('content-type') || '';
        return /^(image|video)\//.test(type);
    } catch {
        return false;
    }
}

async function checkAll() {
    const urls = allUrls();
    const results = await Promise.all(urls.map(async (u) => [u, await isAlive(u)]));
    dead.clear();
    for (const [u, ok] of results) if (!ok) dead.add(u);
    lastReport = { checked: urls.length, dead: [...dead] };
    if (dead.size) log.warn(`[images] ${dead.size}/${urls.length} liens morts ignores (=images pour la liste)`);
    else log.info(`[images] ${urls.length} images ok`);
    return lastReport;
}

/** url si elle marche, sinon null */
const ok = (url) => (url && !dead.has(url) ? url : null);

/** image au hasard parmi celles qui marchent (null si aucune) */
function pick(list) {
    const alive = (list || []).filter((u) => u && !dead.has(u));
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
}

function start() {
    checkAll().catch(() => {});
    setInterval(() => checkAll().catch(() => {}), 24 * 3600 * 1000).unref();
}

module.exports = { checkAll, ok, pick, start, report: () => lastReport, allUrls };
