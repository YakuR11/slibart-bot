// Client Spotify minimal (fetch natif, plus besoin de spotify-web-api-node).
// Depuis fevrier 2026, en "Development Mode", Spotify ne renvoie le contenu d'une playlist
// QUE si l'utilisateur connecte en est proprietaire/collaborateur. Le mode client_credentials
// seul ne suffit donc plus : il faut un SPOTIFY_REFRESH_TOKEN du compte qui possede les playlists
// (voir scripts/spotify-auth.js). Sans refresh token on tente quand meme en client_credentials.
const config = require('../config');

let token = null;
let tokenExp = 0;
const cache = new Map(); // playlistId -> { tracks, t }

async function getToken() {
    if (token && Date.now() < tokenExp - 60_000) return token;
    const { clientId, clientSecret, refreshToken } = config.spotify;
    if (!clientId || !clientSecret) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET manquants dans le .env');
    const body = refreshToken
        ? new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
        : new URLSearchParams({ grant_type: 'client_credentials' });
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    if (!res.ok) throw new Error(`token Spotify refuse (${res.status})`);
    const data = await res.json();
    token = data.access_token;
    tokenExp = Date.now() + data.expires_in * 1000;
    return token;
}

async function api(url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
    if (res.status === 401) token = null;
    if (!res.ok) {
        const err = new Error(`Spotify ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

/** Toutes les pistes d'une playlist (cache 30 min) */
async function playlistTracks(playlistId) {
    const hit = cache.get(playlistId);
    if (hit && Date.now() - hit.t < 30 * 60_000) return hit.tracks;

    const tracks = [];
    // nouvel endpoint /items (2026), ancien /tracks en secours
    let base = `https://api.spotify.com/v1/playlists/${playlistId}/items`;
    let next = `${base}?limit=100`;
    let triedLegacy = false;
    while (next) {
        let page;
        try {
            page = await api(next);
        } catch (e) {
            if (!triedLegacy && tracks.length === 0 && e.status === 404) {
                triedLegacy = true;
                base = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
                next = `${base}?limit=100`;
                continue;
            }
            throw e;
        }
        for (const it of page.items || []) {
            const t = it.item || it.track;
            if (t && t.type !== 'episode' && t.name) tracks.push(t);
        }
        next = page.next;
        if (tracks.length > 2000) break;
    }
    if (!tracks.length) throw new Error('playlist vide ou inaccessible (refresh token du proprietaire requis)');
    cache.set(playlistId, { tracks, t: Date.now() });
    return tracks;
}

async function randomTrack(playlistId) {
    const tracks = await playlistTracks(playlistId);
    const t = tracks[Math.floor(Math.random() * tracks.length)];
    return {
        title: t.name,
        artists: (t.artists || []).map((a) => a.name).join(', '),
        album: t.album?.name || '',
        cover: t.album?.images?.[0]?.url || null,
        link: t.external_urls?.spotify || `https://open.spotify.com/playlist/${playlistId}`,
        total: tracks.length,
    };
}

module.exports = { randomTrack, getToken };
