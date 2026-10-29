// Recupere un SPOTIFY_REFRESH_TOKEN pour =musique (a faire UNE fois).
// Depuis fevrier 2026, Spotify ne donne le contenu d'une playlist qu'au compte qui la possede
// (ou y collabore). Il faut donc se connecter avec le compte proprietaire des playlists.
//
// 1. Sur https://developer.spotify.com/dashboard -> ton app -> Settings -> Redirect URIs :
//    ajoute exactement  http://127.0.0.1:8888/callback
// 2. Mets SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET dans le .env
// 3. npm run spotify-auth  -> ouvre le lien affiche, connecte-toi, copie le token dans le .env
const http = require('node:http');
const config = require('../src/config');

const { clientId, clientSecret } = config.spotify;
if (!clientId || !clientSecret) {
    console.error('Mets SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET dans le .env avant.');
    process.exit(1);
}

const REDIRECT = 'http://127.0.0.1:8888/callback';
const scope = 'playlist-read-private playlist-read-collaborative';
const url = `https://accounts.spotify.com/authorize?${new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: REDIRECT, scope })}`;

http.createServer(async (req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== '/callback') return res.end();
    const code = u.searchParams.get('code');
    if (!code) {
        res.end(`Erreur : ${u.searchParams.get('error')}`);
        return;
    }
    const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }),
    });
    const data = await r.json();
    if (!data.refresh_token) {
        res.end(`Erreur : ${JSON.stringify(data)}`);
        console.error(data);
        process.exit(1);
    }
    res.end('OK ! Tu peux fermer cet onglet et regarder le terminal.');
    console.log(`\nAjoute cette ligne dans ton .env :\n\nSPOTIFY_REFRESH_TOKEN=${data.refresh_token}\n`);
    process.exit(0);
}).listen(8888, '127.0.0.1', () => {
    console.log(`Ouvre ce lien dans ton navigateur :\n\n${url}\n`);
});
