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
| Capitalism | `bank` (`b`) · `work` (`w`) · `gw` · `daily` · `rsa` · `rob <@user>` · `give <@user> <montant>` · `shop` · `buy <slave\|cave\|contremaitre\|cadenas>` · `mine` (`m`) |
| Casino | `plinko` (interface) · `gamble <r\|b\|g> <mise>` (`g`) · `slots <mise>` · `blackjack <mise>` (`bj`) · `mines <mise> [bombes]` · `crash <mise> [auto]` · `loto [tickets]` · `duel <@user> <mise>` |
| Paris | `matchs [foot\|lol]` · `parier <n°> <1\|N\|2> <mise>` · `mesparis` · `elo` |
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
- **LoL** : Worlds, MSI, First Stand, LEC, EWC quand Riot le publie. Pas de cote bookmaker en esport : le bot tient un **classement Elo**. Au premier passage il prend une fois le classement public du tournoi en cours, puis seuls les résultats le font bouger. `=elo` montre si les équipes ont vraiment divergé. Les paris ferment au début du match (pas de pari en direct : les cotes ne suivent pas la partie en cours).
- `=matchs`, `=matchs lol`, `=parier 12 1 500`, `=mesparis`, ou l'onglet **Paris** de l'app. Une mise par match, plafond 100 000 RB. Quota API-Football (100 req/jour) géré tout seul : le bot garde toujours de quoi régler les paris. Match annulé : remboursement. Les gains comptent dans la saison.

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

## Crédit

`=credit <montant>` : emprunt avec **10 % de frais**. Plafond de dette selon le niveau : **5 000 + 3 000 par niveau** (max 250 000). Tant qu'il reste une dette, une part de tout ce qui rentre part à la banque (10 % à 50 %) et `=give` est bloqué (sinon on pourrait emprunter et tout donner à un pote). `=rembourser <montant|all>` pour solder plus vite.

## 🎯 Plinko : le jeu avec une vraie interface (Activity Discord)

Le Plinko s'ouvre **dans Discord**, dans sa propre fenêtre : un plateau animé, le son, des rafales de billes. Tout le vocal joue sur le même plateau et voit les billes des autres en direct. Mêmes Rokbux, même niveau, même saison que le reste du bot. Le serveur tire le chemin de chaque bille, l'interface ne fait que l'animer : impossible de tricher depuis le navigateur.

Mise de 10 à 1 000 000, 3 risques (doux, normal, sale), 8, 12 ou 16 rangées, jusqu'à x1000. Le jeu reverse ~99 % des mises.

### Mise en route (une seule fois, ~15 min)

**1. Secret OAuth** · Developer Portal → ton app → **OAuth2** → *Reset Secret* → copie-le dans le `.env` :
```
DISCORD_CLIENT_SECRET=le_secret
```
Toujours dans OAuth2 → *Redirects*, ajoute `https://127.0.0.1` (Discord en exige un, il ne sert pas).

**2. Tunnel Cloudflare** (ton domaine doit être sur Cloudflare)
- dash.cloudflare.com → **Zero Trust** → *Networks* → *Tunnels* → *Create a tunnel* → *Cloudflared* → nom `slibart`
- copie le jeton affiché (la longue chaîne après `--token`) dans le `.env` :
  ```
  CF_TUNNEL_TOKEN=le_jeton
  ```
- onglet *Public hostname* : sous-domaine `lab`, ton domaine, service **HTTP** → `bot:3001`

**3. Activer l'Activity** · Developer Portal → ton app → **Activities** → *Settings* → active *Enable Activities*. Puis *URL Mappings* → *Root Mapping* : préfixe `/`, cible `lab.ton-domaine.fr` (sans https).

**4. Lancer**
```bash
docker compose --profile tunnel up -d --build
docker compose logs -f bot     # doit afficher "[activity] Plinko sur le port 3001"
```

**5. Jouer** · dans le chat, y compris sur téléphone : `=g r 300`, `=slots 100`, `=pk 100`. Sur PC, le vocal et la fusée 🚀 ouvrent en plus la fenêtre. `/plinko` sans mise tente d'ouvrir cette fenêtre.

### Tester sur ton PC sans Discord

```
ACTIVITY_DEV=true
```
dans le `.env`, relance, puis ouvre http://localhost:3001/?name=Hicham. **Remets `false` après** : en mode test, on se connecte sous n'importe quel nom (c'est bloqué à travers le tunnel, mais autant ne pas le laisser).

### Ça ne marche pas ?
- **Écran « Connexion à Discord… » bloqué** : `DISCORD_CLIENT_SECRET` faux ou absent, ou pas de redirect dans OAuth2.
- **Page blanche / erreur Cloudflare** : le *Public hostname* doit pointer vers `bot:3001` (pas localhost), et le tunnel doit être lancé avec `--profile tunnel`.
- **Le bot n'apparaît pas dans la liste des Activités** : vérifie *Enable Activities* et le *Root Mapping*, puis redémarre Discord.

### 🎰 L'app du casino (tous les jeux d'argent passent par là)

L'activité Discord (la fenêtre dans un vocal) ne s'ouvre pas sur téléphone. Les jeux se jouent donc aussi dans le chat, avec des boutons : `=g r 300`, `=slots 100`, `=bj 200`, `=mines 200`, `=crash 300`, `=pk 100`, `=loto 5`, `=duel @quelqu'un 200`. Sur PC, le vocal et la fusée 🚀 restent là pour la même table.

- **Casino** : Plinko, Crash (une fusée pour tout le vocal), Roulette, Slots (jackpot progressif), Blackjack, Mines, Loto (tirage à 21h) et Duel pierre-feuille-ciseaux entre deux joueurs de l'app. On ne tape que la mise, tout le reste se fait avec des boutons. Une manche de Crash en cours est reprise si le bot redémarre : les mises ne disparaissent pas avec le process.
- **Centre des paris** (colonne de gauche) : tout le monde voit tous les paris en deux temps, d'abord la mise puis le résultat. Plus la mise est grosse, plus la carte est grande. Le résultat rayonne en vert ou en rouge, plus fort quand la somme est grosse. Un tapis de plus de 1 000 illumine l'écran de tout le monde, une mise ≥ 2 000 gagnée notifie tout le monde avec le GIF perso du gagnant, et les grosses pertes ont droit à des 🤣.
- **#bot** : un seul message, la tribune, se met à jour avec les gros paris (≥ 500). Le GIF perso d'un gros gain reste un message à part. Pas besoin d'être dans le vocal pour voir la tribune.
- **#daily** : récap du jour à 23h55 (rois du jour, gros perdants, plus gros gain et plus grosse perte par jeu, le plus accro). `=recap` pour l'envoyer tout de suite.
- **Paris** : onglet à côté du casino, mêmes tickets que `=parier`.
- **Work** : Work et Gamblework sont des morceaux du salaire de `=work` et `=gw` (une demi-heure). Les clics ne s'ajoutent pas à la commande. La mine est la même pioche que `=mine`, une fois par minute. Un « ! » apparaît sur l'onglet quand un clic est dispo. Les quotas sont en base : un redémarrage ne les remet pas à zéro. `=buy contremaitre` (100 000 RB, une fois) encaisse le `=work` tout seul et fait passer chaque esclave de +25 à +45 RB par demi-heure. Même pot : le chat, l'app et le contremaître ne paient pas deux fois.
- **Carte** : 20 maisons, pas une par membre. La 21e personne n'en a pas. Sa pp et son nom au-dessus, ses caves dessinées en dessous. Plus on a de RB, plus la maison est grande (+10 % max à 10 000) et plus elle brille. `=initmap` place les maisons des membres déjà connus, dans la limite des 20 places.
- **Profils** : clic sur n'importe quelle pp pour voir le profil complet (image, badges, stats, niveau…).
- **Boutique** : cadres d'avatar à 500 RB (décorations, drapeaux, anneaux), dont certains ne tombent que des coffres, et GIF de victoire perso à 1 000 RB (lien Tenor ou Giphy). Les anciens skins de billes, traînées et tables ont été remboursés automatiquement.

Salons : le bot cherche les salons nommés `bot` et `daily`, ou prend `BOT_CHANNEL_ID` et `DAILY_CHANNEL_ID` dans le `.env`.

## Savoir si le bot est vivant

Au démarrage et à l'arrêt, un message part dans le salon `ops` ou `admin`, ou dans `OPS_CHANNEL_ID` : commit (ou version), heure de Paris, activity up ou down.

La base est sauvegardée tous les jours dans `backups/` (les 7 derniers fichiers `slip-*.sql`) par le service `backup` de Docker. `docker compose up -d` lance aussi cette sauvegarde.

Les caves ont un entretien quotidien qui grandit avec leur nombre. Au-dessus de 20 000 RB, 1 % par jour part à la banque du slip, plafonné à 5 000. `=bank` affiche les deux.

Si un token (bot, secret OAuth, jeton de tunnel) a été collé dans un chat, régénère-le et remplace la ligne du `.env`. Ne le recolle nulle part. Le dépôt ne contient pas le `.env`.

### Images de l'Activity (carte dans la liste des Activités)

Developer Portal → ton app → **Activities → Art Assets**, avec les fichiers du dossier `assets/discord/` :
- **Cover Art** : `cover-16x9.png` et `cover-13x11.png`
- **Video Preview** : `preview-640x360.mp4` (se lance au survol de la carte)
- **Embedded Background** : `background-16x9.png`

Et dans **General Information** : **App Icon** = `app-icon-1024.png` (c'est l'icône à côté des pseudos dans le vocal), plus une description courte, par exemple « Lâche des billes, vise les bords. Tout le vocal joue sur le même plateau, jusqu'à ×1000. »
