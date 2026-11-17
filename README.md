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
   Chaque élément est détouré, puis son orbite 360° est calculée (≈ 3 minutes par machine).
3. **Composer** : glisser un décor dans une case (il devient le fond), puis des personnages et des objets.
   - glisser sur un personnage : **le faire tourner** ; flèches ← → : image par image ;
   - poignée ✥ ou Alt + glisser : le déplacer ; coin carré ou molette : sa taille ;
   - **clic droit** : changer de **pose**, choisir un **axe** (face, 3/4, profil, dos…), miroir, ordre, dupliquer ;
   - glisser sur un décor en orbite : tourner le décor (Maj : recadrer ; molette : zoom).
4. **Poses** : dans la fiche d'un personnage (clic sur sa vignette), cocher les poses à générer. Trois paliers :
   essentiel (7 : parle, écoute, pointe du doigt, bras croisés, pensif, tête entre les mains, marche), complet (16),
   tout (26), plus une pose libre. Chaque pose est une image (Qwen-Image-Edit, même personnage) puis sa propre
   orbite : on change de pose en gardant le même axe. Les décors ont des ambiances (nuit, pluie…).
   Les axes sont des repères sur l'orbite : « Cette image est… » dans la fiche corrige un repère.
5. **Profondeur de champ** (case choisie) : mise au point et flou ; chaque calque a une profondeur (0 = premier plan,
   1 = décor), par défaut son ordre d'empilement.
6. **Bulles** : parole, pensée, cri, chuchotement, narration (clic droit dans la case, ou inspecteur).
7. **Integrate** : aplatit la case et demande une seule image cohérente. En « Photoréaliste », lumière et grain
   unifiés ; en « Dessin », toute la case devient un dessin de storyboard au trait, même composée de photos.
   Les calques restent disponibles : « Afficher : Calques / Intégrée ». Colonne de gauche, « Toute la page » :
   lancer Integrate sur toutes les cases composées d'un coup. Clic droit dans une case : « Générer un élément ici »
   (« un marteau ») ; il entre en banque et se pose dans la case.
8. **Orbite de la case** : une orbite 360° de toute la composition, que l'on fait tourner à la souris.
9. **Imprimer** : la page courante, en PDF par l'impression du navigateur.

## Rendus

- **Machines ComfyUI** (Réglages ⚙) : une par ligne, ou le fichier `local_settings.json` de Workflows Q-builder dont
  les machines (`comfy_nodes`) sont reprises. Les tâches vont directement à l'API de chaque ComfyUI, la moins chargée
  d'abord. Il faut : ComfyUI ≥ 0.33, le nœud `comfyui-h3-orbital`, MiniMax H3 + LoRA 360 Orbit, BiRefNet,
  Qwen-Image-Edit 2509 + LoRA Lightning, Z-Image Turbo.
- **fal** : clé du poste dans les réglages, ou clé personnelle gardée dans le navigateur (jamais écrite côté serveur).
  Modèles au choix (orbite, édition, image). Sur fal l'orbite H3 + LoRA dure 5 s au minimum.
  **Le code fal a été écrit d'après la documentation et n'a pas encore été essayé avec une vraie clé.**
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
