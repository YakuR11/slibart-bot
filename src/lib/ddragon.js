// Data Dragon (Riot) : liste des champions a jour, skins et lore en francais.
const path = require('node:path');
const fs = require('node:fs');
const db = require('../db');
const log = require('./logger');

const DD = 'https://ddragon.leagueoflegends.com';
let version = null;
const detailCache = new Map();

async function getJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
}

async function latestVersion() {
    if (version) return version;
    try {
        [version] = await getJson(`${DD}/api/versions.json`);
    } catch {
        version = '12.4.1';
    }
    return version;
}

const loadingImg = (ddid, skin = 0) => `${DD}/cdn/img/champion/loading/${ddid}_${skin}.jpg`;
const splashImg = (ddid, skin = 0) => `${DD}/cdn/img/champion/splash/${ddid}_${skin}.jpg`;

/** Detail d'un champion en francais (skins, lore). null si indispo. */
async function detail(ddid) {
    if (detailCache.has(ddid)) return detailCache.get(ddid);
    try {
        const v = await latestVersion();
        const data = await getJson(`${DD}/cdn/${v}/data/fr_FR/champion/${ddid}.json`);
        const d = data.data[ddid];
        detailCache.set(ddid, d);
        return d;
    } catch {
        return null;
    }
}

/**
 * Synchronise la table champions :
 *  - remplit ddid pour les anciennes lignes (sinon =info cassait sur Kai'Sa, Cho'Gath...)
 *  - ajoute les champions sortis depuis (Briar, Hwei, Smolder, Aurora...)
 */
async function syncChampions() {
    let list;
    try {
        const v = await latestVersion();
        list = (await getJson(`${DD}/cdn/${v}/data/en_US/champion.json`)).data;
    } catch (e) {
        log.warn('[champions] Data Dragon injoignable, on utilise data/champion.json');
        list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'champion.json'), 'utf8')).data;
    }
    const champs = Object.values(list);
    const existing = await db.q('SELECT id, name, ddid FROM champions');
    const byName = new Map(existing.map((r) => [String(r.name).toLowerCase(), r]));
    const byDd = new Set(existing.map((r) => r.ddid).filter(Boolean));
    let added = 0;
    let fixed = 0;
    for (const c of champs) {
        const row = byName.get(c.name.toLowerCase());
        if (row) {
            if (!row.ddid) {
                await db.exec('UPDATE champions SET ddid = ? WHERE id = ?', [c.id, row.id]);
                fixed++;
            }
            continue;
        }
        if (byDd.has(c.id)) continue;
        await db.exec(
            'INSERT INTO champions (name, title, lore, tags, img, ddid) VALUES (?, ?, ?, ?, ?, ?)',
            [c.name, c.title, c.blurb, (c.tags || []).join(', '), loadingImg(c.id), c.id],
        );
        added++;
    }
    log.info(`[champions] ${champs.length} champions connus · ${added} ajoutés · ${fixed} corrigés`);
}

module.exports = { detail, syncChampions, loadingImg, splashImg, latestVersion };
