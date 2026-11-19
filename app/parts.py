"""Banque d'elements de visage pour le portrait-robot, a la maniere des coffrets de la police (un visage se monte en
superposant un contour, des cheveux, des yeux, un nez, une bouche...). Chaque element est un petit dessin au trait,
vu de face, sur fond transparent.

  data/parts/index.json                {categorie: [{id, name, file, w, h}]}
  data/parts/<categorie>/<id>.png      l'element, rogne, fond transparent (le blanc enferme par le trait reste blanc
                                       quand la categorie le demande : des cheveux cachent le crane, des verres non)
  data/parts/style.png                 (facultatif) une planche de reference : les elements sont alors dessines dans son
                                       trait, par le modele d'edition, au lieu du modele d'image seul

CATEGORIES : cle -> (nom, decoupe, cadrage, elements). Decoupe : True (le blanc enferme reste opaque), False (trait seul),
"petits" (seuls les petits vides se referment), "vert" (dessine sur une tete verte qu'on efface), "visage" (silhouette
pleine, oreilles retirees), "fond" (trait ouvert pose sur un fond blanc qui epouse sa forme).
(nom, decoupe, cadrage, [(nom, description en anglais)]).
Les descriptions restent generiques : aucun personnage ni dessinateur n'est cite.
"""
import json
import shutil
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from . import partsdraw, settings, sprites, store

ROOT = settings.DATA / "parts"
STYLE = ("Hand-drawn with a black felt-tip pen: bold, slightly irregular confident line, a few flat solid black areas, "
         "no fine hatching, no grey shading, no colour. Caricature storyboard style, a little rough.")
ALONE = ("Only this single element, centred, large, seen strictly from the front, on a pure white empty background. "
         "No face around it, no head, no other feature, no frame, no text, no caption.")

CATEGORIES = {
    "visage": ("Forme du visage", "visage", "the bare outline of a head and neck seen from the front, completely empty inside: "
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
    "cheveux": ("Cheveux", "vert", "a hairstyle", [
        ("Dégarni", "balding: bare top, hair only on the sides"), ("Courts", "short neat hair"), ("Brosse", "flat-top crew cut"),
        ("Raie de côté", "side-parted combed hair"), ("Frange", "straight fringe covering the forehead"),
        ("Mi-longs", "shoulder-length untidy hair"), ("Longs raides", "long straight hair falling on both sides"),
        ("Bouclés", "thick curly hair"), ("Afro", "large round afro"), ("Chignon", "hair pulled up in a bun on top"),
        ("Queue de cheval", "hair pulled back tight in a ponytail"), ("Crête", "mohawk crest"),
        ("Hérissés", "spiky messy hair"), ("Gominés", "slicked-back greased hair, solid black"),
        ("Coupe au bol", "bowl cut"), ("Carré", "chin-length bob"), ("Tresses", "long braids on both sides"),
        ("Dreadlocks", "thick dreadlocks"), ("Couronne", "bald head with a ring of hair around the sides and a few strands on top"),
        ("Banane", "big rockabilly quiff"), ("Ondulés", "wavy medium hair")]),
    "yeux": ("Yeux", True, "a pair of eyes alone, both eyes side by side, drawn with a simple clean line, absolutely no eyebrows above, nothing between the two eyes, no nose, no eyelash make-up", [
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
    # d'apres la recherche sur les coffrets de police et le portrait parle de Bertillon : de face, un nez se distingue par
    # la largeur de son arete, sa pointe, sa base (narines visibles ou cachees), ses ailes, sa longueur et son axe
    "nez": ("Nez", "fond", "a human nose alone, seen strictly from the front, drawn with a few clean ink lines", [
        ("Moyen droit", "nose with two parallel bridge lines of medium width, a small rounded tip, nostrils barely visible"),
        ("Étroit long", "very long thin nose: narrow bridge, narrow tip, narrow base, nostril wings close to the tip"),
        ("Court retroussé", "very short nose with the tip tilted up, both nostril openings fully visible as two dark ovals"),
        ("Pointe plongeante", "nose whose tip hangs down below the nostril wings, nostrils hidden, the base forming a downward arrow"),
        ("Ailes évasées", "nose with a medium bridge and very wide rounded nostril wings flaring far beyond the tip"),
        ("Écrasé", "flattened nose: very low flat wide bridge, broad flat tip, wide horizontal base"),
        ("Arête large", "nose with a bridge equally wide from top to bottom, like a column with straight parallel sides and a squared base"),
        ("Racine étroite base large", "nose with a narrow pinched top widening steadily into a broad triangular base"),
        ("Racine large pointe fine", "nose broad at the top between the eyes, narrowing downward to a small narrow tip"),
        ("Bout en boule", "nose with a narrow bridge ending in a large round ball tip much wider than the bridge"),
        ("Bout pointu", "nose whose bridge lines converge to a sharp narrow pointed tip, with small thin nostril wings"),
        ("Bout bilobé", "nose whose tip is divided into two lobes by a short vertical groove"),
        ("Bout carré", "nose with a flat-fronted box-shaped tip showing two distinct corners"),
        ("Bosse médiane", "nose whose bridge bulges outward at mid-height, narrow above and below the bump"),
        ("Tordu", "crooked nose: the whole bridge curves to one side in a single C-shaped bend, tip off-centre"),
        ("Cassé en S", "broken nose: the bridge has two opposite bends like an S, with uneven nostril wings"),
        ("Narines pincées", "nose with thin nostril wings pressed against the tip, nostrils as two narrow vertical slits"),
        ("Narines rondes", "nose with large circular nostril openings facing forward and thin rims"),
        ("Ailes charnues", "nose with thick fleshy nostril wings, deep curved grooves beside them, heavy rounded base"),
        ("Cloison basse", "nose whose central partition hangs clearly below the nostril wings, a long nostril visible on each side of it"),
        ("Petit bouton", "tiny button nose: almost no bridge lines, a small round tip and two dot nostrils"),
        ("Grand nez fort", "huge long wide nose with a heavy broad tip and large nostril wings")]),
    "bouche": ("Bouche", True, "a mouth alone, lips drawn as a simple clean outline, no nostrils, no nose, no chin, no hatching, no shading", [
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
    "barbe": ("Barbe", "vert", "a beard, with no moustache at all and a bare upper lip", [
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
    "couvre-chef": ("Couvre-chef", "vert", "a hat, on a completely bald head with no hair", [
        ("Casquette", "flat cap"), ("Bonnet", "woollen beanie"), ("Feutre", "fedora hat"), ("Béret", "beret"), ("Capuche", "hood up")]),
}


def slug(name):
    return store.slug(name)


def prompt_for(cat, desc):
    label, full, framing, _ = CATEGORIES[cat]
    if full == "vert":                                              # la description d'abord : elle pese plus
        return ("%s: %s, %sOnly the %s is drawn, in black ink with white highlights, on a pure white empty background. "
                "No text, no frame. %s" % (framing.capitalize(), desc, GREEN, framing.split(",")[0].replace("a ", "", 1), STYLE))
    return "%s. It is a drawing of %s. %s %s" % (desc.capitalize(), framing, ALONE, STYLE)      # la description d'abord


def index():
    """Les elements presents, lus sur le disque : {categorie: [{id, name, file}]}, dans l'ordre du catalogue puis les
    elements ajoutes a la main (dessines dans l'atelier)."""
    out = {}
    for cat, (_, _, _, els) in CATEGORIES.items():
        if cat in partsdraw.CATEGORIES:                             # categorie tracee par le calcul : ses noms et ses places
            els = [(n, "") for n, _ in partsdraw.CATEGORIES[cat][1]]
        names = {slug(n): n for n, _ in els}
        order = list(names)
        d = ROOT / cat
        places = _places(cat)
        rows = []
        if d.is_dir():
            for f in d.glob("*.png"):
                pid = f.stem
                row = {"id": pid, "name": names.get(pid) or pid.replace("-", " ").capitalize(), "file": "%s/%s.png" % (cat, pid),
                       "mine": pid not in names, "t": int(f.stat().st_mtime)}
                if cat in CAPPED:                                   # cheveux, couvre-chef : ce qui depasse au-dessus est cache
                    row["cap"] = _cap(cat, f)
                if row["mine"]:                                     # dessine dans l'atelier : nom, place et formes dans <id>.json
                    meta = _meta(cat, pid)
                    if meta.get("name"):
                        row["name"] = meta["name"]
                    if meta.get("place"):
                        row["place"] = meta["place"]
                    row["editable"] = bool(meta.get("shapes"))
                    if meta.get("pair"):
                        row["pair"] = True                          # retouche d'une oreille : reste une paire
                if pid in places:                                   # place et largeur vraies dans le cadre 1000 x 1000 de l'atelier
                    row["place"] = places[pid]
                    if cat in PAIRED:
                        row["pair"] = True                          # une seule oreille : l'atelier pose sa jumelle en miroir
                rows.append(row)
        out[cat] = sorted(rows, key=lambda r: (order.index(r["id"]) if r["id"] in order else 999, r["id"]))
    return out


CAPPED = {"cheveux", "couvre-chef"}
_CAPS = {}


def _cap(cat, f, n=48):
    """Profil du dessus d'une coupe de cheveux ou d'un couvre-chef : n hauteurs (part de la hauteur de l'image, 0 = haut)
    regulierement espacees sur sa largeur. L'atelier cache tout ce qui se trouve au-dessus de ce profil dans les calques du
    dessous (le crane ne depasse plus au-dessus de la coupe, meme si on la descend). Garde en memoire par date du fichier."""
    key = (str(f), f.stat().st_mtime)
    if key not in _CAPS:
        a = np.asarray(Image.open(f).convert("RGBA"))[..., 3] > 60
        h, w = a.shape
        top = np.where(a.any(axis=0), a.argmax(axis=0), -1).astype(float)
        out = []
        for i in range(n):
            x0, x1 = int(i * w / n), max(int(i * w / n) + 1, int((i + 1) * w / n))
            seg = top[x0:x1]
            seg = seg[seg >= 0]
            out.append(round(float(seg.min()) / h, 4) if len(seg) else None)
        _CAPS[key] = out
    return _CAPS[key]


PAIRED = {"oreilles"}
# ou l'encre d'une categorie a le droit de se trouver, dans le cadre de l'atelier (x0, y0, x1, y1) : controle a la fabrication
ZONES = {"visage": (150, 60, 850, 1000), "yeux": (270, 390, 730, 580), "sourcils": (250, 340, 750, 500), "nez": (360, 400, 640, 700),
         "bouche": (330, 640, 670, 800), "oreilles": (690, 360, 900, 720), "moustache": (300, 560, 700, 900), "barbe": (200, 420, 800, 1300),
         "lunettes": (180, 380, 820, 720)}


def _places(cat):
    try:
        return json.loads((ROOT / cat / "places.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _frame(im, place):
    """L'encre d'un element, remise a sa place dans le cadre 1000 x 1000 (masque booleen)."""
    a = np.asarray(im.convert("RGBA"))
    ink = (a[..., 3] > 60) & (a[..., 0] < 128)
    out = np.zeros((partsdraw.FH, partsdraw.F), bool)
    x0, y0 = int(round(place[0] - im.width / 2)), int(round(place[1] - im.height / 2))
    out[max(0, y0):y0 + im.height, max(0, x0):x0 + im.width] = ink[max(0, -y0):, max(0, -x0):][:partsdraw.FH - max(0, y0), :partsdraw.F - max(0, x0)]
    return out


def check_drawn(cat, drawn, same=0.80):
    """Controle d'une categorie tracee, avant de la ranger. drawn : [(nom, image, place)]. Rend la liste des defauts
    (vide = bon) : encre hors de la zone de la categorie, element vide, paire incomplete, oreille des deux cotes, et
    surtout deux elements trop semblables (c'est ce qui rendait l'ancienne banque inutilisable)."""
    from PIL import ImageFilter as F_
    bad, masks = [], []
    x0, y0, x1, y1 = ZONES[cat]
    for name, im, place in drawn:
        m = _frame(im, place)
        if m.sum() < 150:
            bad.append("%s : vide" % name)
        outside = m.copy()
        outside[y0:y1, x0:x1] = False
        if outside.sum() > 0.01 * max(1, m.sum()):
            bad.append("%s : de l'encre hors de la zone de la catégorie (%d px)" % (name, outside.sum()))
        left, right = m[:, :500].sum(), m[:, 500:].sum()
        if cat in ("yeux", "sourcils") and min(left, right) < 0.25 * max(left, right):
            bad.append("%s : il manque un côté de la paire" % name)
        if cat in PAIRED and left > 0:
            bad.append("%s : l'oreille déborde de l'autre côté" % name)
        dens = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(F_.GaussianBlur(5)), dtype=np.float32)
        masks.append((name, dens))                                  # densite d'encre : forme ET matiere (plein, clairseme)
    for i in range(len(masks)):
        for j in range(i + 1, len(masks)):
            a, b = masks[i][1], masks[j][1]
            iou = np.minimum(a, b).sum() / max(1.0, np.maximum(a, b).sum())
            if iou > same:
                bad.append("%s et %s : trop semblables (%.0f %% de recouvrement)" % (masks[i][0], masks[j][0], iou * 100))
    return bad


def draw_bank(cat, force=False):
    """Fabrique une categorie par le calcul (app/partsdraw.py) et la range, apres controle. Les anciens elements de la
    categorie (sauf ceux dessines a la main dans l'atelier) partent dans data/parts/_ancien. Rend (nombre, defauts) ; si le
    controle trouve un defaut, rien n'est range (sauf force)."""
    fn, variants = partsdraw.CATEGORIES[cat]
    drawn = []
    for i, (name, kw) in enumerate(variants):
        im, place = fn(seed=i + 1, **kw)
        drawn.append((name, im, place))
    bad = check_drawn(cat, drawn)
    if bad and not force:
        return 0, bad
    d = ROOT / cat
    d.mkdir(parents=True, exist_ok=True)
    old_names = {slug(n) for n, _ in CATEGORIES[cat][3]}
    places = _places(cat)
    keep = ROOT / "_ancien" / ("%s-%s" % (cat, time.strftime("%Y%m%d-%H%M%S")))
    for f in list(d.glob("*.png")):
        if f.stem in old_names or f.stem in places:                 # element d'une banque precedente (pas un dessin de l'atelier)
            keep.mkdir(parents=True, exist_ok=True)
            shutil.move(str(f), str(keep / f.name))
    new = {}
    for name, im, place in drawn:
        pid = slug(name)
        im.save(d / (pid + ".png"))
        new[pid] = place
    (d / "places.json").write_text(json.dumps(new, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(drawn), bad


def _save(idx):
    return None                                                     # (ancien index.json : plus utilise)


def _meta(cat, pid):
    """Ce qu'on garde d'un element dessine dans l'atelier : {name, place, shapes, under} (data/parts/<cat>/<id>.json)."""
    try:
        return json.loads((ROOT / cat / (pid + ".json")).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _check(cat, pid):
    if cat not in CATEGORIES or not store.re.fullmatch(r"[a-z0-9-]{1,60}", pid or ""):
        raise ValueError("élément inconnu")


def add_drawn(cat, name, png_bytes, replace=None):
    """Range un element dessine a la main dans l'atelier (PNG, trait sur blanc, cadre de l'atelier). replace : id d'un
    element dessine a remplacer (meme id : les visages ou il est pose le suivent). Garde sa place dans le cadre."""
    if cat not in CATEGORIES:
        raise ValueError("catégorie inconnue : %s" % cat)
    if replace:
        _check(cat, replace)
        if not (ROOT / cat / (replace + ".png")).exists():
            raise ValueError("élément inconnu")
        pid = replace
    else:
        pid = slug(name or "dessin")
        base, i = pid, 2
        while (ROOT / cat / (pid + ".png")).exists():
            pid, i = "%s-%d" % (base, i), i + 1
    tmp = Path(tempfile.mkdtemp(prefix="bwpart_"))
    box = {}
    try:
        (tmp / "in.png").write_bytes(png_bytes)
        cut(tmp / "in.png", ROOT / cat / (pid + ".png"), CATEGORIES[cat][1], box=box)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    k = 1000.0 / box["src"][0]                                      # l'image recue couvre le cadre 1000 x 1000 de l'atelier
    meta = _meta(cat, pid) if replace else {}
    meta.update(name=(name or meta.get("name") or pid), place=[round((box["x0"] + box["x1"]) / 2 * k, 1),
                                                                round((box["y0"] + box["y1"]) / 2 * k, 1), round((box["x1"] - box["x0"]) * k)])
    (ROOT / cat / (pid + ".json")).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return next(r for r in index()[cat] if r["id"] == pid)


def drawn(cat, pid):
    """Formes d'un element dessine dans l'atelier, pour le rouvrir dans l'editeur."""
    _check(cat, pid)
    return _meta(cat, pid)


def save_shapes(cat, pid, shapes, under=None, pair=False):
    """Garde les formes (et l'image de fond d'une retouche) d'un element dessine, a cote de son PNG."""
    _check(cat, pid)
    if not (ROOT / cat / (pid + ".png")).exists():
        raise ValueError("élément inconnu")
    meta = _meta(cat, pid)
    meta["shapes"] = shapes if isinstance(shapes, list) else []
    meta["under"] = under if isinstance(under, dict) else None
    meta["pair"] = bool(pair)
    (ROOT / cat / (pid + ".json")).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


def catalogue():
    idx = index()
    return [{"key": c, "label": v[0], "items": idx.get(c, [])} for c, v in CATEGORIES.items()]


def cut(png, dest, full, size=512, box=None):
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
    if box is not None:                                             # ou etait l'element dans l'image recue
        box.update(x0=int(x0), y0=int(y0), x1=int(x1), y1=int(y1), src=(g.shape[1], g.shape[0]))
    im.thumbnail((size, size), Image.LANCZOS)
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    im.save(dest)
    return im.size


def no_ears(im):
    """Forme de visage sans oreilles : les oreilles sont une categorie a part, posee dessous. On retire de la silhouette
    ce qui depasse sur les cotes, puis on referme le contour d'un trait."""
    import cv2
    arr = np.asarray(im.convert("RGBA")).copy()
    S = (arr[..., 3] > 128).astype(np.uint8)
    ys, xs = np.where(S > 0)
    if not len(xs):
        return im
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    W, H, cx = x1 - x0 + 1, y1 - y0 + 1, (x0 + x1) / 2
    k = max(9, int(0.45 * W)) | 1                                    # plus grand qu'une oreille dans tous les sens
    O = cv2.morphologyEx(S, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    n, lab, st, cen = cv2.connectedComponentsWithStats(((S > 0) & (O == 0)).astype(np.uint8), connectivity=8)
    ears = np.zeros(S.shape, bool)
    for i in range(1, n):
        ax, ay, aw, ah, area = (int(v) for v in st[i])
        if area > 0.003 * S.sum() and abs(cen[i][0] - cx) > 0.30 * W and y0 + 0.18 * H < cen[i][1] < y0 + 0.80 * H and ah > 0.07 * H:
            ears |= lab == i
    if not ears.any():
        return im
    ears = cv2.dilate(ears.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    S2 = ((S > 0) & ~ears).astype(np.uint8)
    S2 = cv2.morphologyEx(S2, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(S2, connectivity=8)
    if n2 > 2:                                                       # miettes d'oreille detachees
        S2 = (lab2 == 1 + int(np.argmax(st2[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    grey = arr[..., 0].astype(np.int32)
    ink = (grey < 150) & (arr[..., 3] > 128)
    t = max(3, int(round(0.012 * W))) | 1                              # epaisseur du trait qui referme
    ring = (S2 > 0) & (cv2.erode(S2, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * t + 1, 2 * t + 1))) == 0)
    seam = ring & (cv2.dilate(ears.astype(np.uint8), np.ones((2 * t + 9, 2 * t + 9), np.uint8)) > 0)     # seulement la ou l'oreille etait
    out = np.full(arr.shape, 255, np.uint8)
    out[..., 3] = np.where(S2 > 0, 255, 0)
    dark = (ink & (S2 > 0)) | seam
    for c in range(3):
        out[..., c] = np.where(seam, 20, np.where(S2 > 0, arr[..., c], 255))
    out[..., 3] = np.asarray(Image.fromarray(out[..., 3]).filter(ImageFilter.GaussianBlur(0.7)))
    return Image.fromarray(out)


def backing(im, share=0.16):
    """Pose un fond blanc derriere un element fait de traits ouverts (un nez) : il cache alors ce qui est dessous, au lieu
    de n'etre qu'un trait. Le fond epouse la forme : les traits sont refermes largement, puis l'interieur est rempli."""
    import cv2
    arr = np.asarray(im.convert("RGBA")).copy()
    a = arr[..., 3]
    ink = (a > 60).astype(np.uint8)
    k = max(15, int(0.5 * max(arr.shape[:2]))) | 1                    # on referme tres large, puis on remplit : le fond
    pad = k                                                           # epouse les traits, sans deborder comme une enveloppe
    big = cv2.copyMakeBorder(ink, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
    closed = cv2.morphologyEx(big, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    hull = np.zeros_like(closed)
    cs, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(hull, cs, -1, 1, -1)
    hull = hull[pad:-pad, pad:-pad]
    soft = np.asarray(Image.fromarray((hull * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)))
    for c in range(3):                                               # la ou il n'y avait rien : blanc
        arr[..., c] = np.where(a < 30, 255, arr[..., c])
    arr[..., 3] = np.maximum(a, soft)
    return Image.fromarray(arr)


def recut(cat):
    """Redecoupe tous les elements d'une categorie a partir de leurs images d'origine (data/parts/_brut), sans regenerer."""
    full, n = CATEGORIES[cat][1], 0
    for raw in sorted((ROOT / "_brut" / cat).glob("*.png")):
        dest = ROOT / cat / raw.name
        if not dest.exists():
            continue                                                 # element retire de la banque : il le reste
        try:
            _cut_any(raw, dest, full)
            n += 1
        except ValueError as e:
            print("ECHEC %s / %s : %s" % (cat, raw.stem, e), flush=True)
    return n


def _cut_any(png, dest, full):
    if full == "vert":
        return cut_green(png, dest)
    if full == "visage":
        w, h = cut(png, dest, True)
        im = no_ears(Image.open(dest))
        im.save(dest)
        return im.size
    if full == "fond":
        w, h = cut(png, dest, False)
        im = backing(Image.open(dest))
        im.save(dest)
        return im.size
    return cut(png, dest, full)


def cut_green(png, dest, size=512):
    """Element dessine sur une tete de mannequin verte unie (cheveux, barbe, chapeau) : le vert et le papier autour
    deviennent transparents, l'element reste opaque, blancs interieurs compris (une meche claire cache ce qui est dessous)."""
    import cv2
    rgb = np.asarray(Image.open(png).convert("RGB")).astype(np.int32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = ((g - np.maximum(r, b)) > 28).astype(np.uint8)
    # la tete : le plus grand aplat vert d'un seul tenant. Les reflets verts entre les meches restent des cheveux.
    core = cv2.erode(green, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(core, connectivity=8)
    if n < 2:
        raise ValueError("pas de tête verte dans l'image")
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    # elargie : elle reprend son bord, et avale le trait qui cerne la tete, le cou et les oreilles
    head = cv2.dilate((lab == big).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))) > 0
    grey = (0.3 * r + 0.59 * g + 0.11 * b)
    grey = np.where((green > 0) & ~head, 255, grey)                 # reflet vert dans les cheveux : une meche claire
    paper = ((grey > 225) & ~head).astype(np.uint8)
    lab2 = np.pad(paper, 1, constant_values=1)
    cv2.floodFill(lab2, None, (0, 0), 2)                             # le papier relie au bord : dehors
    outside = lab2[1:-1, 1:-1] == 2
    alpha = np.where(head | outside, 0, 255).astype(np.uint8)
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))     # miettes, restes de trait du cou
    nn, l3, st3, _ = cv2.connectedComponentsWithStats((alpha > 0).astype(np.uint8), connectivity=8)
    if nn > 2:                                                       # petits morceaux detaches (bout d'oreille, de cou) : enleves
        keep = [i for i in range(1, nn) if st3[i, cv2.CC_STAT_AREA] >= 0.04 * st3[1:, cv2.CC_STAT_AREA].max()]
        alpha = np.where(np.isin(l3, keep), alpha, 0).astype(np.uint8)
    alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.8)))
    ys, xs = np.where(alpha > 40)
    if len(xs) < 300:
        raise ValueError("rien à garder : pas d'élément autour de la tête verte")
    if head.mean() < 0.03:
        raise ValueError("pas de tête verte dans l'image")
    x0, x1, y0, y1 = max(0, xs.min() - 4), min(rgb.shape[1], xs.max() + 5), max(0, ys.min() - 4), min(rgb.shape[0], ys.max() + 5)
    ink = np.clip(grey, 0, 255).astype(np.uint8)
    ink = np.where(ink > 205, 255, ink)
    im = Image.fromarray(np.dstack([ink, ink, ink, alpha])).crop((int(x0), int(y0), int(x1), int(y1)))
    im.thumbnail((size, size), Image.LANCZOS)
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    im.save(dest)
    return im.size


GREEN = ("shown on a featureless mannequin head seen from the front: the whole head, face, ears and neck are one flat solid "
         "bright green shape (pure green-screen green), with no eyes, no nose, no mouth, no outline inside. ")


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
        w, h = _cut_any(png, dest, full)
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
        meta = ROOT / cat / (pid + ".json")
        if meta.exists():
            shutil.move(str(meta), str(ROOT / "_retires" / cat / meta.name))


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
