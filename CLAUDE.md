# Board Wizzard : consignes pour Claude Code

Application locale de David (grosdada) pour fabriquer des **storyboards par décalcomanie** : des cases, et une banque
de personnages, décors et assets en **orbite 360° détourée** qu'on glisse dans les cases et qu'on fait tourner à la
souris. Sœur d'Alive-Comics (même découpage, mêmes bulles, même client ComfyUI). Mode d'emploi : `README.md`.

## Façon de travailler
- Tout en français (interface, messages, docs). Avancer sans bloquer sur des questions.
- Ne jamais versionner `local_settings.json` ni `data/` (banque, storyboards, journal).
- Vérifier toute modification d'interface dans le navigateur. Tester sur un storyboard d'essai (`zz-…`), pas sur ceux
  de David.
- Le serveur tourne détaché, ouvert au réseau local (David y accède depuis un autre poste) :
  `Start-Process cmd.exe '/c python -m app --no-browser --host 0.0.0.0 >> data\server.log 2>&1'` (port 8795).
  Les fichiers de `app/web` sont servis sans cache ; une modification Python demande un redémarrage, à ne faire que
  quand `python tools/status.py` montre une file vide (sinon les calculs fal en cours sont relancés et payés deux fois). Les tâches en file survivent à un redémarrage ; celles en cours sont relancées. Avant de redémarrer,
  retirer des machines les tâches dont le préfixe de sortie commence par `bw/`, sinon elles sont calculées deux fois.
- `python tools/status.py` (file et banque), `python tools/qa.py --new` (planches de contrôle dans `data/qa/`),
  `python tools/seed_bank.py manifeste.json` (remplissage en lot), `python tools/bump.py "nom"` (passer devant).
- `python tools/trous.py` (trous et vides du détourage : contrôle, `--reparer`, `--vides`), `python tools/doublons.py`
  (orbites dont chaque image est en double), `python tools/pack.py` (paquets `.bwpack` et bibliothèque en ligne),
  `python tools/parts.py` (éléments de visage du portrait-robot), `python tools/corps.py traces` (banque du générateur de
  corps en tracés pleins éditables : 21 gabarits × corps entier, torse, bras, mains, jambes, chaussures, plus des
  accessoires, `app/bodyvec.py`, dans `data/parts/_corps-el/` ; ne réécrit pas ce qui existe sauf `traces [ids] --refaire`).
  Les anciens corps encrés et leurs découpes (`app/bodycut.py`) ne sont plus proposés (`partbanks.ANCIENS_CORPS`). Les outils qui réécrivent la banque gardent les
  originaux dans `data/backup/`.

## Repères techniques
- Serveur Python (bibliothèque standard + pillow, numpy), ffmpeg dans le PATH. Interface sans compilation (`app/web`).
- **Orbite** : MiniMax H3 + LoRA 360 Orbit par le nœud `H3OrbitalConditioning`, 73 images à 24 i/s (3 s), boucle
  (1re image = dernière, retirée : 72 images gardées). BiRefNet (`RemoveBackground`) sur la sortie du décodeur donne
  une vidéo de masque ; `app/sprites.py` assemble couleur + masque en WebP transparents, tous rognés sur la même boîte.
  Mesuré : tour complet, vitesse régulière, ≈ 2 à 3 min par orbite sur une 5090.
- **Axes** : l'orbite passe par face → 3/4 face gauche → profil gauche → dos → profil droit (gauche / droite = côté
  de l'écran vers lequel le sujet regarde). `sprites.AXES` et `model.js` `AXES` doivent rester dans le même ordre.
  Les repères par défaut sont réguliers ; la fiche permet de les corriger.
- **Planche de vues** : avant l'orbite d'un personnage, `jobs.ensure_sheet` génère dos, profil et trois-quarts dos
  (Qwen-Image-Edit, `poses.SHEET_VIEWS`) dans `sheet/` ; elles partent en `character_1..4` du nœud H3 avec l'image de
  base. Sans elles un dessin tourne « à plat ». Réglage `render.sheet`.
- **Poses** : `app/poses.py`. Une pose = Qwen-Image-Edit sur l'image de base, puis détourage et orbite propres.
- **Moteur des poses** (`render.pose_engine`, Réglages › Calcul) : vide = Qwen comme le reste ; `fal:fal-ai/nano-banana-pro/edit` =
  poses et planche de vues par Nano Banana Pro (`jobs._pose_prov`, prompt `poses.FAITHFUL`), détourage et orbite sur les
  machines. Qwen redessine les dessins en couleur (lavis) ; Nano Banana Pro garde trait et remplissage. Une pose peut avoir
  ses propres vues (`variants[v].sheet`, fichiers `v/<pose>/sheet/`) : l'orbite les prend à la place de celles de la base,
  qui déteignent quand l'attitude diffère (bras en trop). Sans planche du tout, les profils sortent plats.
- **Fond de couleur** (`item.key`, `item.apose`, fiche › « Pose en A ») : première étape d'un personnage. `item_apose` tire sa
  pose en A et sa base sur un fond uni (vert, ou magenta s'il porte du vert) ; David valide. Ensuite poses (`jobs._pose_key` :
  dessin d'origine + pose en A en références, fidélité toujours mesurée contre le dessin d'origine), vues propres à chaque
  pose (`item_views`, à valider ou écarter une à une) et orbites gardent ce fond ; `sprites.key_rgba` découpe par la
  couleur, sans BiRefNet ni rebouchage (`variants[v].keyimg`, `orbit.key`). Les vides (bras sur les hanches) restent ouverts.
  Optionnel par élément, demande le moteur Nano Banana Pro ; sans lui ou sans pose en A validée, tout passe par l'ancien
  chemin. Sur un dessin au trait, « change seulement le fond » verdit aussi le corps : la consigne dit que l'intérieur du
  contour reste blanc.
- **Bouches dessinées** (`tools/levres.py`, payant) : sur une orbite dont la bouche est suivie (`mouth.json`), Nano Banana Pro
  redessine la tête de quelques images-clés avec la bouche en A, O, É, entrouverte ; on garde la différence autour de la
  bouche (`<orbite>/lips/`, `lips.json`, `orbit.lips`). `lipsync.cardMarkup` recale la carte de l'image-clé la plus proche
  (4 images d'écart au plus) sur la bouche suivie ; plus loin, la bouche tracée prend le relais. `tools/couleurs.py` mesure
  et recale les couleurs d'une pose sur la base (écart ≤ 3 exigé à l'audit).
- **Dessins** (`style: "dessin"`) : le détourage troue le blanc intérieur ; `sprites.fill_holes` rebouche ce que la
  silhouette enferme.
- **Tâches** (`app/jobs.py`) : une procédure par type (`RUNNERS`), un fournisseur local (ComfyUI) ou fal avec les
  quatre mêmes gestes (t2i, edit, matte, orbit). Priorité 0 = case (Integrate, orbite de case), 1 = banque à la main,
  2 = lot. Un rendu d'orbite écrit toujours dans un dossier neuf (`v/<variante>/o<instant>_<essai>`).
- **Machines** : celles de `local_settings.json` + les `comfy_nodes` des réglages de Workflows Q-builder
  (`qbuilder_settings`). On envoie directement à l'API de chaque ComfyUI ; l'API par lots de Q-builder ne prend que
  des scènes H3 Director.
- **fal** (`app/falapi.py`) : clé, t2i, envoi de fichier (`storage_type=fal-cdn-v3`) et détourage d'image essayés le
  17/11/2026, ainsi que l'orbite H3 + LoRA et son masque vidéo (480P, 5 s, 198 s). **Pas encore essayée** : l'édition.
- Calques d'une case : `{id, item, v (variante), f (image de l'orbite), x, y (pieds, fraction de la case), s (hauteur),
  flip, d (profondeur)}`. Fond : `panel.bg` (élément de banque ou image importée) + `panel.view`.

- **Storyboards** : chaque enregistrement garde la version précédente dans `projects/<id>/history/` (une toutes les
  2 minutes au plus). Un onglet qui enregistre un état plus ancien que celui d'un autre onglet est refusé (409) :
  avant cela, un vieil onglet resté ouvert a écrasé une case entière.
- **Retouches d'orbite** (`app/retouch.py`) : lasso vider / remplir, vider une zone, zones suspectes, dédoublonnage.
  Le rebouchage (`sprites.fill_holes`) rend opaque tout l'intérieur d'un dessin et ne referme plus les angles serrés.
- **Objets tout faits** (`app/procedural.py`) : boîtes et cylindres rendus au trait, orbite de 72 images sans calcul.
- **Comptes** (`app/accounts.py`) : l'admin est celui qui connaît `server.password` (nom vide à la connexion) ; il crée des
  invités dans Réglages > Mon compte (`accounts` de `local_settings.json`, mots de passe hachés). Un invité ne peut ni
  changer les réglages ni gérer les comptes ; seul un invité VIP a la bibliothèque en ligne. Sans mot de passe
  d'application, tout le monde est admin. Tester sur une copie de `app/` hors du dépôt (les réglages sont à la racine).
- **Paquets** (`app/packs.py`) : un élément entier dans un `.bwpack` ; bibliothèque en ligne = un dossier de paquets
  servi en HTTPS avec identifiant et mot de passe.
- **Pont In-House-Dubbing** (`tools/doublage.py`, sans rien changer au serveur) : lit le dossier que l'appli de voix
  maquettes de David remplit par « Transfert audio » (`_projet.js` + `SEQxx_slug/SEQxx_Lyy_PERSO.wav`). `monter` crée le
  storyboard (pages par séquence, un plan par case, personnages de la banque, un deck par séquence, pas de bulles sauf `--bulles`) ; `voix` pose
  les prises arrivées sur le calque de celui qui parle (`lip.ihd`, bouches écoutées en numpy comme `lipsync.js`
  `analyse`) et se relance sans rien écraser. Distribution et décors : `data/doublage/<projet>.json`, à la main.
  Le scénario est confidentiel : jamais dans le dépôt.

## Licences
MiniMax H3 exclut l'UE, le Royaume-Uni, les USA et la Corée (affichage compris) : à David de trancher avant de
distribuer. Détourage : BiRefNet seulement (MIT) ; pas de SAM ni de Depth Pro ici.
