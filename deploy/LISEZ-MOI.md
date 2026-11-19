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

## Machines ComfyUI du réseau local

Le VPS est dans le réseau Tailscale de David (`vps-placenta`) : les machines se déclarent dans `state/local_settings.json`
de l'instance avec leur adresse Tailscale (`"workers": [{"name": "FORD", "url": "http://100.x.x.x:8188"}]`,
`"render": {"target": "auto"}`). La liste est relue à chaud, sans redémarrage. ComfyUI doit écouter sur le réseau
(`--listen 0.0.0.0`). Le VPS porte l'étiquette `tag:vps`, que la politique Tailscale limite au port 8188 des machines.

## À savoir

- Aucune clé sur le serveur : chaque utilisateur entre sa clé fal dans les réglages de son navigateur.
- Les cartes de bouches (`app/web/mouths/`) ne sont pas dans le dépôt : le lip sync n'a pas de bouches en ligne tant
  qu'elles ne sont pas refaites avec une planche à nous.
- Envoi d'un gros paquet `.bwpack` : Traefik coupe une lecture au bout de 60 s par défaut ; pour copier une banque,
  passer par rsync vers `state/data/` plutôt que par l'interface.
- Comptes : celui qui a le mot de passe de l'instance en est l'administrateur (nom vide à la connexion). Dans
  Réglages > Mon compte il change son mot de passe et crée des invités (nom + mot de passe tiré au hasard, montré une
  seule fois). Un invité utilise toute l'application sur la même banque et les mêmes storyboards, sans toucher aux
  réglages ni aux comptes ; un invité VIP a en plus la bibliothèque en ligne. Pour des données séparées, il faut
  toujours une instance par personne.
