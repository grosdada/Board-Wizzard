#!/bin/sh
# Crée une instance Board Wizzard sur le VPS : ./nouvelle-instance.sh <nom> <adresse>
#   exemple : ./nouvelle-instance.sh david boardwizzard.placenta.cloud
# Le mot de passe est tiré au hasard et écrit dans state/local_settings.json (jamais affiché ici).
# Aucune clé fal ni ElevenLabs : chaque utilisateur entre la sienne dans son navigateur.
set -eu
NOM="$1"; HOTE="$2"
BASE="$(cd "$(dirname "$0")/../.." && pwd)"          # .../board-wizzard
DIR="$BASE/$NOM"
[ -e "$DIR" ] && { echo "L'instance $NOM existe déjà : $DIR"; exit 1; }

mkdir -p "$DIR/state/data" "$DIR/state/tmp" "$DIR/state/app" "$DIR/state/tools"
cp "$BASE/src/deploy/docker-compose.yml" "$DIR/docker-compose.yml"
printf 'BW_NAME=%s\nBW_HOST=%s\n' "$NOM" "$HOTE" > "$DIR/.env"

MDP="$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')"
umask 077
cat > "$DIR/state/local_settings.json" <<EOF
{
 "server": {"host": "0.0.0.0", "port": 8795, "password": "$MDP"},
 "workers": [],
 "qbuilder_settings": "",
 "render": {"target": "fal"}
}
EOF
chown -R 1000:1000 "$DIR/state"

cd "$DIR" && docker compose up -d --build
echo "Instance $NOM lancée : https://$HOTE/"
echo "Mot de passe : dans $DIR/state/local_settings.json (server.password)"
