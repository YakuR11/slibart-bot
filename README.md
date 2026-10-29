# slibart puant v2

Bot Discord du serveur : économie Rokbux, casino, duels, champions LoL, profils, musique Spotify.
Toutes les anciennes commandes `=...` marchent pareil, et en plus en slash `/...`.

## Créer ton bot Discord (5 min)

1. https://discord.com/developers/applications → **New Application** (le nom que tu veux)
2. Onglet **Bot** → **Reset Token** → copie-le (tu le donnes au script d'install)
3. Toujours dans **Bot** → coche **Message Content Intent** → Save
4. Lance le bot (voir Installation) : au démarrage il affiche dans les logs le **lien d'invitation** avec les bonnes permissions, clique dessus pour l'ajouter à ton serveur

Pour copier les IDs (serveur, ton compte) : Paramètres Discord → Avancés → **Mode développeur**, puis clic droit → Copier l'identifiant.

L'emoji rokbux vient du serveur de ton pote : si ton bot n'est pas sur ce serveur, il passe automatiquement sur 💰. Pour avoir ton propre emoji, ajoute-le sur ton serveur, tape `\:rokbux:` dans un salon pour avoir son code `<:rokbux:123...>` et mets-le dans `RB_EMOJI` du `.env`.

## Installation

### Le plus rapide (Windows + Docker Desktop)

Dézippe le dossier, lance Docker Desktop, ouvre un terminal dans le dossier puis :

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

Le script demande le token, l'ID du serveur et ton ID, génère le mot de passe de la base, puis lance tout.

### Option A : Docker (le plus simple, la base est incluse)

```bash
cp .env.example .env      # puis remplis DISCORD_TOKEN, DB_PASSWORD, OWNER_IDS, GUILD_ID...
docker compose up -d --build
docker compose logs -f bot
```

### Option B : sans Docker (avec ton MySQL/MariaDB actuel)

```bash
npm install
cp .env.example .env      # DB_HOST=localhost, DB_PASSWORD=ton mot de passe, DB_NAME=slip
npm start
```

Node 20 minimum. `npm run check` vérifie que toutes les commandes se chargent sans se connecter à Discord.

## Spotify (=musique)

Depuis février 2026, Spotify ne donne le contenu d'une playlist **qu'au compte qui la possède**. Il faut donc un refresh token de ce compte :

1. Dashboard Spotify → ton app → Settings → Redirect URIs : ajoute `http://127.0.0.1:8888/callback`
2. Mets `SPOTIFY_CLIENT_ID` et `SPOTIFY_CLIENT_SECRET` dans le `.env`
3. `npm run spotify-auth`, ouvre le lien, connecte-toi avec le compte proprio des playlists
4. Copie la ligne `SPOTIFY_REFRESH_TOKEN=...` dans le `.env`

Les playlists de `content.json` sont celles de ton pote : soit il fait l'étape 3 avec son compte, soit tu remplaces les IDs par tes propres playlists (l'ID est dans le lien `open.spotify.com/playlist/<ID>`).

## Modifier le contenu sans toucher au code

Tout est dans `config/content.json` : images de `=cold`/`=remember`/`=bubble`, playlists, triggers (`wawa`...), liste des insultes comptées, citations de `=bank`, statuts du bot, images de profil prédéfinies.

**Images** : au démarrage (puis toutes les 24h) le bot vérifie tous les liens. Les morts sont ignorés tout seuls, une commande n'affiche jamais d'image cassée. `=images` (admin) donne la liste des liens morts à remplacer. Les images hébergées sur Discord (`cdn.discordapp.com`, `media.discordapp.net`) sont forcément mortes : Discord fait expirer ces liens au bout de 24h. Si tu veux les remettre, héberge-les ailleurs (imgur, image-heberg...).

## Commandes

| Catégorie | Commandes |
|---|---|
| Général | `cold` `remember` `bubble` `trad [langue] <texte>` `musique <type>` `changemot <mot>` `motfav [@user]` |
| Profil | `profile [@user]` (`p`) · `set <img\|acc\|bio> <valeur>` · `setimg` `setbio` `setacc` · `wacount` |
| Capitalism | `bank` (`b`) · `work` (`w`) · `gw` · `daily` · `rsa` · `rob <@user>` · `give <@user> <montant>` · `shop` · `buy <slave\|cave\|cadenas>` · `mine` (`m`) |
| Casino | `gamble <r\|b\|g> <mise>` (`g`) · `slots <mise>` · `blackjack <mise>` (`bj`) · `mines <mise> [bombes]` · `crash <mise> [auto]` · `loto [tickets]` · `duel <@user> <mise>` |
| Paris | `matchs [foot\|lol]` · `parier <n°> <1\|N\|2> <mise>` · `mesparis` |
| Progression | `cd` · `coffres` · `ouvrir` · `quetes` (`q`) · `succes` · `niveau` (`lvl`) · `rappels` |
| Classements | `semaine` (saison) · `top <capital\|niveau\|succes\|winstreak\|insult\|rolls\|mine\|pertes\|gains\|streak\|esclaves\|champions>` · `topc` `topi` `topl`... · `slipbank` |
| Champions | `rc` · `info <champion>` · `mmr [@user]` (`cave`) · `release <champion>` · `giftchamp <@user> <champion>` |
| Utilitaires | `help [commande]` · `ping` · `botinfo` |
| Admin (OWNER_IDS) | `addrb` · `setrb` · `resetcd` · `setsalon` · `drawloto` · `images` · `syncchamps` |

Les mises acceptent `all`, `half`, `1k`, `2.5k`, `1m`. Chaque résultat de casino a des boutons **Rejouer / ½ / x2 / All-in**.

### Ce qui fait revenir les joueurs

**Tous les jours**
- `=daily` : RB + un **coffre** (rare tous les 7 jours, légendaire tous les 30), streak visuel. Alerte en MP quand le streak va sauter
- **3 quêtes** + coffre rare quand les 3 sont finies
- **Happy hour surprise** : 1h tirée au hasard entre 18h et 23h, work/gw/daily/mine et XP **x2**, annoncée avec @here
- **Loterie** tirée à 21h

**Récompenses surprises**
- **Coffres** (commun / rare / légendaire) avec ouverture animée et bouton « Ouvrir le suivant ». Un coffre peut en contenir un meilleur
- **Drops dans le chat** : pendant les discussions un sac (RB ou coffre) tombe, le premier qui clique le garde
- **Jackpot progressif** aux slots : 3 % de chaque mise, 777 avec une mise de 100+ rafle tout
- 1 chance sur 40 de trouver un coffre en minant

**Compétition et social**
- **Saison de la semaine** : classement du casino, le dimanche à 21h le top 3 gagne 10k / 5k / 2,5k + coffres, puis tout repart à 0
- **`=rob`** : vol entre joueurs (45 %), amende si raté, **cadenas** pour se protéger, 1h d'immunité après un vol
- **Big wins annoncés** dans le salon du casino (`=setsalon`)
- 9 classements, 24 succès, niveaux

**Pour ne décrocher personne**
- Pack de bienvenue : 500 RB + coffre rare + tuto
- Bonus de retour après 3 jours d'absence : 1 000 RB + coffre rare
- `=rsa` quand on est à sec
- `=cd` : tout ce qui est dispo, avec boutons pour tout faire en 1 clic. `=rappels` en MP

### Paris sportifs

`SPORTS_API_KEY` dans le `.env` (clé API-Football). Le bot ne l'écrase pas au dézippage : ajoute la ligne si elle n'y est pas encore.

- **Foot** : Ligue 1, Premier League, Liga, Serie A, Bundesliga, Ligue des champions, Europa League. Avec la clé gratuite, l'API ne donne qu'hier, aujourd'hui et demain : le lendemain, la fenêtre avance. Cotes bookmaker, marge 5 %, figées sur le ticket. Mises fermées au coup d'envoi.
- **LoL** : Worlds, LEC, MSI, EWC quand Riot le publie. La cote part du bilan du tournoi et bouge avec le score des maps. Pas de cote bookmaker.
- `=matchs`, `=matchs lol`, `=parier 12 1 500`, `=mesparis`. Une mise par match, plafond 100 000 RB. Match annulé : remboursement. Les gains comptent dans la saison.

## Mettre à jour le bot

Dézippe la nouvelle version **par-dessus** l'ancienne (ton `.env` et ta base sont gardés), puis :

```bash
docker compose up -d --build
```

## Structure

```
src/
  index.js          démarrage, events Discord
  config.js         lit le .env et config/content.json
  db.js             pool MySQL, migrations auto, transactions
  commands/         une catégorie par fichier
  events/triggers.js  wawa, compteur d'insultes, compteur de rolls
  lib/              economie, cooldowns, contexte prefixe/slash, pagination, spotify, data dragon
config/content.json contenu modifiable
data/champion.json  liste de secours si Data Dragon est injoignable
```

Ajouter une commande = ajouter un objet dans un fichier de `src/commands/`, elle marche direct en `=` et en `/` et apparaît dans `=help`.
