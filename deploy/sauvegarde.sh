#!/bin/sh
# Sauvegarde nocturne de toutes les instances Board Wizzard du VPS (lancée par cron).
# Une copie par jour et par instance dans /home/claude/backups/board-wizzard/<nom>/<date>/, gardée 7 jours.
# Les fichiers inchangés sont des liens vers la copie de la veille : 7 jours ne coûtent guère plus qu'une copie.
# Revenir en arrière : arrêter l'instance, recopier <date>/ sur <nom>/state/, relancer.
set -eu
BASE=/home/claude/apps/board-wizzard
DEST=/home/claude/backups/board-wizzard
JOUR="$(date +%F)"

for ENV in "$BASE"/*/.env; do
    [ -f "$ENV" ] || continue
    DIR="$(dirname "$ENV")"; NOM="$(basename "$DIR")"
    mkdir -p "$DEST/$NOM"
    VEILLE="$(ls -1d "$DEST/$NOM"/20* 2>/dev/null | grep -v "/$JOUR\$" | tail -1 || true)"
    rsync -a --delete \
        --exclude=/tmp/ --exclude=/app/ --exclude=/tools/ \
        --exclude=/data/tmp/ --exclude=/data/qa/ --exclude=/data/trash/ \
        ${VEILLE:+--link-dest="$VEILLE"} \
        "$DIR/state/" "$DEST/$NOM/$JOUR/"
    ls -1d "$DEST/$NOM"/20* | head -n -7 | xargs -r rm -rf
    echo "$(date '+%F %T') $NOM : $(du -sh "$DEST/$NOM/$JOUR" | cut -f1)"
done
