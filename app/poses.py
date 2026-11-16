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
    ("porte", "Porte quelque chose", 3, "carrying a large invisible box with both arms in front of the body"),
    ("epaules", "Hausse les épaules", 3, "shrugging, shoulders up, both palms up at the sides"),
    ("assis-tete", "Assis, tête dans la main", 3, "sitting on a plain simple stool, elbow on the knee, cheek resting in the hand, bored"),
    ("a-terre", "À terre", 3, "sitting on the ground after a fall, leaning back on both hands, legs stretched"),
]

DECOR = [
    ("nuit", "Nuit", 1, "the same place at night, dark sky, a few artificial lights on"),
    ("crepuscule", "Crépuscule", 2, "the same place at dusk, warm low sun, long shadows"),
    ("pluie", "Pluie", 2, "the same place under heavy rain, wet ground, overcast sky"),
    ("brouillard", "Brouillard", 3, "the same place in thick fog, low visibility"),
    ("vide", "Vidé de ses personnages", 3, "the same place with every person removed, empty"),
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
    return {"character": rows(CHARACTER), "decor": rows(DECOR), "asset": [], "tiers": TIERS}


def find(kind, key):
    for k, label, tier, desc in (CHARACTER if kind == "character" else DECOR if kind == "decor" else []):
        if k == key:
            return label, desc
    return None


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


def orbit_subject(kind, name):
    return {"character": "The camera orbits around the character.",
            "decor": "The camera orbits around the centre of the place.",
            "asset": "The camera orbits around the object."}.get(kind, "")


INTEGRATE = {
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
