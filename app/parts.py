"""Banque d'elements de visage pour le portrait-robot, a la maniere des coffrets de la police (un visage se monte en
superposant un contour, des cheveux, des yeux, un nez, une bouche...). Chaque element est un petit dessin au trait,
vu de face, sur fond transparent.

  data/parts/index.json                {categorie: [{id, name, file, w, h}]}
  data/parts/<categorie>/<id>.png      l'element, rogne, fond transparent (le blanc enferme par le trait reste blanc
                                       quand la categorie le demande : des cheveux cachent le crane, des verres non)
  data/parts/style.png                 (facultatif) une planche de reference : les elements sont alors dessines dans son
                                       trait, par le modele d'edition, au lieu du modele d'image seul

CATEGORIES : cle -> (nom, plein (le blanc enferme reste opaque : True, False, ou "petits" vides seulement), cadrage, [(nom, description en anglais)]).
Les descriptions restent generiques : aucun personnage ni dessinateur n'est cite.
"""
import json
import shutil
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image

from . import settings, sprites, store

ROOT = settings.DATA / "parts"
STYLE = ("Hand-drawn with a black felt-tip pen: bold, slightly irregular confident line, a few flat solid black areas, "
         "no fine hatching, no grey shading, no colour. Caricature storyboard style, a little rough.")
ALONE = ("Only this single element, centred, large, seen strictly from the front, on a pure white empty background. "
         "No face around it, no head, no other feature, no frame, no text, no caption.")

CATEGORIES = {
    "visage": ("Forme du visage", True, "the bare outline of a head and neck seen from the front, completely empty inside: "
               "no eyes, no nose, no mouth, no hair, no ears", [
        ("Ovale", "regular oval face"), ("Rond", "round chubby face"), ("Carré", "square face with a strong jaw"),
        ("Long", "very long narrow face"), ("Triangle", "wide forehead narrowing to a pointed chin"),
        ("Poire", "pear-shaped face, narrow skull, heavy jowls"), ("Anguleux", "bony angular face with prominent cheekbones"),
        ("Mâchoire large", "very wide heavy jaw, small skull"), ("Menton fuyant", "weak receding chin, soft jawline"),
        ("Double menton", "fat face with a double chin and thick neck"), ("Émacié", "gaunt hollow-cheeked face, thin neck"),
        ("Cou de taureau", "broad face on a huge bull neck"),
        ("Cœur", "heart-shaped face, wide cheekbones, small pointed chin"), ("Losange", "diamond-shaped face, narrow forehead and chin"),
        ("Rectangle", "long rectangular face with a flat chin"), ("Joufflu", "face with very full round cheeks"),
        ("Front bombé", "face with a huge bulging forehead and a small lower half"), ("Menton en galoche", "face with a long jutting chin"),
        ("Bajoues", "old sagging face with drooping jowls"), ("Tête d'œuf", "egg-shaped head, wider at the top")]),
    "cheveux": ("Cheveux", "petits", "a head of hair alone, as a wig seen from the front, with an empty opening where the face would be", [
        ("Dégarni", "balding: bare top, hair only on the sides"), ("Courts", "short neat hair"), ("Brosse", "flat-top crew cut"),
        ("Raie de côté", "side-parted combed hair"), ("Frange", "straight fringe covering the forehead"),
        ("Mi-longs", "shoulder-length untidy hair"), ("Longs raides", "long straight hair falling on both sides"),
        ("Bouclés", "thick curly hair"), ("Afro", "large round afro"), ("Chignon", "hair pulled up in a bun on top"),
        ("Queue de cheval", "hair pulled back tight in a ponytail"), ("Crête", "mohawk crest"),
        ("Hérissés", "spiky messy hair"), ("Gominés", "slicked-back greased hair, solid black"),
        ("Coupe au bol", "bowl cut"), ("Carré", "chin-length bob"), ("Tresses", "long braids on both sides"),
        ("Dreadlocks", "thick dreadlocks"), ("Couronne", "bald head with a ring of hair around the sides and a few strands on top"),
        ("Banane", "big rockabilly quiff"), ("Ondulés", "wavy medium hair")]),
    "yeux": ("Yeux", True, "a pair of eyes alone, both eyes side by side, no eyebrows, no nose, no make-up", [
        ("Petits ronds", "small round beady eyes"), ("En amande", "almond-shaped eyes"), ("Tombants", "sad drooping eyes"),
        ("Bridés", "narrow slanted eyes"), ("Globuleux", "bulging round eyes"), ("Cernés", "tired eyes with heavy bags underneath"),
        ("Mi-clos", "half-closed suspicious eyes"), ("Écarquillés", "wide-open staring eyes"), ("Rapprochés", "small eyes set very close together"),
        ("Enfoncés", "deep-set eyes in dark sockets"), ("Paupières lourdes", "eyes with heavy thick upper lids"),
        ("Dissymétriques", "one eye clearly bigger than the other"),
        ("Plissés", "eyes squinting into thin slits"), ("Ronds étonnés", "perfectly round surprised eyes with tiny pupils"),
        ("Louches", "cross-eyed look"), ("Froids", "cold pale eyes with small hard pupils"), ("Rieurs", "smiling crescent eyes"),
        ("Longs cils", "eyes with long thick eyelashes"), ("Pochés", "one swollen black eye and one normal eye"), ("Vides", "blank eyes drawn as two simple dots")]),
    "sourcils": ("Sourcils", False, "a pair of eyebrows alone (both eyebrows, no eyes)", [
        ("Fins arqués", "thin arched eyebrows"), ("Épais droits", "thick straight eyebrows"), ("Broussailleux", "bushy wild eyebrows"),
        ("Froncés", "angry frowning eyebrows slanting down to the centre"), ("Tombants", "sad eyebrows slanting down to the outside"),
        ("Relevés", "surprised raised eyebrows"), ("Mono-sourcil", "one single unbroken eyebrow"), ("Courts", "short stubby eyebrows"),
        ("Circonflexes", "eyebrows shaped like circumflex accents"), ("Clairsemés", "sparse thin dotted eyebrows"),
        ("Très épais", "enormous thick black eyebrows"), ("Fins droits", "thin straight eyebrows"), ("En pointe", "sharp angular eyebrows with a peak"),
        ("Inégaux", "one eyebrow raised high, the other low"), ("Longs retombants", "very long eyebrows hanging down at the ends"),
        ("Épilés", "very thin drawn-on eyebrows"), ("En touffes", "eyebrows made of a few rough tufts"), ("Inquiets", "worried eyebrows raised in the middle"),
        ("Écartés", "small eyebrows set far apart"), ("Bas", "heavy low eyebrows")]),
    "nez": ("Nez", False, "a nose alone, seen strictly from the front, symmetrical, both nostrils visible", [
        ("Droit", "straight regular nose"), ("Aquilin", "hooked aquiline nose"), ("Épaté", "broad flat nose"),
        ("Retroussé", "small upturned nose"), ("Bulbeux", "big bulbous round nose"), ("Cassé", "crooked broken boxer's nose"),
        ("Long pointu", "very long pointed nose"), ("Court", "tiny short button nose"), ("Narines larges", "nose with wide flaring nostrils"),
        ("Busqué", "large bony nose with a bump"),
        ("En trompette", "long nose turned up at the tip"), ("Écrasé", "flattened squashed nose"), ("Fin", "very thin delicate nose"),
        ("Gros triangulaire", "big triangular nose"), ("Patate", "shapeless lumpy potato nose"), ("Tordu", "nose bent to one side"),
        ("Narines pincées", "narrow nose with pinched nostrils"), ("Rond", "small round ball nose"), ("Long tombant", "long drooping nose hanging over the lip"),
        ("Large court", "short very wide nose")]),
    "bouche": ("Bouche", True, "a mouth alone", [
        ("Fine serrée", "thin tight-lipped mouth"), ("Lippue", "thick full lips"), ("Sourire en coin", "crooked smirk"),
        ("Tombante", "sour down-turned mouth"), ("Dents visibles", "half-open mouth showing teeth"), ("Moue", "pouting mouth"),
        ("Grande", "very wide mouth"), ("Petite", "tiny pinched mouth"), ("Lèvre pendante", "mouth with a heavy hanging lower lip"),
        ("Rictus", "nervous grimacing grin"),
        ("Sourire large", "big wide smile"), ("Dents du bonheur", "smile showing a gap between the front teeth"), ("Édentée", "open mouth with missing teeth"),
        ("En cul de poule", "puckered pursed lips"), ("Lèvre supérieure fine", "thin upper lip over a full lower lip"), ("Tordue", "lopsided twisted mouth"),
        ("Ouverte", "wide open shouting mouth"), ("Trait", "mouth drawn as one straight line"), ("Charnue fermée", "closed fleshy mouth"),
        ("Amère", "bitter mouth with deep corners")]),
    "oreilles": ("Oreilles", True, "a pair of ears alone, left and right, far apart, as seen on a face from the front", [
        ("Petites collées", "small ears flat against the head"), ("Décollées", "big sticking-out ears"), ("Longs lobes", "long ears with heavy lobes"),
        ("Pointues", "pointed ears"), ("Chou-fleur", "swollen cauliflower boxer's ears"), ("Rondes", "round ears"),
        ("Très grandes", "enormous ears"), ("Minuscules", "tiny ears"), ("Lobes attachés", "ears with attached lobes"), ("Longues fines", "long thin ears"),
        ("En pointe vers le haut", "ears sticking up and out"), ("Charnues", "thick fleshy ears"), ("Plissées", "old wrinkled ears"),
        ("Avec boucles", "ears with ring earrings"), ("Carrées", "squarish ears"), ("Inégales", "one ear bigger and lower than the other"),
        ("Poilues", "ears with tufts of hair"), ("Fines décollées", "thin ears sticking out"), ("Basses", "small ears set low"), ("Écrasées", "flat crushed ears")]),
    "moustache": ("Moustache", "petits", "a moustache alone, as a false moustache seen from the front", [
        ("Fine", "thin pencil moustache"), ("Épaisse", "thick walrus moustache"), ("Guidon", "handlebar moustache with curled tips"),
        ("En brosse", "short toothbrush moustache"), ("Tombante", "long drooping moustache"), ("Gauloise", "huge moustache hanging far below the mouth"),
        ("Chevron", "thick chevron moustache"), ("Deux traits", "moustache drawn as two thin strokes"), ("Clairsemée", "sparse teenage moustache"),
        ("En pointes", "waxed moustache with long horizontal points"), ("Impériale", "big moustache curling up onto the cheeks"),
        ("Fer à cheval", "horseshoe moustache going down to the chin"), ("Touffue courte", "short bushy moustache"), ("Asymétrique", "uneven scruffy moustache"),
        ("Pyramide", "small triangular moustache"), ("Lampe", "small lampshade moustache"), ("Fine relevée", "thin moustache with upturned ends"),
        ("Blanche", "bushy white moustache drawn in outline"), ("Poivre et sel", "moustache drawn with scattered strokes"), ("Très large", "moustache as wide as the face")]),
    "barbe": ("Barbe", "petits", "a beard alone, as a false beard seen from the front, with an empty opening for the mouth", [
        ("Bouc", "goatee"), ("Courte", "short full beard"), ("Longue", "long bushy beard"), ("Favoris", "big side whiskers alone, left and right"),
        ("Trois jours", "stubble drawn as short scattered dots and dashes"), ("Collier", "chinstrap beard without moustache"),
        ("Barbiche", "small pointed chin tuft"), ("Carrée", "square trimmed beard"), ("En pointe", "long pointed beard"), ("Fourchue", "forked beard"),
        ("Hirsute", "wild unkempt beard"), ("Mouche", "small soul patch under the lip"), ("Ancre", "anchor beard"), ("Bûcheron", "very thick wide beard"),
        ("Taillée fine", "thin sculpted line beard along the jaw"), ("Blanche longue", "long white beard drawn in outline"), ("Tressée", "braided beard"),
        ("Courte clairsemée", "patchy short beard"), ("Rouflaquettes", "wide mutton chops joining a moustache"), ("Menton seul", "round beard on the chin only")]),
    "lunettes": ("Lunettes", False, "a pair of glasses alone, seen from the front, empty lenses", [
        ("Rondes", "round wire glasses"), ("Rectangulaires", "rectangular glasses"), ("Épaisses", "thick heavy black-framed glasses"),
        ("Aviateur", "aviator glasses"), ("Demi-lunes", "half-moon reading glasses"), ("De soleil", "sunglasses with solid black lenses"),
        ("Carrées", "square glasses"), ("Papillon", "cat-eye glasses"), ("Sans monture", "rimless glasses"), ("Monocle", "a monocle with its cord"),
        ("Pince-nez", "pince-nez glasses"), ("Culs de bouteille", "glasses with very thick lenses drawn with concentric circles"),
        ("Ovales", "small oval glasses"), ("Larges fines", "large thin-framed glasses"), ("Hexagonales", "hexagonal glasses"),
        ("De soleil rondes", "round sunglasses with solid black lenses"), ("Masque de ski", "large wrap-around goggles"),
        ("Cassées", "glasses mended with tape in the middle"), ("Double pont", "glasses with a double bridge"), ("Minuscules", "tiny round glasses")]),
    "signes": ("Signes particuliers", False, "a distinguishing mark alone, as a small transfer to put on a face", [
        ("Rides du front", "three horizontal forehead wrinkles"), ("Pattes d'oie", "crow's feet wrinkles, left and right"),
        ("Cicatrice", "a long stitched scar"), ("Grain de beauté", "a mole"), ("Taches de rousseur", "a scatter of freckles"),
        ("Rides de la bouche", "deep lines from the nose to the corners of the mouth, left and right"),
        ("Bandeau", "an eye patch with its strap"), ("Pansement", "a sticking plaster")]),
    "couvre-chef": ("Couvre-chef", "petits", "a hat alone, seen from the front, as worn on a head", [
        ("Casquette", "flat cap"), ("Bonnet", "woollen beanie"), ("Feutre", "fedora hat"), ("Béret", "beret"), ("Capuche", "hood up")]),
}


def slug(name):
    return store.slug(name)


def prompt_for(cat, desc):
    label, _, framing, _ = CATEGORIES[cat]
    return "Drawing of %s: %s. %s %s" % (framing, desc, ALONE, STYLE)


def index():
    """Les elements presents, lus sur le disque : {categorie: [{id, name, file}]}, dans l'ordre du catalogue puis les
    elements ajoutes a la main (dessines dans l'atelier)."""
    out = {}
    for cat, (_, _, _, els) in CATEGORIES.items():
        names = {slug(n): n for n, _ in els}
        order = list(names)
        d = ROOT / cat
        rows = []
        if d.is_dir():
            for f in d.glob("*.png"):
                pid = f.stem
                rows.append({"id": pid, "name": names.get(pid) or pid.replace("-", " ").capitalize(), "file": "%s/%s.png" % (cat, pid),
                             "mine": pid not in names, "t": int(f.stat().st_mtime)})
        out[cat] = sorted(rows, key=lambda r: (order.index(r["id"]) if r["id"] in order else 999, r["id"]))
    return out


def _save(idx):
    return None                                                     # (ancien index.json : plus utilise)


def add_drawn(cat, name, png_bytes):
    """Range un element dessine a la main dans l'atelier (PNG, trait sur blanc)."""
    if cat not in CATEGORIES:
        raise ValueError("catégorie inconnue : %s" % cat)
    pid = slug(name or "dessin")
    base, i = pid, 2
    while (ROOT / cat / (pid + ".png")).exists():
        pid, i = "%s-%d" % (base, i), i + 1
    tmp = Path(tempfile.mkdtemp(prefix="bwpart_"))
    try:
        (tmp / "in.png").write_bytes(png_bytes)
        cut(tmp / "in.png", ROOT / cat / (pid + ".png"), CATEGORIES[cat][1])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return next(r for r in index()[cat] if r["id"] == pid)


def catalogue():
    idx = index()
    return [{"key": c, "label": v[0], "items": idx.get(c, [])} for c, v in CATEGORIES.items()]


def cut(png, dest, full, size=512):
    """Image generee (trait noir sur blanc) -> element rogne sur fond transparent. full : le blanc enferme reste blanc."""
    g = np.asarray(Image.open(png).convert("L")).astype(np.float32)
    a = np.clip((235.0 - g) / 150.0, 0, 1)                           # le blanc du papier disparait, le trait reste
    alpha = (a * 255).astype(np.uint8)
    if full == "petits":                                            # les petits vides se referment, pas la place du visage
        import cv2
        filled = sprites.fill_holes(alpha)
        add_ = ((filled > 128) & (alpha <= 128)).astype(np.uint8)
        n, lab, stats, _ = cv2.connectedComponentsWithStats(add_, connectivity=8)
        limit = 0.03 * alpha.shape[0] * alpha.shape[1]
        keep = np.isin(lab, [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] < limit])
        alpha = np.where(keep, 255, alpha).astype(np.uint8)
    elif full:
        alpha = sprites.fill_holes(alpha)
    ys, xs = np.where(alpha > 40)
    if len(xs) < 200:
        raise ValueError("image vide")
    x0, x1, y0, y1 = max(0, xs.min() - 4), min(g.shape[1], xs.max() + 5), max(0, ys.min() - 4), min(g.shape[0], ys.max() + 5)
    if (x1 - x0) > 0.97 * g.shape[1] and (y1 - y0) > 0.97 * g.shape[0]:
        raise ValueError("l'élément remplit toute l'image : sans doute un fond ou un cadre")
    ink = np.clip(g, 0, 255).astype(np.uint8)
    ink = np.where(ink > 200, 255, ink)                             # le papier : blanc franc
    im = Image.fromarray(np.dstack([ink, ink, ink, alpha]))
    im = im.crop((int(x0), int(y0), int(x1), int(y1)))
    im.thumbnail((size, size), Image.LANCZOS)
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    im.save(dest)
    return im.size


def make(cat, name, desc, prov, seed=11, redo=False):
    """Genere un element et le range. Rend sa fiche, ou None s'il existait deja."""
    _, full, _, _ = CATEGORIES[cat]
    pid = slug(name)
    dest = ROOT / cat / (pid + ".png")
    if dest.exists() and not redo:
        return None
    tmp = Path(tempfile.mkdtemp(prefix="bwpart_"))
    try:
        style = ROOT / "style.png"
        if style.exists():                                          # dans le trait de la planche de reference
            png = prov.edit([style], "Using exactly the drawing style, line weight and pen of this sheet, but none of its "
                            "characters, make a new image. " + prompt_for(cat, desc), seed, tmp)
        else:
            png = prov.t2i(prompt_for(cat, desc), 768, 768, seed, tmp)
        raw = ROOT / "_brut" / cat / (pid + ".png")
        raw.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(png, raw)                                   # l'image d'origine, pour juger et redecouper
        w, h = cut(png, dest, full)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return {"id": pid, "name": name, "file": "%s/%s.png" % (cat, pid), "w": w, "h": h, "seed": seed}


def remove(cat, pid):
    if cat not in CATEGORIES or not store.re.fullmatch(r"[a-z0-9-]{1,60}", pid or ""):
        raise ValueError("élément inconnu")
    f = ROOT / cat / (pid + ".png")
    if f.exists():                                                  # mis de cote, pas detruit
        (ROOT / "_retires" / cat).mkdir(parents=True, exist_ok=True)
        shutil.move(str(f), str(ROOT / "_retires" / cat / f.name))


def sheet(cat, dest, cols=6, cell=220):
    """Planche de controle d'une categorie : chaque element sur fond colore, avec son nom."""
    from PIL import ImageDraw
    rows = index().get(cat, [])
    if not rows:
        return None
    n = len(rows)
    out = Image.new("RGB", (cols * cell, -(-n // cols) * (cell + 18)), "white")
    dr = ImageDraw.Draw(out)
    for i, r in enumerate(rows):
        x, y = (i % cols) * cell, (i // cols) * (cell + 18)
        bg = Image.new("RGBA", (cell, cell), (255, 214, 120, 255))
        im = Image.open(ROOT / r["file"]).convert("RGBA")
        im.thumbnail((cell - 16, cell - 16))
        bg.alpha_composite(im, ((cell - im.width) // 2, (cell - im.height) // 2))
        out.paste(bg.convert("RGB"), (x, y + 18))
        dr.text((x + 4, y + 3), r["name"], fill="black")
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, quality=88)
    return dest
