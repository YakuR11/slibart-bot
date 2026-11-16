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
| Casino | `plinko` (interface) · `dice <mise> [chance %]` · `limbo <mise> [cible]` · `roulette <mise> <paris...>` (`g`) · `slots <mise>` · `blackjack <mise>` (`bj`) · `mines <mise> [bombes]` · `crash <mise> [auto]` · `loto [tickets]` · `duel <@user> <mise>` |
| Paris | `matchs [foot\|lol]` · `parier <n°> <1\|N\|2> <mise>` · `mesparis` · `elo` |
| Progression | `cd` · `coffres` · `ouvrir` · `quetes` (`q`) · `succes` · `niveau` (`lvl`) · `rappels` |
| Clans | `clan` (guerre de la semaine entre serveurs) · `clan rejoindre` |
| Classements | `semaine` (saison) · `top <capital\|niveau\|succes\|winstreak\|insult\|rolls\|mine\|pertes\|gains\|streak\|esclaves\|champions>` · `topc` `topi` `topl`... · `slipbank` |
| Champions | `rc` · `info <champion>` · `mmr [@user]` (`cave`) · `release <champion>` · `giftchamp <@user> <champion>` |
| Utilitaires | `help [commande]` · `ping` · `botinfo` |
| Admin (OWNER_IDS) | `event [mult] [durée]` · `pluie` · `salonbot` · `addrb` · `setrb` · `resetcd` · `setsalon` · `drawloto` · `images` · `syncchamps` |

Les mises acceptent `all`, `half`, `1k`, `2.5k`, `1m`. Chaque résultat de casino a des boutons **Rejouer / ½ / x2 / All-in**.

### Événement (gains multipliés)

`=event 5 48h` (admin) : pendant 48h, tout ce qui rapporte est **x5** : `work`, `gw`, `daily`, `mine`, le salaire du contremaître et toute l'XP. Annonce avec @here dans le salon du casino (`=setsalon`), rappel 2h avant la fin, annonce de fin. Dans l'app : pastille avec le compte à rebours dans l'en-tête et bandeau vert dans le lobby.

- `=event` : état en cours · `=event stop` : arrêt · `=event 3 2j Nom de l'event` : multiplicateur de 2 à 10, durée en `m`, `h` ou `j`
- **Pluies de slips** : pendant l'événement, toutes les 75 à 165 min entre 11h et 1h (heure de Paris), 5 lots tombent dans le salon du casino de chaque serveur, sans @here. Les 5 premiers à cliquer se servent (un lot par personne). `=pluie` en lâche une à la main. Les sacs du chat tombent aussi 3x plus souvent.
- Les gains du casino ne sont **pas** multipliés : un x5 sur des jeux qui reversent ~98 % ferait gagner à tous les coups et casserait l'économie et la saison. Le casino donne en revanche de l'XP x5.
- Pendant un événement, la happy hour (x2) ne s'ajoute pas : c'est le plus gros des deux qui compte.

### Ranger le bot dans ses salons

`=salonbot` (admin) dans un salon : les commandes du bot ne marchent plus que là, sur ce serveur. Refais-le dans un autre salon pour en ajouter un, dans le même pour le retirer. `=salonbot liste` les affiche, `=salonbot off` rouvre tout.

Ailleurs, une commande tapée est refusée avec un petit message, puis commande et message sont effacés au bout de 8 secondes (en slash, le refus n'est visible que par la personne). Les messages normaux donnent toujours de l'XP dans tous les salons, et les petites commandes de discussion (`cold`, `bubble`, `trad`, `musique`, `motfav`...) et les commandes admin restent utilisables partout. Tant qu'aucun salon n'est choisi, rien ne change.

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

## ⚔️ Plusieurs serveurs : la guerre de clans

Le bot peut être invité sur plusieurs serveurs. **Un serveur = un clan.** Le compte en banque d'un joueur est le même partout ; il appartient au premier serveur où il utilise le bot (ou ouvre l'app), et peut changer avec `=clan rejoindre` : libre la première fois, puis une fois par semaine (`=resetcd @membre clan` remet le délai à zéro).

- `=clan` : classement de la semaine, par serveur, au **gain net du casino** de ses membres (la même base que `=semaine`). Le dimanche à 21h, s'il y a au moins deux serveurs qui ont joué, chaque membre du serveur gagnant qui a joué reçoit 1 000 RB + un coffre rare.
- `=setsalon` se fait **sur chaque serveur** : gros gains, événements, pluies, loterie et fin de saison sont annoncés dans tous. Un gros gain sur un serveur s'affiche donc chez les autres.
- Slash commands : avec un seul serveur elles sont posées sur `GUILD_ID` ; dès que le bot est sur deux serveurs il les passe en global tout seul (quelques minutes de délai côté Discord).
- Pas encore par serveur : le fil des paris de l'app dans `#bot`, le récap de `#daily` et le message de vie `ops` restent sur le serveur principal (`GUILD_ID`). La carte du quartier et les classements `=top` sont communs à tous les serveurs.

## 🩲 L'app : le casino du slip (Activity Discord)

L'app s'ouvre sur un **lobby** : bandeau (événement en cours ou reprise de la dernière table), quêtes du jour, puis les 13 jeux en cartes illustrées. Sous chaque carte, le nombre de joueurs vus sur ce jeu dans les 5 dernières minutes (les vrais, rien d'inventé).

| Jeu | Principe | Retour au joueur |
|---|---|---|
| Plinko | billes, 3 risques, 8/12/16 rangées, jusqu'à x1000 | ~99 % |
| Crash | manche commune en direct, encaisse avant l'explosion | voir `crash.js` |
| Mines | 20 cases, 1 à 15 bombes | 97 % |
| **Roulette** | européenne (0 à 36) : vrai tapis, jetons, pleins, chevaux, transversales, carrés, sixains, douzaines, colonnes, chances simples | 97,3 % |
| **Dice** | tirage de 0 à 100, tu règles ta chance (1 à 95 %) au curseur | 98 % |
| **Limbo** | tu vises un multiplicateur (x1.01 à x1000) | 98 % |
| **Keno** | 40 numéros, 1 à 10 cochés, 10 tirés, 3 risques, plafond x1000 | ~97,5 % |
| **Tour du Slip** | 8 étages, 4 difficultés, slips propres ou sales | ~98 % |
| **HiLo** | plus haute ou plus basse, encaisse quand tu veux | ~98 % |
| Slots, Blackjack, Loto, Duel | comme avant | |

L'ancienne roulette à 15 cases a été remplacée par une vraie roulette européenne, dans l'app et dans le chat : `=roulette 100 rouge 17 17-18 d2` mise 100 sur chaque pari (`=g r 500` marche toujours). La table des paris est dans `src/lib/roulette-math.js`, partagée entre le bot, le serveur et l'interface. Les maths des cinq autres nouveaux jeux sont dans `src/activity/origmath.js` ; `node scripts/originals-sim.js` recalcule le retour de chaque table. Dice, Limbo et Keno ont un mode rafale (10 / 25 / 50 / ∞), Espace relance la partie, et une Tour ou un HiLo laissé en cours se reprend à la réouverture.

Toutes les illustrations (cartes, logo, slips) sont dessinées en SVG dans `activity/src/art.js` : pour changer une carte, sa couleur ou son étiquette, c'est la liste `GAMES` en bas de ce fichier.

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

- **Casino** : Plinko, Crash (une fusée pour tout le vocal), Roulette, Slots (grille 6×5 façon Stake : paquets de 8 symboles ou plus, cascades, bombes multiplicatrices, 4 🩲 = 10 tours gratuits où les bombes s'additionnent, achat du bonus à 100× la mise, rafales de 10 à 100 tours d'un coup en Normal/Turbo/Éclair, jackpot sur 6 🩲 avec une mise de 100+ ; RTP ~95 %, vérifiable avec `node scripts/slots-sim.js`), Blackjack, Mines, Loto (tirage à 21h) et Duel pierre-feuille-ciseaux entre deux joueurs de l'app. On ne tape que la mise, tout le reste se fait avec des boutons. Une manche de Crash en cours est reprise si le bot redémarre : les mises ne disparaissent pas avec le process.
- **Centre des paris** (colonne de gauche) : tout le monde voit tous les paris en deux temps, d'abord la mise puis le résultat. Plus la mise est grosse, plus la carte est grande. Le résultat rayonne en vert ou en rouge, plus fort quand la somme est grosse. Un tapis de plus de 1 000 illumine l'écran de tout le monde, une mise ≥ 2 000 gagnée notifie tout le monde avec le GIF perso du gagnant, et les grosses pertes ont droit à des 🤣.
- **#bot** : un seul message, la tribune, se met à jour avec les gros paris (≥ 500). Le GIF perso d'un gros gain reste un message à part. Pas besoin d'être dans le vocal pour voir la tribune.
- **#daily** : récap du jour à 23h55 (rois du jour, gros perdants, plus gros gain et plus grosse perte par jeu, le plus accro). `=recap` pour l'envoyer tout de suite.
- **Paris** : onglet à côté du casino, mêmes tickets que `=parier`.
- **Work** : plus de page Work dans l'app, tout se fait dans le chat avec `=w`, `=gw` et `=m`. `=buy contremaitre` (75 000 RB, une fois) ramasse le `=work` tout seul, sans payer deux fois le même salaire.
- **Empire** (façon tycoon) : salaire par `=work` (30 min, pas par heure), esclaves, caves, entretien et prestige en un coup d'œil. On y achète esclaves, caves, contremaître et cadenas (mêmes prix que `=buy`) ; les cartes brillent quand c'est abordable et un « ! » s'allume sur l'onglet quand un nouvel achat devient possible. Barre d'objectif dans l'en-tête, ce qui est prêt dans le chat (`=w`, `=gw`, `=m`, `=d`), quêtes du jour, top 5 (« X vient de te passer devant »), récap au retour (contremaître, entretien) et petit tuto au premier lancement.
- **Prestige** : à partir de 100 000 RB et 30 esclaves (×1,6 et +5 à chaque niveau), on brûle RB, esclaves et caves contre +20 % permanents sur work, gw, mine, daily et le contremaître (10 niveaux max, x3). Jamais sur le casino ni les quêtes. Le contremaître, l'XP, les objets et les cadres restent. Étoile violette sur la carte et badge sur le profil.
- **Carte** : 48 maisons (8 x 6), pas une par membre. La 49e personne n'en a pas. Sa pp et son nom au-dessus, ses caves dessinées en dessous. La maison change avec le solde : cabane sous 1 000 RB, maison, villa avec piscine dès 10 000, manoir dès 50 000. Elle grandit un peu (+10 % max à 10 000) et brille plus avec les RB. Les 3 plus riches ont une médaille (couronne pour le 1er), les terrains libres sont « à vendre ». Quartier de nuit avec lampadaires et voitures (figé si le système demande moins d'animations). `=initmap` place les maisons des membres déjà connus, dans la limite des 20 places.
- **Profils** : clic sur n'importe quelle pp pour voir le profil complet (image, badges, stats, niveau…).
- **Boutique** : cadres d'avatar à 500 RB (décorations, drapeaux, anneaux), dont certains ne tombent que des coffres, et GIF de victoire perso à 1 000 RB (lien GIPHY uniquement, Tenor ne marche pas). Les anciens skins de billes, traînées et tables ont été remboursés automatiquement.

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
