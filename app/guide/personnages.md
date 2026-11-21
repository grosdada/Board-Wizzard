# Fabriquer un personnage : méthode, contrôles, budget

Ce document est la consigne de l'intelligence de Board Wizzard (le modèle branché dans Réglages › Intelligence) quand elle
conduit ou contrôle la fabrication d'un personnage. Il résume ce qui a été appris en fabriquant le « Costard à cravate » et
le « Moustachu à lunettes » (novembre 2026). Chaque règle a été payée par un raté : ne pas les assouplir.

## 1. Ce qu'on fabrique

Un personnage de banque = le dessin d'origine de l'auteur, puis des **poses** (26 au catalogue), chacune avec sa **tournette**
(orbite 360° de 72 images détourées) et, pour le lip sync, des **bouches dessinées** (A, O, É, entrouverte) posées sur la tête.
C'est pour des animatiques : il faut que ce soit agréable à regarder, pas exact au micron.

## 2. Ce que l'auteur exige, dans l'ordre

1. **Ressemblance** : même tête, même visage, mêmes proportions que le dessin d'origine. Les « défauts » du dessin (tête
   carrée, jambes trop fines, nez énorme, moue) sont voulus : ne jamais les corriger, embellir ni normaliser.
   **Les proportions font partie de la ressemblance** : ce sont des caricatures. Le modèle « normalise » volontiers (tête
   plus petite, corps plus élancé, membres moins maigres ou moins épais). Comparer à chaque image la part de la tête dans
   la hauteur du personnage et sa largeur avec celles du dessin d'origine (`tools/proportions.py`, écart toléré : 8 %) ;
   pour une pose assise ou ramassée, comparer à l'œil la taille de la tête à celle du torse. Une image « plus filiforme »
   que le dessin est refusée, même si le visage est ressemblant.
2. **Même trait** : même outil, même épaisseur, même tremblé. Pas d'encre propre sur un crayon.
3. **Même remplissage** : un dessin au trait reste au trait (aucun gris, aucun lavis, aucune couleur) ; un dessin au lavis
   garde son lavis, sa texture et ses couleurs (écart de couleur ≤ 3 mesuré contre la base).
4. **Rien d'ajouté** : aucun vêtement, sous-vêtement, accessoire, texte, ombre au sol. Un personnage nu reste nu.
5. **Du volume de profil** : une tournette dont le profil est plat comme une feuille est refusée.

La référence de toute comparaison est **le dessin d'origine**, jamais une image déjà générée (sinon copie de copie).

## 3. La chaîne, étape par étape

Chaque étape est contrôlée avant la suivante. On ne lance jamais une tournette sur une pose ou des vues non contrôlées :
le calcul est perdu et la tournette part à la poubelle.

### Étape 1 : pose en A sur fond de couleur (validée par l'humain)
- Deux images : le personnage en pose en A (bras écartés à 40°, jambes écartées, aucun membre ne touche le corps) et le
  dessin d'origine reposé sur le même fond uni. Fond vert franc ; magenta si le personnage porte du vert.
- Pourquoi le fond de couleur : sur un dessin au trait, le blanc du corps et le blanc du papier sont le même blanc. Un
  détourage par réseau troue le corps, et le rebouchage referme les vrais vides (entre le bras et la hanche, entre les
  jambes). Sur fond de couleur, la découpe se fait par la couleur : les vides restent des vides, plus de halo.
- Contrôles : le fond est uni partout, **y compris entre les membres** ; le corps est resté blanc (raté connu : « change
  seulement le fond » verdit tout le corps d'un dessin au trait, seule la tête reste blanche) ; visage et trait fidèles.
- C'est la fiche du personnage : l'humain la valide. Rien d'autre ne part avant.

### Étape 2 : les poses
- Références : le dessin d'origine **et** la pose en A. Avec la pose en A seule, le visage dérive (un personnage qui
  fait la moue se met à sourire). Consigne : « un autre dessin du même auteur, avec les mêmes outils, le même jour ».
- Une image par pose. Même fond de couleur, une seule figure, en pied.
- Contrôles automatiques contre le dessin d'origine : fidélité du visage ≥ 0,85 ; épaisseur du trait entre 0,72 et 1,45
  fois celle de l'original (1,95 pour les poses ramassées : assis, accroupi, à terre). Une pose d'expression (rit, triste,
  colère, peur) fait baisser le score du visage sans être fausse : la regarder avant de la jeter.
- Contrôles à l'œil : vêtement ajouté (t-shirt, short, slip), pose identique à la base (le modèle n'a pas bougé), détail du
  corps perdu (les ovales de la poitrine et du ventre), membre en trop, couleur apparue.
- Résolution : tirer en 1K. En 2K le trait sort presque deux fois plus fin que l'original.

### Étape 3 : les vues de chaque pose
- Dos, profil strict, trois-quarts dos, **dans l'attitude de la pose**, sur le même fond. Les trois dans une seule image,
  côte à côte, puis redécoupées : trois fois moins cher et plus cohérent que trois images.
- Pourquoi : sans vues, le profil de la tournette est plat. Avec les vues d'une autre attitude (celles de la base), les
  bras déteignent : troisième bras, mains qui retournent le long du corps.
- Contrôles, vue par vue : ligne de ceinture ou d'élastique au dos (= slip ajouté, le défaut le plus fréquent sur un
  personnage nu) ; nombre de bras ; « profil » qui n'est qu'un trois-quarts ; crâne devenu tout noir derrière ; visage
  qui change d'expression. Une vue fautive s'**écarte** : la tournette se fait avec les autres. Ne pas retirer trois fois.

### Étape 4 : la tournette
- Tourne sur les machines locales, gratuitement, sur le fond de couleur, avec les vues validées en références. Découpe
  par la couleur.
- Contrôles sur une planche de 10 à 12 angles, dos agrandi : tour complet et régulier ; profils avec du volume ; dos sans
  ceinture ; **compter les bras au dos** ; vides ouverts (bras sur les hanches) ; pas de liseré de la couleur du fond.

### Étape 5 : les bouches
- Tracer la bouche sur l'image de face, la suivre dans la tournette ; ne garder que les angles où le suivi tient (il glisse
  sur le nez ou la moustache vers les profils).
- Dessiner les bouches **une seule fois, sur la base**, sur trois angles (face et les deux trois-quarts), quatre bouches
  par image : la tête est répétée dans une grille de quatre cases et seule la bouche change dans chaque case. Puis les
  **reporter** sur toutes les poses (recalage sur la bouche suivie : place, taille, inclinaison). Les angles trop de profil
  se laissent à la bouche tracée.
- Contrôles : même trait ; intérieur de la bouche ouverte ombré avec la matière du dessin (hachures sur un crayon, lavis
  sur une peinture), jamais un aplat noir ni un gris absent du dessin ; moustache et barbe gardées, même forme ; pas de
  halo gris sur la peau ; un É qui devient un sourire est refusé ; le « O » n'est pas un simple point noir.

## 4. Ce qui ne marche pas (ne pas réessayer)

- Qwen-Image-Edit en local pour les poses d'un dessin en couleur ou au lavis : il redessine tout le personnage.
- Le premier Nano Banana (non Pro) : il redessine le visage.
- Douze bouches dans une image : les têtes sont redessinées et décalées. Quatre par image, pas plus.
- La pose et ses trois vues dans la même image : le slip revient et le corps perd ses détails.
- Reboucher ou vider à la main des dizaines de tournettes : refaire sur fond de couleur coûte moins.
- Assouplir un seuil pour faire passer une image.
- Contourner un refus du filtre de contenu en habillant ou en modifiant le dessin : on écarte la pose et on le dit.

## 5. Modèles et prix (relevés le 21/11/2026, à revérifier)

| Usage | Modèle | Prix par image (fal) |
|---|---|---|
| Poses, vues, bouches, au meilleur prix | GPT Image 2.5 (Flare ou Sunburst), qualité moyenne, 1K | ≈ 0,02 $ |
| Même usage, autre famille | Nano Banana 2, 1K | 0,08 $ (2K et 4K : × 1,5) |
| Fidélité de référence | Nano Banana Pro | 0,15 $ (4K : double) |

Sur une même pose, les quatre sont fidèles ; GPT 2.5 garde le mieux l'épaisseur du trait et la construction du corps.
Tournettes et détourage : machines locales, gratuits.

## 6. Budget : 10 $ par personnage, pas un centime de plus

Un personnage de 26 poses, fait comme ci-dessus : 2 images de pose en A, 26 poses, 26 planches de vues, 3 planches de
bouches = **57 images**. Soit ≈ 1,10 $ en GPT 2.5, 4,60 $ en Nano Banana 2, 8,55 $ en Nano Banana Pro.

- Avant chaque dépense, annoncer le coût en dollars et le cumul du personnage. Ne jamais parler seulement en nombre
  d'images.
- Une reprise = une image de plus. Au plus deux reprises par image ; au-delà, écarter et le dire.
- À l'approche de 10 $, s'arrêter et demander.
- Une image refusée par le filtre de contenu n'est pas retentée telle quelle.

## 7. Le rôle de l'intelligence

Elle regarde chaque image produite à côté du dessin d'origine et rend un verdict court et structuré : **garder**,
**refaire** (avec le défaut nommé, pour corriger la consigne plutôt que retirer au hasard), **écarter** (une vue, une
pose). Elle ne valide jamais « sur la foi des mesures » : une image peut passer tous les contrôles automatiques et porter
un slip. Elle ne valide pas non plus par indulgence : dans le doute, elle signale et laisse l'humain trancher. La pose
en A reste validée par l'humain. Elle dit toujours ce qu'elle n'a pas pu vérifier.
