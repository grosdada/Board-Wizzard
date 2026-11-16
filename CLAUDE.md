# Board Wizzard : consignes pour Claude Code

Application locale de David (grosdada) pour fabriquer des **storyboards par décalcomanie** : des cases, et une banque
de personnages, décors et assets en **orbite 360° détourée** qu'on glisse dans les cases et qu'on fait tourner à la
souris. Sœur d'Alive-Comics (même découpage, mêmes bulles, même client ComfyUI). Mode d'emploi : `README.md`.

## Façon de travailler
- Tout en français (interface, messages, docs). Avancer sans bloquer sur des questions.
- Ne jamais versionner `local_settings.json` ni `data/` (banque, storyboards, journal).
- Vérifier toute modification d'interface dans le navigateur. Tester sur un storyboard d'essai (`zz-…`), pas sur ceux
  de David.
- Le serveur tourne détaché : `Start-Process cmd.exe '/c python -m app --no-browser >> data\server.log 2>&1'`
  (port 8795). Les tâches en file survivent à un redémarrage ; celles en cours sont relancées. Avant de redémarrer,
  retirer des machines les tâches dont le préfixe de sortie commence par `bw/`, sinon elles sont calculées deux fois.
- `python tools/status.py` (file et banque), `python tools/qa.py --new` (planches de contrôle dans `data/qa/`),
  `python tools/seed_bank.py manifeste.json` (remplissage en lot), `python tools/bump.py "nom"` (passer devant).

## Repères techniques
- Serveur Python (bibliothèque standard + pillow, numpy), ffmpeg dans le PATH. Interface sans compilation (`app/web`).
- **Orbite** : MiniMax H3 + LoRA 360 Orbit par le nœud `H3OrbitalConditioning`, 73 images à 24 i/s (3 s), boucle
  (1re image = dernière, retirée : 72 images gardées). BiRefNet (`RemoveBackground`) sur la sortie du décodeur donne
  une vidéo de masque ; `app/sprites.py` assemble couleur + masque en WebP transparents, tous rognés sur la même boîte.
  Mesuré : tour complet, vitesse régulière, ≈ 2 à 3 min par orbite sur une 5090.
- **Axes** : l'orbite passe par face → 3/4 face gauche → profil gauche → dos → profil droit (gauche / droite = côté
  de l'écran vers lequel le sujet regarde). `sprites.AXES` et `model.js` `AXES` doivent rester dans le même ordre.
  Les repères par défaut sont réguliers ; la fiche permet de les corriger.
- **Poses** : `app/poses.py`. Une pose = Qwen-Image-Edit sur l'image de base, puis détourage et orbite propres.
- **Dessins** (`style: "dessin"`) : le détourage troue le blanc intérieur ; `sprites.fill_holes` rebouche ce que la
  silhouette enferme.
- **Tâches** (`app/jobs.py`) : une procédure par type (`RUNNERS`), un fournisseur local (ComfyUI) ou fal avec les
  quatre mêmes gestes (t2i, edit, matte, orbit). Priorité 0 = case (Integrate, orbite de case), 1 = banque à la main,
  2 = lot. Un rendu d'orbite écrit toujours dans un dossier neuf (`v/<variante>/o<instant>_<essai>`).
- **Machines** : celles de `local_settings.json` + les `comfy_nodes` des réglages de Workflows Q-builder
  (`qbuilder_settings`). On envoie directement à l'API de chaque ComfyUI ; l'API par lots de Q-builder ne prend que
  des scènes H3 Director.
- **fal** (`app/falapi.py`) : écrit d'après la doc publique, **jamais essayé avec une clé**. À valider : l'envoi de
  fichier (`storage/upload/initiate`) et la vidéo de masque de BiRefNet v2 vidéo.
- Calques d'une case : `{id, item, v (variante), f (image de l'orbite), x, y (pieds, fraction de la case), s (hauteur),
  flip, d (profondeur)}`. Fond : `panel.bg` (élément de banque ou image importée) + `panel.view`.

## Licences
MiniMax H3 exclut l'UE, le Royaume-Uni, les USA et la Corée (affichage compris) : à David de trancher avant de
distribuer. Détourage : BiRefNet seulement (MIT) ; pas de SAM ni de Depth Pro ici.
