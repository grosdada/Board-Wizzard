# Board Wizzard

Fabriquer des storyboards par décalcomanie : on découpe une page en cases, on y glisse un décor puis des personnages
et des objets pris dans une **banque**, et on les règle à la souris. Chaque élément de la banque a une **orbite 360°
détourée** (3 secondes, 72 images) : glisser sur un personnage le fait tourner jusqu'au bon axe.

Application sœur d'[Alive-Comics](https://github.com/grosdada/Alive-Comics), dont elle reprend le découpage des cases,
les bulles et le client ComfyUI.

## Lancer

```
Lancer_Board_Wizzard.bat        (ou : python -m app)
```

L'interface s'ouvre sur http://127.0.0.1:8795/. Il faut Python 3.10+, `pip install -r requirements.txt` (pillow, numpy)
et ffmpeg dans le PATH.

## Mode d'emploi

1. **Cases** (colonne de gauche) : un découpage prêt, « Hasard », « Pivoter », couper ou supprimer la case choisie.
   Glisser un trait le déplace, glisser un de ses bouts l'incline (Maj : trait droit). Plusieurs pages par storyboard.
2. **Banque** (colonne de droite) : trois onglets, Personnages, Décors, Assets, et un classement par **dossiers**
   (un par projet, par exemple). « ＋ Importer » ou glisser des images dans la banque ; « ✨ Générer » fabrique un
   élément à partir d'une description (« un marteau de charpentier usé »).
   Chaque élément est détouré, puis son orbite 360° est calculée (≈ 3 minutes par machine). Pour un personnage, une
   **planche de vues** (dos, profil, trois-quarts dos) est d'abord générée à partir de son image et sert de référence
   à toutes ses orbites, poses comprises ; on la voit et on la refait dans sa fiche.
3. **Composer** : glisser un décor dans une case (il devient le fond), puis des personnages et des objets.
   - glisser sur un personnage : **le faire tourner** ; flèches ← → : image par image ;
   - poignée ✥ ou Alt + glisser : le déplacer ; coin carré ou molette : sa taille ;
   - **clic droit** : changer de **pose**, choisir un **axe** (face, 3/4, profil, dos…), miroir, ordre, dupliquer ;
   - glisser sur un décor en orbite : tourner le décor (Maj : recadrer ; molette : zoom).
   - cadrage du fond : « Zoom du fond », « Cadrage ↔ » et « Cadrage ↕ » dans l'inspecteur de la case ;
   - clic droit dans une case, « Copier cette case vers… » : cocher les numéros des cases qui reçoivent la copie.
4. **Poses** : dans la fiche d'un personnage (clic sur sa vignette), cocher les poses à générer. Trois paliers :
   essentiel (7 : parle, écoute, pointe du doigt, bras croisés, pensif, tête entre les mains, marche), complet (16),
   tout (26), plus une pose libre. Chaque pose est une image (Qwen-Image-Edit, même personnage) puis sa propre
   orbite : on change de pose en gardant le même axe. Les décors ont des ambiances (nuit, pluie…).
   Les axes sont des repères sur l'orbite : « Cette image est… » dans la fiche corrige un repère.
5. **Profondeur de champ** (case choisie) : mise au point et flou ; chaque calque a une profondeur (0 = premier plan,
   1 = décor), par défaut son ordre d'empilement.
6. **Bulles** : parole, pensée, cri, chuchotement, narration (clic droit dans la case, ou inspecteur).
7. **Dessins en tracés** : les orbites des éléments de style « Dessin » (personnages, objets, décors) sont converties en
   tracés. Dans les cases ils restent nets à tout zoom, et l'épaisseur du trait se règle : « Trait » pour un élément,
   « Trait du fond » pour le décor (0 = le trait du dessin). `python tools/vectorize.py` convertit les orbites anciennes
   (demande `opencv-python-headless`).
   Sur un dessin en tracés, « Ombre » pose un aplat gris sans calcul, forme par forme (gris, largeur, angle de lumière).
8. **Fond dessiné** (inspecteur de la case ou clic droit, « ✎ Dessiner le fond ») : un atelier pour faire un décor à la
   main en noir et blanc. Rectangle, ellipse, triangle, ligne, tracé libre, forme libre ; trait noir ou blanc ;
   remplissage blanc, noir, gris en trame ou dégradé en trame (motif points, lignes ou croisillons, taille, angle, gris
   de départ et d'arrivée, sens du dégradé).
9. **Indications** (inspecteur de la case, ou clic droit) : flèche, flèche courbe, flèche dessinée à main levée, flèche de
   rotation, cadre en pointillés. On les trace en glissant dans la case ; ensuite glisser pour déplacer, points ronds
   pour déformer, clic droit pour la couleur, les pointillés, la double pointe ou le sens. Elles ne partent pas dans
   Integrate.
10. **Integrate** : aplatit la case et demande une seule image cohérente. En « Photoréaliste », lumière et grain
   unifiés ; en « Dessin », toute la case devient un dessin de storyboard au trait, même composée de photos.
   Les calques restent disponibles : « Afficher : Calques / Intégrée ». Colonne de gauche, « Toute la page » :
   lancer Integrate sur toutes les cases composées d'un coup. Clic droit dans une case : « Générer un élément ici »
   (« un marteau ») ; il entre en banque et se pose dans la case.
11. **Orbite de la case** : une orbite 360° de toute la composition, que l'on fait tourner à la souris.
12. **Imprimer** : la page courante, en PDF par l'impression du navigateur.

## Mode montage (maquette)

Case sélectionnée → « 🎬 Mode montage » (inspecteur ou clic droit). Une visionneuse, une timeline avec une piste par
élément et une piste caméra, et des poses clés : position, taille, axe et pose d'un élément ; cadre, zoom et
inclinaison de la caméra, avec des mouvements prêts (travellings, panoramiques, zoom, bascule). Lecture en boucle,
durée réglable, plein écran. « Enregistrer et envoyer dans le deck » ajoute la case comme plan au **deck de montage**
(menu « 🎞 Decks ▾ » en haut : les decks enregistrés, et « Nouveau deck ») : les cases animées y sont mises bout à
bout, on les réordonne, on les raccourcit par les poignées de leurs deux bouts, on les retire, on lit le tout. Un
storyboard peut avoir plusieurs decks (« Enregistrer sous… », « Supprimer ce deck »). C'est une maquette : pas encore de transitions, de son dans le deck ni d'export vidéo.

Dans le montage : vue « ⬒ Profondeur » (schéma vu de dessus pour placer les éléments entre la caméra et le décor),
profondeur de champ avec ses pistes « Mise au point » et « Flou », lasso sur les clés (glisser dans une piste),
Ctrl+Z / Ctrl+Y sur 5 actions.

**Voix et bouche (lip sync, sans calcul sur les machines)** : élément choisi → « 🗣 Voix et bouche ». On importe un
fichier son ou on enregistre au micro ; le navigateur écoute la voix (volume et couleur du son, 12 fois par seconde,
`app/web/js/lipsync.js`) et appelle une des neuf bouches au trait (repos, M·B·P, A, É·I, O, OU, F·V, consonnes, L·T).
C'est une estimation à l'oreille, pas une reconnaissance des mots : on corrige une bouche en cliquant celle qu'on veut à
l'instant affiché. La bouche se place par « ◎ Repérer la bouche » (tête cherchée en haut de la silhouette de face) ou
« ✛ Placer à la main » (un clic dans l'image), puis taille et position aux curseurs. Elle est accrochée à un axe qui
tourne avec l'orbite : de trois quarts elle part sur le côté et se resserre, de dos elle disparaît.

## Rendus

- **Machines ComfyUI** (Réglages ⚙) : une par ligne, ou le fichier `local_settings.json` de Workflows Q-builder dont
  les machines (`comfy_nodes`) sont reprises. Les tâches vont directement à l'API de chaque ComfyUI, la moins chargée
  d'abord. Il faut : ComfyUI ≥ 0.33, le nœud `comfyui-h3-orbital`, MiniMax H3 + LoRA 360 Orbit, BiRefNet,
  Qwen-Image-Edit 2509 + LoRA Lightning, Z-Image Turbo.
- **fal** : clé du poste dans les réglages, ou clé personnelle gardée dans le navigateur (jamais écrite côté serveur).
  Modèles au choix (orbite, édition, image). Sur fal l'orbite H3 + LoRA dure 5 s au minimum.
  Essayé avec une vraie clé : image, envoi de fichier, détourage, orbite H3 et son masque vidéo (480P, 5 s : environ
  3 min 20 et 0,31 $ au tarif affiché). `fal.orbit_resolution` : 480P, 768P (défaut), 2K, 4K. **Pas encore essayée
  sur fal : l'édition (poses, Integrate).**
- Cible par tâche : auto (machines d'abord), machines seulement, fal seulement.

## Dossiers

- `app/` : serveur (`server.py`), file de tâches (`jobs.py`), ComfyUI (`comfy.py`), fal (`falapi.py`), découpe des
  orbites (`sprites.py`), catalogue de poses (`poses.py`), interface (`app/web/`).
- `data/` (hors dépôt ; `BW_DATA` pour le déplacer) : `bank/<élément>/` et `projects/<storyboard>/`.
- `tools/seed_bank.py` : remplir la banque à partir d'un manifeste ; `tools/status.py` : état de la file.
- `local_settings.json` (hors dépôt) : machines, clé fal, mot de passe.

## En ligne (VPS)

`python -m app --host 0.0.0.0 --no-browser`, avec un mot de passe (`server.password`). Sans machine ComfyUI, tout
passe par fal avec la clé de chaque utilisateur. Il n'y a qu'un mot de passe commun et pas de comptes : la banque et
les storyboards sont partagés entre tous ceux qui se connectent.

## Licences à connaître

MiniMax H3 : sa licence exclut l'UE, le Royaume-Uni, les USA et la Corée, affichage des vidéos compris ; à trancher
avant de distribuer. Détourage : BiRefNet (MIT). Qwen-Image-Edit et Z-Image Turbo : Apache 2.0.
