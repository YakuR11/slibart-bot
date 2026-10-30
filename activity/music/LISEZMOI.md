# Musique de fond

Pose ton fichier ici sous le nom **`casino.mp3`**, puis relance :

```
docker compose --profile tunnel up -d --build
```

- Il tourne en boucle, volume bas, dans l'app.
- Bouton note de musique en haut à droite pour la couper (chacun choisit pour soi).
- Le bouton son général coupe aussi la musique.
- Pas de fichier = pas de bouton, rien ne casse.

Le fichier n'est pas versionné (`.gitignore`) : la musique d'un jeu vidéo appartient à son éditeur,
on ne la met pas sur GitHub.
