"""Expressions du visage d'un personnage, posees sur son orbite comme les bouches dessinees (tools/levres.py).

Sur quelques images-cles de face de l'orbite (celles des bouches dessinees, sinon face et trois-quarts), la tete est
decoupee (plus haut que pour la bouche : sourcils et front compris) et repetee dans une grille 2x2 ; le modele (Nano
Banana Pro, sur fal ou tire a la main sur Dzine) redessine chaque case avec une expression : sourcils, paupieres, regard,
bouche FERMEE, joues. Chaque case est recalee sur la decoupe (hors du visage : cheveux, contour, epaules), puis on ne garde
que ce qui a change dans le visage, a l'interieur de la silhouette d'origine : une carte transparente par expression.

    <orbite>/expr/kFFF_<cle>.webp       les cartes (pixels de l'image d'orbite, carre x, y, s de la decoupe)
    <orbite>/expr/kFFF_<cle>_g.webp     les gommes : ou effacer le dessin d'origine sous la carte (tete redessinee plus etroite)
    <orbite>/expr/cFFF_<cle>.webp       cartes « cuites » des images voisines (bake : flot optique depuis l'image-cle)
    <orbite>/expr.json                  { w, h, model, exact, keys: [{ f, x, y, s, cards: {cle: chemin}, gom?, out?, cuite? }] }
    variants[v].orbit.expr              instant de la derniere ecriture (le navigateur recharge)
    variants[v].orbit.exprs             cles des expressions disponibles (menus du clic droit)

A l'affichage (lipsync.js exprMarkup), la carte de l'image-cle la plus proche est recalee sur la bouche suivie de l'image
montree, comme les bouches ; elle passe sous la bouche du lip sync. Sans bouche suivie (mouth.json), pas d'expression.
"""

import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from . import poses, settings, store

MODEL = "fal-ai/nano-banana-pro/edit"
SIDE = 1024
MARGIN = 16
CELL = (SIDE - 3 * MARGIN) // 2           # 488, comme tools/levres_dzine.py
GRID = ["haut-gauche", "haut-droite", "bas-gauche", "bas-droite"]

KEEP = ("Change ONLY the facial expression: the eyebrows, the eyelids and the gaze, the closed mouth and the cheeks. The mouth "
        "stays CLOSED in every panel: no teeth, no open mouth. The lips keep their own size, thickness and width exactly as in "
        "the reference (big thick lips stay just as big and thick, thin lips stay thin): only the corners of the mouth and the "
        "pressure of the lips change, the mouth is never redrawn smaller or narrower. Everything else stays exactly as in the reference, pixel for "
        "pixel: the same head shape and outline, the same hair, the same ears, the same nose, the same glasses if there are "
        "any, the same moustache or beard if there is one (same shape, same size, never removed), the same clothes, the same "
        "framing, the same position, the same size, the same viewing angle. Keep the character's own design: uneven or oddly "
        "placed eyes, an odd head shape or exaggerated proportions are intentional and must never be corrected, cleaned up or "
        "made symmetrical. The new features are drawn by the same artist with the same tools: the same kind of line with the "
        "same thickness and roughness, the same way of filling, the same colours as the rest of the drawing. No clean ink, no "
        "new colours, no added detail, no added shading, no text, no labels.")


def prompt(keys):
    """Consigne de la grille : une expression par case (None : la tete inchangee)."""
    out = ("The image is a 2x2 grid of four panels separated by thin white gutters. All four panels show the SAME drawn head, "
           "repeated. Redraw the four panels so that the head stays identical in every panel and ONLY the facial expression "
           "changes, differently in each panel. Keep the grid layout, every panel at the same size and position. ")
    names = {"haut-gauche": "Top-left", "haut-droite": "Top-right", "bas-gauche": "Bottom-left", "bas-droite": "Bottom-right"}
    for c, k in zip(GRID, keys):
        e = poses.expression(k) if k else None
        out += "%s panel: %s. " % (names[c], ("the character looks " + e[1]) if e else "exactly the reference, unchanged")
    return out + "All panels: " + KEEP


# ------------------------------------------------------------------ images-cles et decoupe
def orbit_folder(iid, vid):
    it = store.load_item(iid)
    o = it["variants"][vid]["orbit"]
    return it, o, store.item_dir(iid) / o["dir"]


def default_frames(iid, vid="base"):
    """Images-cles : celles des bouches dessinees de face (lips.json, ni dos ni cuites), sinon face et trois-quarts face
    des deux cotes ; seulement celles ou la bouche est suivie."""
    from . import sprites
    it, o, folder = orbit_folder(iid, vid)
    fr = json.loads((folder / "mouth.json").read_text(encoding="utf-8"))["frames"]
    ok = lambda f: 0 <= f < len(fr) and fr[f] and fr[f].get("up") and not fr[f].get("ext") and not fr[f].get("back")
    try:
        lk = json.loads((folder / "lips.json").read_text(encoding="utf-8")).get("keys", [])
        got = sorted({k["f"] for k in lk if not k.get("dos") and "cuite" not in k and not k.get("up0") and ok(k["f"])})
        if got:
            return got
    except (OSError, ValueError):
        pass
    n = int(o["n"])
    snaps = o.get("snaps") or sprites.default_snaps(n)
    out = []
    for a in ("face", "3/4 face gauche", "3/4 face droite"):
        f = int(snaps.get(a, 0)) % n
        # le trois-quarts tout juste : un peu plus pres de la face, la ou la bouche se voit encore bien
        if a != "face":
            f = (f - 1) % n if a.endswith("gauche") else (f + 1) % n
        if ok(f) and f not in out:
            out.append(f)
    return out


def head_width(im, m):
    """Largeur de la tete a hauteur de bouche : le morceau de silhouette qui contient la bouche suivie (pixels d'orbite).
    Plus sur que la largeur de bouche, qui va du simple trait aux grosses levres selon les personnages."""
    a = np.asarray(im.split()[3])
    y = int(min(max(m["cy"] - m["w"] * 0.3, 0), a.shape[0] - 1))
    row = a[y] > 40
    cx = int(min(max(m["cx"], 0), a.shape[1] - 1))
    if not row[cx]:
        return 2.2 * m["w"]
    l, r = cx, cx
    while l > 0 and row[l - 1]:
        l -= 1
    while r < len(row) - 1 and row[r + 1]:
        r += 1
    return float(min(max(r - l + 1, 1.3 * m["w"]), 4.5 * m["w"]))


def crop(iid, vid, f):
    """La tete decoupee autour de la bouche suivie, front et sourcils compris : carre de 1,9 largeur de tete, la bouche
    aux 68 % de la hauteur. Rend (x, y, s, rgba, flat, bouche (avec hw : largeur de tete), dossier, mouth.json)."""
    _, _, folder = orbit_folder(iid, vid)
    mouth = json.loads((folder / "mouth.json").read_text(encoding="utf-8"))
    m = mouth["frames"][f]
    if not m:
        raise ValueError("la bouche n'est pas suivie sur l'image %d" % f)
    im = Image.open(folder / ("%03d.webp" % f)).convert("RGBA")
    m = dict(m, hw=head_width(im, m))
    s = int(min(max(1.9 * m["hw"], 200), im.width, im.height))
    x = int(min(max(m["cx"] - s / 2, 0), im.width - s))
    y = int(min(max(m["cy"] - s * 0.68, 0), im.height - s))
    rgba = im.crop((x, y, x + s, y + s))
    flat = Image.new("RGB", (s, s), "white")
    flat.paste(rgba, (0, 0), rgba)
    return x, y, s, rgba, flat, m, folder, mouth


def face_zone(s, mx, my, hw, mw=None):
    """Le visage dans la decoupe : du front au menton, d'une joue a l'autre (en largeurs de tete), et toute la bouche
    (grosses levres comprises : jusqu'a 0,7 largeur de bouche sous la bouche suivie)."""
    yy, xx = np.mgrid[0:s, 0:s]
    mw = mw or hw * 0.4
    cy, ry = my - hw * 0.45, hw * 0.68
    face = ((((xx - mx) / (hw * 0.68)) ** 2 + ((yy - cy) / ry) ** 2) <= 1.0) & (yy < my + hw * 0.16)
    mouth = (((xx - mx) / (mw * 0.85)) ** 2 + ((yy - my - mw * 0.1) / (mw * 0.6)) ** 2) <= 1.0
    return face | mouth


# ------------------------------------------------------------------ grille (meme gabarit que tools/levres_dzine.py)
def cell_origin(c):
    return MARGIN + (c % 2) * (CELL + MARGIN), MARGIN + (c // 2) * (CELL + MARGIN)


def grid_from(flat):
    g = Image.new("RGB", (SIDE, SIDE), "white")
    t = flat.resize((CELL, CELL), Image.LANCZOS)
    for c in range(4):
        g.paste(t, cell_origin(c))
    return g


def split_cells(img):
    """Les 4 cases de la grille rendue, elargies de 12 % de chaque cote pour retrouver ce que le modele a decale."""
    img = img.convert("RGB")
    w, h = img.size
    sx, sy = w / SIDE, h / SIDE
    ext = int(CELL * 0.12)
    cells = []
    for c in range(4):
        ox, oy = cell_origin(c)
        x0, y0, x1, y1 = ox - ext, oy - ext, ox + CELL + ext, oy + CELL + ext
        bg = Image.new("RGB", (x1 - x0, y1 - y0), "white")
        part = img.crop((int(round(x0 * sx)), int(round(y0 * sy)), int(round(x1 * sx)), int(round(y1 * sy))))
        bg.paste(part.resize((x1 - x0, y1 - y0), Image.LANCZOS), (0, 0))
        cells.append(bg)
    return cells


def register(src, wide, zone):
    """Recale une case rendue sur la decoupe source (echelle + translation par correlation hors du visage, puis affinage
    ECC affine borne). Rend (case recalee s x s, note de correlation)."""
    import cv2
    gray = lambda im: np.asarray(im.convert("L"), dtype=np.float32)
    s = src.width
    a = cv2.resize(gray(src), (CELL, CELL), interpolation=cv2.INTER_AREA)
    b = gray(wide)
    zk = cv2.resize(zone.astype(np.uint8), (CELL, CELL), interpolation=cv2.INTER_NEAREST)
    mask = (1 - cv2.dilate(zk, np.ones((11, 11), np.uint8))).astype(np.uint8)
    c0 = int(CELL * 0.08)
    tpl, tm = a[c0:CELL - c0, c0:CELL - c0], mask[c0:CELL - c0, c0:CELL - c0].astype(np.float32)
    best = None
    for k in np.arange(0.84, 1.18, 0.02):
        t = cv2.resize(tpl, None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR)
        mm = cv2.resize(tm, None, fx=k, fy=k, interpolation=cv2.INTER_NEAREST)
        if t.shape[0] >= b.shape[0] or t.shape[1] >= b.shape[1]:
            continue
        r = np.nan_to_num(cv2.matchTemplate(b, t, cv2.TM_CCORR_NORMED, mask=mm), nan=-1, posinf=-1, neginf=-1)
        _, v, _, loc = cv2.minMaxLoc(r)
        if best is None or v > best[0]:
            best = (v, k, loc)
    v, k, (lx, ly) = best
    Wf = np.array([[k, 0, lx - k * c0], [0, k, ly - k * c0]], np.float32)
    hb, wb = b.shape
    a_big = cv2.copyMakeBorder(a, 0, hb - CELL, 0, wb - CELL, cv2.BORDER_CONSTANT, value=255)
    mk = cv2.copyMakeBorder(mask, 0, hb - CELL, 0, wb - CELL, cv2.BORDER_CONSTANT, value=0)
    try:
        _, W2 = cv2.findTransformECC(a_big, b, Wf.copy(), cv2.MOTION_AFFINE,
                                     (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-7), mk * 255, 7)
        if np.abs(W2[:, :2] - Wf[:, :2]).max() < 0.04 and np.abs(W2[:, 2] - Wf[:, 2]).max() < 8:
            Wf = W2
    except cv2.error:
        pass
    f = CELL / s
    F = (Wf @ np.array([[f, 0, 0], [0, f, 0], [0, 0, 1]], np.float32)).astype(np.float32)
    out = cv2.warpAffine(np.asarray(wide), F, (s, s), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(out), round(float(v), 4)


# ------------------------------------------------------------------ carte
def card_alpha(gen, flat, rgba, mx, my, mw, hw):
    """Alpha de la carte d'une expression : ce qui a change dans le visage (zone face_zone), trous bouches (l'interieur
    d'un sourcil releve ne doit pas laisser voir l'ancien), petites taches retirees, bord adouci, et seulement a
    l'interieur de la silhouette d'origine (jamais de fond colle). Gomme : la ou la tete redessinee est plus etroite que
    l'origine (grosse levre redessinee plus mince, joue rentree), son fond relie au fond d'origine ; le dessin d'origine y
    est efface a l'affichage (comme les gommes des bouches) et la carte n'y pose rien.
    Rend (alpha L, part changee hors du visage, gomme L ou None)."""
    import cv2
    s = flat.width
    zone = face_zone(s, mx, my, hw, mw)
    soft = lambda im: np.asarray(im.filter(ImageFilter.GaussianBlur(1.3)), dtype=np.int16)
    dd = np.abs(soft(gen) - soft(flat)).max(axis=2)
    e = int(s * 0.04)
    inner = np.zeros((s, s), bool)
    inner[e:s - e, e:s - e] = True
    srcA = np.asarray(rgba.split()[3]) > 40
    outside = float((dd[inner & ~zone & srcA] > 45).mean()) if (inner & ~zone & srcA).any() else 0.0
    ch = ((dd > 30) & zone & inner & srcA).astype(np.uint8)
    k = int(max(3, mw * 0.22)) | 1
    ch = cv2.morphologyEx(ch, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(ch, connectivity=8)
    small = (mw * 0.12) ** 2
    keep = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= small])
    ff = (1 - keep).astype(np.uint8)
    cv2.floodFill(ff, np.zeros((s + 2, s + 2), np.uint8), (0, 0), 2)
    keep = (keep | (ff == 1)) & zone
    r = max(2, int(mw * 0.10))
    m = Image.fromarray((keep * 255).astype("uint8")).filter(ImageFilter.MaxFilter(2 * r + 1)).filter(ImageFilter.GaussianBlur(r * 0.8))
    # bord de la zone en fondu (un sourcil releve qui touche le haut de la zone ne laisse pas de couture nette)
    zsoft = np.asarray(Image.fromarray((zone * 255).astype("uint8")).filter(ImageFilter.MinFilter(int(max(3, hw * 0.05)) | 1))
                       .filter(ImageFilter.GaussianBlur(max(1.5, hw * 0.04))))
    m = np.minimum(np.asarray(m), zsoft)
    sil = np.asarray(Image.fromarray((srcA * 255).astype("uint8")).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
    # gomme : blanc de la case rendue relie au fond d'origine (le blanc est ronge avant, pour qu'un trait interrompu ne
    # laisse pas le fond entrer dans le visage), sur le dessin d'origine, dans la zone de la bouche et pres du bord
    arr = np.asarray(gen, dtype=np.int16)
    white = (arr.min(axis=2) > 226).astype(np.uint8)
    kk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, ((int(max(5, mw * 0.15)) | 1),) * 2)
    n, lab = cv2.connectedComponents(cv2.erode(white, kk), connectivity=4)
    seeds = np.bincount(lab[~srcA], minlength=n)
    bg = (cv2.dilate(np.isin(lab, [i for i in range(1, n) if seeds[i] >= 12]).astype(np.uint8), kk) & white) > 0
    edge = cv2.distanceTransform(srcA.astype(np.uint8), cv2.DIST_L2, 3) <= max(3.0, mw * 0.5)
    gz = cv2.dilate(zone.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, ((int(mw * 0.3) | 1),) * 2)) > 0
    g = (bg & srcA & edge & gz).astype("uint8") * 255
    g = np.asarray(Image.fromarray(g).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.7)), np.float32)
    gom = Image.fromarray(g.astype("uint8")) if (g > 128).sum() >= 6 else None
    al = m * sil * (1 - g / 255) if gom else m * sil
    return Image.fromarray(al.astype("uint8")), outside, gom


def assemble(iid, vid, f, rendered, keys, test=False, model="dzine/nano-banana-pro"):
    """Grille rendue (chemin ou image) -> cartes des expressions `keys` (une par case, None = case ignoree) pour l'image-cle f.
    Ecrit les cartes, expr.json et orbit.expr / orbit.exprs (sauf test). Rend (entree, rangee de controle)."""
    x, y, s, rgba, flat, m, folder, mouth = crop(iid, vid, f)
    img = rendered if isinstance(rendered, Image.Image) else Image.open(rendered)
    cells = split_cells(img)
    mx, my, mw, hw = m["cx"] - x, m["cy"] - y, m["w"], m["hw"]
    zone = face_zone(s, mx, my, hw, mw)
    cards, outs, goms, row = {}, {}, {}, [flat]
    for k, wide in zip(keys, cells):
        if not k:
            continue
        gen, score = register(flat, wide, zone)
        al, out, gom = card_alpha(gen, flat, rgba, mx, my, mw, hw)
        card = gen.convert("RGBA")
        card.putalpha(al)
        rel = "expr/k%03d_%s.webp" % (f, k)
        grel = rel[:-5] + "_g.webp"
        if not test:
            (folder / "expr").mkdir(exist_ok=True)
            card.save(folder / rel, quality=92, method=4)
            if gom:
                gi = Image.new("RGBA", gom.size, (0, 0, 0, 0))
                gi.putalpha(gom)
                gi.save(folder / grel, lossless=True, method=4)
                goms[k] = grel
            else:
                (folder / grel).unlink(missing_ok=True)
        elif gom:
            goms[k] = grel
        cards[k], outs[k] = rel, round(out, 4)
        # comme a l'affichage : dessin d'origine gomme, carte par-dessus, sur un fond vert pale (la gomme s'y voit)
        src = rgba.copy()
        if gom:
            src.putalpha(Image.fromarray((np.asarray(rgba.split()[3], np.float32) * (1 - np.asarray(gom, np.float32) / 255)).astype("uint8")))
        shown = Image.alpha_composite(Image.alpha_composite(Image.new("RGBA", (s, s), (200, 225, 200, 255)), src), card).convert("RGB")
        row.append(shown)
        print("image %d · %s : recalage %.3f, change hors du visage %.1f %%" % (f, k, score, out * 100), flush=True)
    entry = {"f": f, "x": x, "y": y, "s": s, "cards": cards, "out": outs}
    if goms:
        entry["gom"] = goms
    if not test and cards:
        write_entry(iid, vid, folder, mouth, entry, model)
    return entry, row


def write_entry(iid, vid, folder, mouth, entry, model):
    """Ajoute les cartes d'une image-cle a expr.json (les autres expressions de cette image-cle et les autres images-cles
    sont gardees), puis met a jour l'orbite (instant et liste des expressions)."""
    try:
        data = json.loads((folder / "expr.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {"keys": []}
    old = next((e for e in data["keys"] if e["f"] == entry["f"]), None)
    if old and (old["x"], old["y"], old["s"]) == (entry["x"], entry["y"], entry["s"]):
        old["cards"].update(entry["cards"])
        old.setdefault("out", {}).update(entry["out"])
        gm = {k: v for k, v in (old.get("gom") or {}).items() if k not in entry["cards"]}
        gm.update(entry.get("gom") or {})
        if gm:
            old["gom"] = gm
        else:
            old.pop("gom", None)
    else:
        data["keys"] = [e for e in data["keys"] if e["f"] != entry["f"]] + [entry]
    data.update(w=mouth["w"], h=mouth["h"], model=model)
    data["keys"].sort(key=lambda e: e["f"])
    (folder / "expr.json").write_text(json.dumps(data), encoding="utf-8")
    names = sorted({k for e in data["keys"] for k in e["cards"]}, key=lambda k: [x[0] for x in poses.EXPRESSIONS].index(k) if poses.expression(k) else 99)

    def fn(it):
        o = ((it["variants"].get(vid) or {}).get("orbit")) or {}
        if Path(o.get("dir") or "") == Path(folder.relative_to(store.item_dir(iid))):
            o["expr"] = int(time.time() * 1000)
            o["exprs"] = names
    store.mutate_item(iid, fn)


def remove(iid, vid, keys=None):
    """Retire des expressions (toutes si keys est vide) d'une orbite : cartes, expr.json, liste de l'orbite."""
    _, o, folder = orbit_folder(iid, vid)
    try:
        data = json.loads((folder / "expr.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {"keys": []}
    for e in data["keys"]:
        for k in list(e["cards"]):
            if not keys or k in keys:
                (folder / e["cards"].pop(k)).unlink(missing_ok=True)
                e.get("out", {}).pop(k, None)
                g = (e.get("gom") or {}).pop(k, None)
                if g:
                    (folder / g).unlink(missing_ok=True)
    data["keys"] = [e for e in data["keys"] if e["cards"]]
    names = sorted({k for e in data["keys"] for k in e["cards"]})
    if data["keys"]:
        (folder / "expr.json").write_text(json.dumps(data), encoding="utf-8")
    else:
        (folder / "expr.json").unlink(missing_ok=True)

    def fn(it):
        oo = ((it["variants"].get(vid) or {}).get("orbit")) or {}
        if oo.get("dir") == o["dir"]:
            if names:
                oo["exprs"], oo["expr"] = names, int(time.time() * 1000)
            else:
                oo.pop("exprs", None)
                oo.pop("expr", None)
    return store.mutate_item(iid, fn)


def bake(iid, vid="base", reach=4, test=False):
    """Cartes « cuites » image par image (comme tools/levres_bake.py pour les bouches) : une carte de visage recalee sur une
    image voisine par les seuls bouts de la bouche laisse voir un double contour de tete des 3 images d'ecart. Ici, pour
    chaque image de face a `reach` images au plus d'une image-cle dessinee, le flot optique entre cette image et l'image-cle
    deforme la carte et sa gomme : une carte par image, posee sans recalage. expr.json prend exact: true (l'affichage ne
    recale plus une carte sur une voisine) ; les cles cuites portent cuite: f de l'image-cle. Les anciennes sont refaites."""
    import cv2
    _, o, od = orbit_folder(iid, vid)
    data = json.loads((od / "expr.json").read_text(encoding="utf-8"))
    frames = json.loads((od / "mouth.json").read_text(encoding="utf-8"))["frames"]
    n = len(frames)
    drawn = [k for k in data["keys"] if "cuite" not in k]
    for k in data["keys"]:                                   # les anciennes cartes cuites partent
        if "cuite" in k and not test:
            for rel in list(k["cards"].values()) + list((k.get("gom") or {}).values()):
                (od / rel).unlink(missing_ok=True)
    taken = {k["f"] for k in drawn}
    cache = {}

    def spr(i):
        if i not in cache:
            cache[i] = Image.open(od / ("%03d.webp" % i)).convert("RGBA")
        return cache[i]

    def gray(im):
        a = np.asarray(im).astype(np.float32)
        rgb = a[..., :3] * (a[..., 3:] / 255) + 255 * (1 - a[..., 3:] / 255)
        return rgb.mean(axis=2).astype(np.uint8), a[..., 3] / 255
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    new = []
    for i in range(n):
        m = frames[i]
        if i in taken or not m or not m.get("up") or m.get("ext") or m.get("back"):
            continue
        best = None
        for k in drawn:
            dd = abs(k["f"] - i)
            dd = min(dd, n - dd)
            if dd <= reach and (best is None or dd < best[1]):
                best = (k, dd)
        if not best:
            continue
        k, far = best
        x, y, sz = int(k["x"]), int(k["y"]), int(k["s"])
        mg = int(sz * 0.25)
        Wd, Hd = spr(i).size
        X0, Y0, X1, Y1 = max(0, x - mg), max(0, y - mg), min(Wd, x + sz + mg), min(Hd, y + sz + mg)
        gi, ai = gray(spr(i).crop((X0, Y0, X1, Y1)))
        gk, _ = gray(spr(k["f"]).crop((X0, Y0, X1, Y1)))
        flow = dis.calc(gi, gk, None)                       # pixel p de l'image i -> p + flot dans l'image-cle
        sg = max(3.0, sz * 0.03)
        flow = np.stack([cv2.GaussianBlur(flow[..., c], (0, 0), sg) for c in range(2)], -1)
        h, w = gi.shape
        gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
        mapx, mapy = gx + flow[..., 0], gy + flow[..., 1]
        sl = (slice(y - Y0, y - Y0 + sz), slice(x - X0, x - X0 + sz))

        def warp(arr):
            big = np.zeros((h, w) + arr.shape[2:], np.float32)
            big[sl] = arr
            if big.ndim == 2:
                return cv2.remap(big, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
            return np.stack([cv2.remap(big[..., c], mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
                             for c in range(big.shape[2])], -1)
        entry = {"f": i, "x": x, "y": y, "s": sz, "cards": {}, "gom": {}, "cuite": k["f"], "ecart": far}
        for ex, rel in k["cards"].items():
            card = np.asarray(Image.open(od / rel).convert("RGBA").resize((sz, sz), Image.LANCZOS), np.float32)
            wc = warp(card)
            wc[..., 3] *= np.clip(ai, 0, 1)                     # jamais hors de la silhouette de cette image
            name = "expr/c%03d_%s.webp" % (i, ex)
            entry["cards"][ex] = name
            gsrc = (k.get("gom") or {}).get(ex)
            gw = None
            if gsrc:
                g = np.asarray(Image.open(od / gsrc).convert("RGBA").resize((sz, sz), Image.LANCZOS))[..., 3].astype(np.float32)
                gw = warp(g) * ai
                entry["gom"][ex] = name[:-5] + "_g.webp"
            if not test:
                Image.fromarray(wc[sl].clip(0, 255).astype(np.uint8), "RGBA").save(od / name, quality=92, method=4)
                if gw is not None:
                    gim = Image.new("RGBA", (sz, sz), (0, 0, 0, 0))
                    gim.putalpha(Image.fromarray(gw[sl].clip(0, 255).astype(np.uint8)))
                    gim.save(od / entry["gom"][ex], lossless=True, method=4)
        if not entry["gom"]:
            entry.pop("gom")
        new.append(entry)
    if not test:
        data["keys"] = sorted(drawn + new, key=lambda e: e["f"])
        data["exact"] = True
        (od / "expr.json").write_text(json.dumps(data), encoding="utf-8")

        def fn(it):
            oo = ((it["variants"].get(vid) or {}).get("orbit")) or {}
            if oo.get("dir") == o["dir"]:
                oo["expr"] = int(time.time() * 1000)
        store.mutate_item(iid, fn)
    return new


def groups(keys):
    """Les expressions par grilles de quatre (la derniere completee par des cases inchangees)."""
    keys = list(keys)
    return [(keys[i:i + 4] + [None] * 4)[:4] for i in range(0, len(keys), 4)]


def sheet(rows, out):
    """Planche de controle : une rangee par image-cle (decoupe d'origine, puis chaque expression), a l'echelle 2."""
    if not rows:
        return None
    z, cell = 2, max(r[0].width for r in rows) * 2
    im = Image.new("RGB", (cell * max(len(r) for r in rows), cell * len(rows)), "white")
    for j, r in enumerate(rows):
        for i, c in enumerate(r):
            im.paste(c.resize((c.width * z, c.height * z), Image.LANCZOS), (i * cell, j * cell))
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, quality=88)
    return out


# ------------------------------------------------------------------ calcul sur fal (tache item_expr)
def run_fal(job, keys, frames=None, vid="base"):
    """Pour chaque image-cle, une grille par groupe de quatre expressions envoyee a Nano Banana Pro (fal, 1 image par
    grille), puis les cartes. Le cout est compte sur l'element (FalProvider.run). Rend le chemin de la planche."""
    from . import falapi
    iid = job["params"]["item"]
    frames = frames or default_frames(iid, vid)
    if not frames:
        raise ValueError("aucune image de face avec une bouche suivie sur cette pose : trace d'abord la bouche (montage)")
    prov = falapi.FalProvider(settings.load()["fal"].get("key"), job)
    tmp = settings.DATA / "tmp" / ("expr_%s_%s_%d" % (iid, vid, int(time.time())))
    tmp.mkdir(parents=True, exist_ok=True)
    rows, todo = [], [(f, g) for f in frames for g in groups(keys)]
    try:
        for n, (f, g) in enumerate(todo):
            if job.get("_cancel"):
                break
            job["progress"] = "expressions : grille %d sur %d (image %d)" % (n + 1, len(todo), f)
            _, _, s, _, flat, _, _, _ = crop(iid, vid, f)
            src = tmp / ("grille_%03d_%d.png" % (f, n))
            grid_from(flat).save(src)
            out = prov.run(MODEL, {"prompt": prompt(g), "image_urls": [prov.upload(src)], "num_images": 1, "aspect_ratio": "1:1"})
            got = prov.fetch(out["images"][0]["url"], tmp / ("rendu_%03d_%d.png" % (f, n)))
            _, row = assemble(iid, vid, f, got, g, model=MODEL)
            rows.append(row)
        if rows:
            job["progress"] = "expressions : cartes image par image"
            bake(iid, vid)
    finally:
        for p in tmp.glob("*"):
            p.unlink(missing_ok=True)
        tmp.rmdir()
    return sheet(rows, settings.DATA / "qa" / ("expressions-%s-%s.jpg" % (iid, vid)))


def estimate(n_expr, n_frames=3):
    """Cout au pire : une image Nano Banana Pro par grille de quatre expressions et par image-cle."""
    from . import cost
    return cost.fal_price(MODEL, {}) * -(-n_expr // 4) * n_frames


# ------------------------------------------------------------------ essai sans calcul
def fake_grid(iid, vid, f, keys):
    """Fausse grille rendue, pour essayer l'affichage sans rien payer : sur chaque case, des sourcils et une bouche fermee
    traces grossierement (forme selon l'expression), a la place supposee du visage. Rien d'un vrai dessin."""
    x, y, s, rgba, flat, m, _, _ = crop(iid, vid, f)
    mx, my, mw = m["cx"] - x, m["cy"] - y, m["hw"] * 0.33      # echelle du visage : un tiers de la largeur de tete
    g = grid_from(flat)
    d = ImageDraw.Draw(g)
    k = CELL / s
    shapes = {"joie": (-0.25, 0.5), "colere": (0.45, -0.5), "tristesse": (-0.5, -0.45), "surprise": (-0.7, 0.0)}
    for c, key in enumerate(keys):
        if not key:
            continue
        ox, oy = cell_origin(c)
        tilt, smile = shapes.get(key, (0.3, 0.3))
        by = my - mw * 2.0
        for side in (-1, 1):
            x0, x1 = mx + side * mw * 0.35, mx + side * mw * 1.05
            ya, yb = by + tilt * mw * 0.35 * (1 if side < 0 else 1), by - tilt * mw * 0.35
            d.line([(ox + x0 * k, oy + ya * k), (ox + x1 * k, oy + yb * k)], fill=(20, 20, 20), width=max(3, int(mw * k * 0.09)))
        d.rectangle([ox + (mx - mw * 0.7) * k, oy + (my - mw * 0.25) * k, ox + (mx + mw * 0.7) * k, oy + (my + mw * 0.3) * k], fill=flat.getpixel((int(mx), int(min(s - 1, my + mw * 0.6)))))
        d.arc([ox + (mx - mw * 0.6) * k, oy + (my - mw * 0.3 * (1 + smile)) * k, ox + (mx + mw * 0.6) * k, oy + (my + mw * 0.3 * (1 - smile) + 1) * k],
              20 if smile > 0 else 200, 160 if smile > 0 else 340, fill=(20, 20, 20), width=max(3, int(mw * k * 0.08)))
    return g
