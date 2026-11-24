"""Catalogue des variantes a generer pour qu'un element de banque soit « pret a servir ».

Personnage : une pose = une image (Qwen-Image-Edit a partir de l'image de base) puis sa propre orbite detouree ;
les axes (face, 3/4, profil, dos...) sont des reperes sur cette orbite. Decor : des ambiances. Trois paliers :
  essentiel (le minimum pour raconter), complet (une scene dialoguee), tout (toutes les situations).
"""

# (cle, nom affiche, palier, description anglaise de la pose pour le modele)
CHARACTER = [
    ("parle", "Parle", 1, "talking, mouth open mid-sentence, one hand raised at chest height in an explaining gesture"),
    ("ecoute", "Écoute", 1, "listening attentively, head slightly tilted, arms relaxed, mouth closed"),
    ("pointe", "Pointe du doigt", 1, "pointing straight ahead with one outstretched arm and index finger"),
    ("bras-croises", "Bras croisés", 1, "standing with both arms crossed on the chest, sceptical look"),
    ("pensif", "Pensif, menton dans la main", 1, "thinking, one hand holding the chin, the other arm supporting the elbow"),
    ("tete-mains", "Tête entre les mains", 1, "holding the head with both hands in despair, elbows out, eyes shut"),
    ("marche", "Marche", 1, "walking, mid-stride, one leg forward, arms swinging naturally"),
    ("surpris", "Surpris", 2, "startled, eyes wide, mouth open, both hands raised open at shoulder height"),
    ("colere", "En colère", 2, "angry, shouting, one fist raised, body leaning forward"),
    ("rit", "Rit", 2, "laughing out loud, head thrown slightly back, one hand on the belly"),
    ("triste", "Abattu", 2, "sad, shoulders dropped, head bowed, arms hanging"),
    ("explique", "Explique à deux mains", 2, "explaining with both hands open in front of the chest, palms up"),
    ("mains-hanches", "Mains sur les hanches", 2, "standing with both hands on the hips, confident"),
    ("telephone", "Au téléphone", 2, "holding a phone to one ear, talking"),
    ("assis", "Assis", 2, "sitting on a plain simple stool, hands resting on the knees, feet on the ground"),
    ("court", "Court", 2, "running fast, mid-stride, arms pumping, body leaning forward"),
    ("tend-main", "Tend la main", 3, "reaching one hand forward, palm open, offering or asking for something"),
    ("salue", "Salue", 3, "waving hello with one raised hand, smiling"),
    ("peur", "Recule de peur", 3, "recoiling in fear, leaning back, both hands raised in front of the face"),
    ("victoire", "Bras levés", 3, "both arms raised high in victory, joyful face"),
    ("accroupi", "Accroupi", 3, "crouching low, knees bent, one hand touching the ground"),
    ("regarde-haut", "Regarde en l'air", 3, "looking up at the sky, head tilted back, one hand shading the eyes"),
    ("porte", "Porte quelque chose", 3, "carrying a large plain cardboard box with both arms in front of the body; the box is light brown, clearly drawn with the same line as the character, and never the colour of the background"),
    ("epaules", "Hausse les épaules", 3, "shrugging, shoulders up, both palms up at the sides"),
    ("assis-tete", "Assis, tête dans la main", 3, "sitting on a plain simple stool, elbow on the knee, cheek resting in the hand, bored"),
    ("a-terre", "À terre", 3, "sitting on the ground after a fall, leaning back on both hands, legs stretched"),
    ("braque", "Braque avec un revolver", 3, "aiming a revolver, seen in three-quarter front view: the body and the head are "
     "turned about 45 degrees toward the left of the image, one arm fully extended toward the left of the image at shoulder "
     "height, the hand holding a simple revolver seen from the side (the whole gun and the barrel are visible, it does not "
     "point at the viewer), the other arm down at the side, legs slightly apart, body tense, eyes on the target"),
]

DECOR = [
    ("nuit", "Nuit", 1, "the same place at night, dark sky, a few artificial lights on"),
    ("crepuscule", "Crépuscule", 2, "the same place at dusk, warm low sun, long shadows"),
    ("pluie", "Pluie", 2, "the same place under heavy rain, wet ground, overcast sky"),
    ("brouillard", "Brouillard", 3, "the same place in thick fog, low visibility"),
    ("vide", "Vidé de ses personnages", 3, "the same place with every person removed, empty"),
]

# Expressions du visage (tools/expressions.py) : sur quelques images-cles de face de l'orbite, la tete est redessinee avec
# l'expression, bouche fermee ; on garde la difference autour du visage en cartes transparentes (<orbite>/expr/).
# (cle, nom affiche, palier, consigne anglaise : sourcils, yeux, bouche fermee, joues)
EXPRESSIONS = [
    ("joie", "Joie", 1, "happy: a warm closed-mouth smile, the corners of the lips raised, the cheeks pushed up, the eyes a "
     "little narrowed by the smile, the eyebrows relaxed and slightly raised"),
    ("colere", "Colère", 1, "angry: the eyebrows pulled down and together in a deep frown, the eyes glaring, the lips pressed "
     "tight together, the corners of the mouth turned down"),
    ("tristesse", "Tristesse", 1, "sad: the inner ends of the eyebrows raised, the upper eyelids drooping, the gaze lowered, "
     "the closed mouth with its corners turned down"),
    ("surprise", "Surprise", 1, "surprised: the eyebrows raised high, the eyes wide open showing white around the irises, "
     "the lips closed but slightly pursed"),
    ("peur", "Peur", 2, "frightened: the eyebrows raised and drawn together, the eyes wide open and staring, the lips closed "
     "and stretched tight sideways"),
    ("degout", "Dégoût", 2, "disgusted: the nose wrinkled, the upper lip raised on one side while the mouth stays closed, the "
     "eyebrows lowered, the eyes narrowed"),
    ("mefiance", "Méfiance", 2, "suspicious: one eyebrow lowered and the other raised, the eyes narrowed and looking sideways, "
     "the lips pressed together"),
    ("inquiet", "Inquiétude", 2, "worried: the eyebrows raised in the middle and knitted, the forehead creased, the lips pressed "
     "together, a tense look"),
    ("amuse", "Amusement", 2, "amused: a lopsided closed-mouth smirk raising one corner of the mouth, one eyebrow slightly "
     "raised, the eyes bright and a little narrowed"),
    ("determine", "Détermination", 2, "determined: the eyebrows lowered and straight, the eyes focused straight ahead, the jaw "
     "set, the lips closed in a firm straight line"),
    ("ennui", "Ennui", 3, "bored: the upper eyelids half closed, the eyebrows flat, the gaze dull, the closed mouth slack and "
     "flat"),
    ("gene", "Gêne", 3, "embarrassed: an awkward closed-mouth smile, the eyebrows raised in the middle, the eyes looking away "
     "to the side"),
    ("fierte", "Fierté", 3, "smug and proud: the chin slightly up, the eyelids a little lowered, a satisfied closed-mouth "
     "smile"),
    ("pensif", "Pensif", 3, "thoughtful: the eyes looking up and to the side, one eyebrow slightly raised, the lips closed and "
     "pushed a little to one side"),
    ("endormi", "Somnolent", 3, "sleepy: the eyelids almost closed, the eyebrows relaxed, the closed mouth relaxed"),
    ("clin-oeil", "Clin d'œil", 3, "winking: one eye closed in a wink, the other eye open, a small closed-mouth smile"),
    ("effare", "Effarement", 3, "aghast: the eyebrows shot up very high, the eyes huge and round, the lips pressed tight"),
    ("hautain", "Dédain", 3, "haughty disdain: the eyelids half lowered, the eyebrows raised, the lips pressed and pushed "
     "forward, looking down the nose"),
]

TIERS = {1: "Essentiel", 2: "Complet", 3: "Tout"}
STYLE_WORDS = {
    "photo": "photorealistic rendering",
    "dessin": "hand-drawn line art, the same pen lines and shading",
    "3d": "3D render look",
}


def catalogue():
    def rows(items):
        return [{"key": k, "label": l, "tier": t} for k, l, t, _ in items]
    return {"character": rows(CHARACTER), "decor": rows(DECOR), "asset": [], "tiers": TIERS, "expressions": rows(EXPRESSIONS)}


def expression(key):
    """(nom affiche, consigne anglaise) d'une expression, ou None."""
    for k, label, _, desc in EXPRESSIONS:
        if k == key:
            return label, desc
    return None


def find(kind, key):
    for k, label, tier, desc in (CHARACTER if kind == "character" else DECOR if kind == "decor" else []):
        if k == key:
            return label, desc
    return None


# Dessins : on ne demande que le geste du corps. Les visages des dessins (yeux inegaux, tetes tordues) sont le design :
# toute consigne d'expression pousse le modele a les redessiner « proprement ».
BODY_ONLY = {
    "parle": "one hand is raised at chest height, palm open, in an explaining gesture",
    "ecoute": "both arms hang relaxed along the body and the torso leans very slightly forward",
    "pointe": "one arm is stretched out straight ahead, pointing with the index finger",
    "bras-croises": "both arms are crossed on the chest",
    "pensif": "one hand touches the chin and the other arm supports its elbow",
    "tete-mains": "both hands are placed on the sides of the head, elbows out",
    "marche": "the legs are walking mid-stride, one leg forward, the arms swinging",
    "surpris": "both hands are raised open at shoulder height",
    "colere": "one fist is raised and the body leans forward",
    "rit": "one hand rests on the belly and the torso leans slightly back",
    "triste": "the shoulders are dropped and both arms hang limp",
    "explique": "both hands are open in front of the chest, palms up",
    "mains-hanches": "both hands are on the hips",
    "telephone": "one hand holds a phone against the ear",
    "assis": "the character sits on a plain simple stool, hands resting on the knees, feet on the ground",
    "court": "the legs are running fast mid-stride, the arms pumping, the body leaning forward",
    "tend-main": "one hand reaches forward, palm open",
    "salue": "one hand is raised high, waving",
    "peur": "the body leans back and both hands are raised in front of the chest, palms out",
    "victoire": "both arms are raised high above the head",
    "accroupi": "the character crouches low, knees bent, one hand touching the ground",
    "regarde-haut": "one hand is raised flat above the eyebrows like a visor",
    "porte": "both arms carry a large plain cardboard box in front of the body; the box is light brown, clearly drawn with "
             "the same line as the character, and never the colour of the background",
    "epaules": "the shoulders are shrugged, both palms up at the sides",
    "assis-tete": "the character sits on a plain simple stool, one elbow on the knee",
    "a-terre": "the character sits on the ground, leaning back on both hands, legs stretched out",
    "braque": "the body is turned three-quarter toward the left of the image, one arm is stretched toward the left at shoulder "
              "height and its hand holds a simple revolver seen from the side, the other arm hangs at the side",
}


def pose_prompt_drawing(key, custom=""):
    """Pose d'un personnage dessine : le corps bouge, la tete ne doit pas etre redessinee."""
    hit = find("character", key)
    label = hit[0] if hit else (custom[:40] or key)
    move = BODY_ONLY.get(key) or custom or (hit[1] if hit else key)
    return label, ("This is a rough hand-drawn black pencil sketch of a strange caricature character on white paper. Only change "
                   "the body pose: %s. Do not redraw anything else. Copy the head from the original drawing without any change: "
                   "exactly the same head shape, the same face as drawn, nothing added and nothing removed on the head, the head "
                   "facing the same direction. Same body proportions and same clothes. Keep the same rough shaky sketch lines, "
                   "pure black lines on white, no colour, no grey shading, no cleanup, no beautification. Same framing, "
                   "full body." % move)


# Moteur fidele (render.pose_engine, Nano Banana Pro) : on demande « un autre dessin du meme auteur », sans rien dire du
# personnage ni de la technique. Essaye le 20/11/2026 sur un dessin au crayon et au lavis : meme visage, meme trait,
# meme remplissage, la ou Qwen-Image-Edit redessinait tout.
FAITHFUL = ("It must look like another image of the same character made by the same artist, with the same tools, on the same "
            "day. Keep the character strictly identical: same head shape, same face, same hair, same clothes, same body "
            "proportions. Keep the technique strictly identical to the reference image: the same kind of outlines with the same "
            "thickness and roughness, the same way of filling the shapes, the same texture, the same colours, the same level of "
            "detail. Same plain background. Full body from head to feet, the character the same size in the frame. Do not "
            "clean up, do not beautify, do not add detail, no new colours.")


def pose_prompt_faithful(key, custom=""):
    hit = find("character", key)
    label, desc = hit if hit else (custom[:40] or key, custom or key)
    return label, "Redraw this exact character in a new pose: %s. %s" % (desc, FAITHFUL)


# ---- personnage sur fond de couleur (item["key"]) : la pose en A validee sert de fiche, et tout ce qui suit (poses, vues,
# orbites) garde ce fond uni, decoupe ensuite par la couleur (sprites.key_rgba). Essaye le 21/11/2026 : H3 garde le fond
# sur tout le tour, les vides (bras sur les hanches) restent ouverts, plus de rebouchage ni de halo.
KEY_WORDS = {"vert": "pure chroma green (#00FF00)", "magenta": "pure magenta (#FF00FF)"}
_FAITHFUL_NOBG = FAITHFUL.replace("Same plain background. ", "")
# caricatures : le modele « corrige » volontiers vers un corps normal (tete plus petite, corps plus elance). David, 21/11/2026 :
# « c'est des caricatures, faut vraiment garder les proportions ».
PROPORTIONS = ("This is a caricature: its odd proportions are the design. Keep exactly the same head-to-body ratio as in the "
               "original drawing: the head is just as big compared with the body, the neck just as short or long, the limbs just "
               "as thin or thick, the torso just as wide. Do not normalise the anatomy, do not make the figure slimmer or taller.")
NO_CLOTHES = ("The character wears exactly what it wears in the reference and nothing more: add no garment, no underwear, no "
              "shorts, no accessory.")


def _key_bg(key, keep=False):
    c = KEY_WORDS.get(key, KEY_WORDS["vert"])
    return ("BACKGROUND: %s one flat, uniform, %s background everywhere, including in every gap between the limbs and the body. "
            "No ground, no shadow on the ground, no gradient, no texture, no coloured reflection on the character. The "
            "character's own white areas stay white." % ("keep exactly the same" if keep else "replace the background by", c))


def apose_prompt(key="vert"):
    return ("Redraw this exact character standing in a neutral A-pose, seen as in the reference: body upright and straight, both "
            "arms straight and held away from the body at about 40 degrees, hands open with fingers apart, legs straight and "
            "slightly apart, feet flat, same expression. No limb touches or overlaps the body or another limb: clear empty gaps "
            "between each arm and the torso and between the legs. %s %s %s" % (_FAITHFUL_NOBG + " " + PROPORTIONS, NO_CLOTHES, _key_bg(key)))


def base_key_prompt(key="vert"):
    return ("Keep this image exactly as it is: the same character, the same pose, every line and every filled area unchanged, "
            "the same size and the same position in the frame. Do not redraw, do not clean up. Change only the background, "
            "which is only what lies OUTSIDE the outer contour of the character. The character is an opaque figure: everything "
            "inside its outline (the whole body, the head, the limbs, the clothes, even where the drawing leaves bare white "
            "paper) keeps exactly its current colour and stays white where it is white. %s" % _key_bg(key))


def keep_words(keep):
    """Particularites du personnage a garder sur toutes les poses (champ libre de la fiche, item["keep"])."""
    k = (keep or "").strip().rstrip(".")
    return (" The character always keeps: %s." % k) if k else ""


def pose_prompt_key(pose, custom="", key="vert", keep=""):
    """Pose d'un personnage sur fond de couleur. Deux references : le dessin d'origine (visage, trait, remplissage) et ce
    meme dessin repose sur le fond de couleur (apose/base.png). Pas la pose en A : mesure le 21/11/2026 sur deux
    caricatures, elle les amaigrit (epaules deux fois moins larges, bras 40 % plus fins) et les poses en heritaient."""
    hit = find("character", pose)
    label, desc = hit if hit else (custom[:40] or pose, custom or pose)
    return label, ("The first image is the original drawing of the character: it is the reference for the face, the expression, "
                   "the proportions, the line and the filling. The second image shows the same character exactly as drawn, on a "
                   "flat coloured background. Redraw this exact character in a new pose: %s. %s %s %s The background of the "
                   "result is the flat coloured background of the SECOND image, never the white paper of the first image."
                   % (desc, _FAITHFUL_NOBG + " " + PROPORTIONS, NO_CLOTHES, _key_bg(key, keep=True))) + keep_words(keep)


def sheet_prompt_key(view, key="vert", keep=""):
    return ("%s Exactly the same pose: the arms, the hands, the legs and whatever the character holds stay exactly where they "
            "are in the reference, nothing else moves. The head and the body keep real volume and thickness seen from this "
            "angle. %s %s %s" % (dict(SHEET_VIEWS)[view], NO_CLOTHES, _FAITHFUL_NOBG + " " + PROPORTIONS, _key_bg(key, keep=True))
            + keep_words(keep))


def pose_prompt(kind, key, style="photo", custom=""):
    """(nom affiche, prompt d'edition)."""
    hit = find(kind, key)
    label, desc = hit if hit else (custom[:40] or key, custom or key)
    look = STYLE_WORDS.get(style, STYLE_WORDS["photo"])
    if kind == "decor":
        return label, ("Show %s. Keep exactly the same location, the same architecture and objects, the same camera "
                       "position and framing, the same %s." % (desc, look))
    return label, ("Change the pose of the character: %s. Keep exactly the same character, same face, same hair, "
                   "same clothes and colours, same %s. Full body visible from head to feet, same camera angle and "
                   "distance, same background." % (desc, look))


# ---- planche de vues d'un personnage : faite avant l'orbite, elle montre au modele le dos et le profil qu'il devrait
# sinon inventer (sans elle, un dessin tourne souvent « plat », comme une planche de carton)
SHEET_VIEWS = [
    ("dos", "Turn the character around: show the same character seen exactly from behind, back view, we see the back of "
            "the head and the back of the clothes."),
    ("profil", "Rotate the character 90 degrees: show the same character in strict side view, profile, facing the left of "
               "the image."),
    ("trois-quarts-dos", "Rotate the character: show the same character in three-quarter back view, seen from behind and "
                         "slightly from the side."),
]
SHEET_STYLE = {
    "dessin": ("Same character, same odd proportions, same clothes, same rough hand-drawn black pencil sketch lines on white "
               "paper, pure black lines on white, no colour, no grey shading. Full body, same size, standing in the same pose."),
    "photo": ("Same person, same body, same clothes and colours, same lighting, photorealistic. Full body, same size, standing "
              "in the same pose, same plain background."),
    "3d": ("Same character, same proportions, same clothes and colours, same 3D render look. Full body, same size, standing in "
           "the same pose, same plain background."),
}


def sheet_prompt(view, style="photo", faithful=False):
    desc = dict(SHEET_VIEWS)[view]
    if faithful:                                     # le volume est dit en clair : c'est ce que l'orbite vient chercher ici
        return ("%s Standing in the same pose. The head and the body keep real volume and thickness seen from this angle. %s"
                % (desc, FAITHFUL))
    return desc + " " + SHEET_STYLE.get(style, SHEET_STYLE["photo"])


def orbit_subject(kind, name):
    return {"character": "The camera orbits around the character.",
            "decor": "The camera orbits around the centre of the place.",
            "asset": "The camera orbits around the object."}.get(kind, "")


INTEGRATE = {
    # encrage : la case dessinee est mise au propre, sans rien redessiner (consigne de David, adaptee au noir et blanc)
    "encre": ("Ink this rough black-and-white storyboard panel into one clean, finished ink drawing, with zero redesign. "
              "Lock the outer silhouette and all internal shapes of every character and object: do not alter any line, "
              "angle or proportion. HEADS MUST MATCH EXACTLY: keep the same skull volume, nose length, hairline, ear "
              "shape, mouth, eye position, wrinkles and asymmetries. Do not fix anatomy, do not beautify. Keep identical "
              "composition, scale, perspective, pose, spacing and framing; every character and object stays exactly "
              "where it is. Only clean up the rendering on top of the original linework: confident black ink lines, tidy "
              "contours, solid blacks where the drawing is already black, and a restrained, more realistic sense of "
              "volume and material (cloth folds, skin, leather, wood, metal) suggested with sparse hatching or flat grey "
              "tone only; shading must not cross or soften the contours. Unify everything into one single coherent "
              "drawing in the same line style, with soft contact shadows under the feet and no cut-out edges. Black ink "
              "on white paper; keep any halftone or flat tone already present, add no colour. No rounding, no smoothing, "
              "no reinterpretation of volumes; preserve all distortions and caricature features as drawn. If uncertain, "
              "do not invent details: stay subtle and neutral. Structural fidelity over polish: in any conflict, keep "
              "the drawing's lines. Lock every head silhouette and all facial landmarks (brow, nose, mouth, chin, ears) "
              "to the drawing; any deviation is an error. MANDATORY: no text on the image, no captions, no labels, no "
              "watermarks, no speech balloons, no added frame."),
    # consigne retenue apres essais : « contact shadows » seul donnait des ombres noires decoupees
    "photo": ("Make this collage look like one single real photograph taken in this place. Keep every person and object "
              "exactly where it is, same pose, same size, same framing, same faces, hairstyles and costumes. Relight the "
              "people so they match the light of the place, with the same colour temperature, contrast and film grain "
              "as the background. Add only soft, faint, realistic contact shadows on the ground under their feet. "
              "Blend the cut-out edges."),
    "dessin": ("Redraw this rough collage as one coherent storyboard drawing in a single consistent line style. Keep "
               "every character and object exactly where it is, same pose, same size, same framing, same faces and "
               "costumes. Unify the line "
               "weight and the shading, add simple cast shadows."),
}
