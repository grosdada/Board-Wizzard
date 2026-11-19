# Board Wizzard sur le VPS

Même modèle que Writer-Share : un conteneur Docker par instance derrière Traefik, HTTPS automatique.
`*.placenta.cloud` pointe déjà sur le VPS : aucun réglage DNS à faire pour un sous-domaine de placenta.cloud.

## Première installation

```
mkdir -p /home/claude/apps/board-wizzard && cd /home/claude/apps/board-wizzard
git clone https://github.com/grosdada/Board-Wizzard.git src
sh src/deploy/nouvelle-instance.sh david boardwizzard.placenta.cloud
```

Une personne de plus = une ligne de plus (sa banque, ses storyboards, son mot de passe) :

```
sh src/deploy/nouvelle-instance.sh marie marie.bw.placenta.cloud
```

## Mise à jour du code

```
cd /home/claude/apps/board-wizzard/src && git pull
cd ../david && docker compose restart          (à faire quand la file de tâches est vide)
```

Ajouter `--build` (`docker compose up -d --build`) seulement si `deploy/Dockerfile` a changé.

## Sauvegarde

Tout est dans `<nom>/state/` (réglages, banque, storyboards). Chaque nuit :

```
tar czf /home/claude/backups/bw-david-$(date +%F).tgz --exclude=state/tmp --exclude=state/data/tmp \
    --exclude=state/data/qa --exclude=state/data/trash -C /home/claude/apps/board-wizzard/david state
find /home/claude/backups -name 'bw-*.tgz' -mtime +7 -delete
```

## À savoir

- Aucune clé sur le serveur : chaque utilisateur entre sa clé fal dans les réglages de son navigateur.
- Les cartes de bouches (`app/web/mouths/`) ne sont pas dans le dépôt : le lip sync n'a pas de bouches en ligne tant
  qu'elles ne sont pas refaites avec une planche à nous.
- Envoi d'un gros paquet `.bwpack` : Traefik coupe une lecture au bout de 60 s par défaut ; pour copier une banque,
  passer par rsync vers `state/data/` plutôt que par l'interface.
- Toute personne connectée à une instance peut en changer les réglages, mot de passe compris : une instance = une
  personne ou un groupe de confiance.
