"""Banques d'elements du portrait-robot et du generateur de corps.

La « Banque Claude » est la banque d'origine, rangee a la racine de data/parts (app/parts.py) : rien n'y est deplace, les
portraits deja faits gardent leurs chemins. Les autres banques sont creees par David :

  data/parts/_banks/banks.json                    [{id, name}] dans l'ordre des onglets
  data/parts/_banks/<banque>/<categorie>/<id>.png l'element, rogne, fond transparent, couleurs gardees
  data/parts/_banks/<banque>/<categorie>/<id>.json {name, place, layers, under, pair, fill, kit}

Deux « kits » de categories : visage (le portrait-robot, cadre 1000 x 1000) et corps (le generateur de corps, cadre
1000 x 2000, celui de app/bodydraw.py). Dans la Banque Claude, le corps a deux categories toutes faites : les corps
encres (data/bodies, rendus transparents dans data/parts/_corps) et les tetes envoyees du portrait-robot
(data/parts/_tetes).

Un element dessine dans l'atelier arrive en PNG transparent couvrant tout le cadre (rendu par le navigateur, calques
compris) : on le rogne, on garde sa place, et, si demande, le blanc enferme par le contour devient opaque.
"""
import json
import re
import shutil
import time

import numpy as np
from PIL import Image

from . import parts, settings, sprites, store

ROOT = parts.ROOT
BANKS = ROOT / "_banks"
CLAUDE = "claude"
FRAMES = {"visage": (1000, 1000), "corps": (1000, 2000)}
# categories du corps : cle -> (nom, rebouchage par defaut)
BODY = {"silhouette": ("Corps entier", True), "tete": ("Tête", True), "torse": ("Torse et haut", True),
        "bras": ("Bras", True), "mains": ("Mains", True), "jambes": ("Jambes et bas", True),
        "chaussures": ("Chaussures", True), "accessoires": ("Accessoires", False)}
FULL_FACE = {True, "vert", "visage", "petits"}                      # categories du visage ou le blanc enferme reste opaque
_ID = re.compile(r"[a-z0-9-]{1,60}")


def _ok(s):
    return bool(_ID.fullmatch(s or ""))


def kit_of(cat):
    if cat in parts.CATEGORIES:
        return "visage"
    if cat in BODY:
        return "corps"
    raise ValueError("catégorie inconnue : %s" % cat)


# ------------------------------------------------------------------------------------------------ banques
def _load():
    try:
        out = json.loads((BANKS / "banks.json").read_text(encoding="utf-8"))
        return [b for b in out if isinstance(b, dict) and _ok(b.get("id"))]
    except (OSError, ValueError):
        return []


def _write(rows):
    BANKS.mkdir(parents=True, exist_ok=True)
    (BANKS / "banks.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")


def banks():
    return [{"id": CLAUDE, "name": "Banque Claude", "builtin": True}] + [{"id": b["id"], "name": b.get("name") or b["id"]} for b in _load()]


def _bank(bid):
    bid = bid or CLAUDE
    if bid != CLAUDE and not any(b["id"] == bid for b in _load()):
        raise ValueError("banque inconnue")
    return bid


def add_bank(name):
    name = (name or "").strip()[:60]
    if not name:
        raise ValueError("nom de banque manquant")
    rows = _load()
    base = "b-" + store.slug(name)[:40]
    bid, i = base, 2
    while bid == CLAUDE or any(b["id"] == bid for b in rows) or (BANKS / bid).exists():
        bid, i = "%s-%d" % (base, i), i + 1
    rows.append({"id": bid, "name": name})
    _write(rows)
    (BANKS / bid).mkdir(parents=True, exist_ok=True)
    return {"id": bid, "name": name}


def rename_bank(bid, name):
    name = (name or "").strip()[:60]
    if bid == CLAUDE:
        raise ValueError("la Banque Claude garde son nom")
    if not name:
        raise ValueError("nom de banque manquant")
    rows = _load()
    for b in rows:
        if b["id"] == bid:
            b["name"] = name
            _write(rows)
            return {"id": bid, "name": name}
    raise ValueError("banque inconnue")


def remove_bank(bid):
    """Une banque retiree est mise de cote (data/parts/_retires/banques/<id>-<date>), pas detruite."""
    if bid == CLAUDE:
        raise ValueError("la Banque Claude ne se supprime pas")
    rows = _load()
    if not any(b["id"] == bid for b in rows):
        raise ValueError("banque inconnue")
    _write([b for b in rows if b["id"] != bid])
    d = BANKS / bid
    if d.exists():
        dest = ROOT / "_retires" / "banques" / ("%s-%s" % (bid, time.strftime("%Y%m%d-%H%M%S")))
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(d), str(dest))
    return {"ok": True}


# ------------------------------------------------------------------------------------------------ catalogue
def _dir(bid, cat):
    """Dossier d'une categorie dans une banque, et le prefixe des chemins servis sous /parts/."""
    if bid == CLAUDE:
        if cat == "tete":
            return ROOT / "_tetes", "_tetes/"
        if cat in BODY:
            return ROOT / "_corps-el" / cat, "_corps-el/%s/" % cat
        return ROOT / cat, "%s/" % cat
    return BANKS / bid / cat, "_banks/%s/%s/" % (bid, cat)


def _meta(d, pid):
    try:
        return json.loads((d / (pid + ".json")).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _rows(bid, cat):
    """Elements d'une categorie, tous dessines a la main (sauf les corps encres de la Banque Claude)."""
    d, pre = _dir(bid, cat)
    out, dirs = [], [(d, pre, True)]
    if bid == CLAUDE and cat == "silhouette":                       # les corps encres d'abord (ils restent), puis ceux dessines
        _bodies()
        dirs.insert(0, (ROOT / "_corps", "_corps/", False))
    for d, pre, mine in dirs:
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.png"), key=lambda p: p.stat().st_mtime):
            pid, meta = f.stem, _meta(d, f.stem)
            row = {"id": pid, "name": meta.get("name") or pid.replace("-", " ").capitalize(), "file": pre + f.name,
                   "mine": mine, "t": int(f.stat().st_mtime),
                   "editable": bool(meta.get("layers") or meta.get("shapes"))}
            if meta.get("place"):
                row["place"] = meta["place"]
            if meta.get("pair"):
                row["pair"] = True
            out.append(row)
    return out


def catalogue(bid=CLAUDE, kit="visage"):
    bid = _bank(bid)
    if kit == "corps":
        return [{"key": c, "label": v[0], "fill": v[1], "items": _rows(bid, c)} for c, v in BODY.items()]
    if bid == CLAUDE:                                               # la banque d'origine, telle que app/parts.py la lit
        rows = parts.catalogue()
        for c in rows:
            c["fill"] = parts.CATEGORIES[c["key"]][1] in FULL_FACE
            for r in c["items"]:
                if r.get("mine") and not r.get("editable") and _meta(ROOT / c["key"], r["id"]).get("layers"):
                    r["editable"] = True
        return rows
    return [{"key": c, "label": v[0], "fill": v[1] in FULL_FACE, "items": _rows(bid, c)} for c, v in parts.CATEGORIES.items()]


def _bodies():
    """Corps encres (data/bodies) rendus transparents pour le generateur, tete vide effacee, dans le cadre 1000 x 2000."""
    from PIL import ImageDraw
    from . import bodydraw
    src = settings.DATA / "bodies"
    if not src.is_dir():
        return
    d = ROOT / "_corps"
    names = {store.slug(n): n for n, _ in bodydraw.CORPS_VARIANTES}
    for f in src.glob("*.png"):
        dest = d / f.name
        if dest.exists() and dest.stat().st_mtime >= f.stat().st_mtime:
            continue
        im = Image.open(f).convert("RGB").resize(FRAMES["corps"], Image.LANCZOS)
        s, cx, chin = bodydraw.HEAD_SCALE, bodydraw.CX, bodydraw.CHIN
        ImageDraw.Draw(im).ellipse([cx - 250 * s - 26, chin - 730 * s - 40, cx + 250 * s + 26, chin - 6], fill="white")
        g = np.asarray(im.convert("L")).astype(np.float32)
        a = sprites.fill_holes((np.clip((235.0 - g) / 150.0, 0, 1) * 255).astype(np.uint8))
        rgba = np.dstack([np.asarray(im), a])
        _store(Image.fromarray(rgba), d, f.stem, {"name": names.get(f.stem, f.stem)}, FRAMES["corps"], fill=False)


# ------------------------------------------------------------------------------------------------ elements
def _store(im, d, pid, meta, frame, fill=False, size=1400):
    """im : RGBA couvrant le cadre (frame = largeur, hauteur en unites). Rogne, rebouche si demande, garde la place."""
    arr = np.asarray(im.convert("RGBA")).copy()
    a = arr[..., 3]
    if fill:                                                        # le blanc enferme par le contour devient opaque
        filled = sprites.fill_holes(a)
        add = (filled > a)
        for c in range(3):
            arr[..., c] = np.where(add & (a < 20), 255, arr[..., c])
        arr[..., 3] = np.maximum(a, filled)
        a = arr[..., 3]
    ys, xs = np.where(a > 8)
    if len(xs) < 30:
        raise ValueError("dessin vide")
    x0, x1, y0, y1 = max(0, xs.min() - 3), min(a.shape[1], xs.max() + 4), max(0, ys.min() - 3), min(a.shape[0], ys.max() + 4)
    out = Image.fromarray(arr).crop((int(x0), int(y0), int(x1), int(y1)))
    kx, ky = frame[0] / a.shape[1], frame[1] / a.shape[0]
    out.thumbnail((size, size), Image.LANCZOS)
    d.mkdir(parents=True, exist_ok=True)
    out.save(d / (pid + ".png"))
    meta = dict(meta)
    meta["place"] = [round((x0 + x1) / 2 * kx, 1), round((y0 + y1) / 2 * ky, 1), round((x1 - x0) * kx)]
    (d / (pid + ".json")).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


def _free_id(d, name):
    pid = store.slug(name or "dessin")
    base, i = pid, 2
    while (d / (pid + ".png")).exists():
        pid, i = "%s-%d" % (base, i), i + 1
    return pid


def save_raw(bid, cat, name, png_bytes, replace=None, fill=False):
    """Element dessine dans l'atelier : PNG transparent couvrant le cadre de son kit. replace : id a remplacer."""
    import io
    bid, kit = _bank(bid), kit_of(cat)
    d, _ = _dir(bid, cat)
    if replace:
        if not _ok(replace) or not (d / (replace + ".png")).exists():
            raise ValueError("élément inconnu")
        pid = replace
    else:
        pid = _free_id(d, name)
        while bid == CLAUDE and cat == "silhouette" and (ROOT / "_corps" / (pid + ".png")).exists():   # pas le nom d'un corps encre
            pid = _free_id(d, pid + "-2")
    im = Image.open(io.BytesIO(png_bytes))
    meta = _meta(d, pid) if replace else {}
    meta.update(name=(name or meta.get("name") or pid), kit=kit, fill=bool(fill))
    _store(im, d, pid, meta, FRAMES[kit], fill=fill)
    return next(r for r in item_rows(bid, cat) if r["id"] == pid)


def item_rows(bid, cat):
    if bid == CLAUDE and cat in parts.CATEGORIES:
        rows = parts.index().get(cat, [])
        for r in rows:
            if r.get("mine") and _meta(ROOT / cat, r["id"]).get("layers"):
                r["editable"] = True
        return rows
    return _rows(bid, cat)


def drawn(bid, cat, pid):
    bid = _bank(bid)
    kit_of(cat)
    if not _ok(pid):
        raise ValueError("élément inconnu")
    return _meta(_dir(bid, cat)[0], pid)


def save_meta(bid, cat, pid, data):
    """Calques (et image de fond d'une retouche) d'un element dessine, a cote de son PNG, pour le rouvrir."""
    bid = _bank(bid)
    kit_of(cat)
    d = _dir(bid, cat)[0]
    if not _ok(pid) or not (d / (pid + ".png")).exists():
        raise ValueError("élément inconnu")
    meta = _meta(d, pid)
    lay = data.get("layers")
    meta["layers"] = lay if isinstance(lay, list) else []
    meta["shapes"] = [s for l in meta["layers"] if isinstance(l, dict) and not l.get("hidden") for s in (l.get("shapes") or [])]
    meta["under"] = data.get("under") if isinstance(data.get("under"), dict) else None
    meta["pair"] = bool(data.get("pair"))
    if "fill" in data:
        meta["fill"] = bool(data.get("fill"))
    (d / (pid + ".json")).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


def remove(bid, cat, pid):
    bid = _bank(bid)
    kit_of(cat)
    if not _ok(pid):
        raise ValueError("élément inconnu")
    if bid == CLAUDE and cat in parts.CATEGORIES:
        return parts.remove(cat, pid)
    d = _dir(bid, cat)[0]                                           # (les corps encres de la Banque Claude restent)
    dest = ROOT / "_retires" / ("_banks/%s/%s" % (bid, cat) if bid != CLAUDE else "_corps-el/" + cat)
    for f in (d / (pid + ".png"), d / (pid + ".json")):
        if f.exists():
            dest.mkdir(parents=True, exist_ok=True)
            shutil.move(str(f), str(dest / f.name))


def add_head(png_bytes, name=""):
    """Tete envoyee du portrait-robot (PNG transparent, cadre des visages 1000 x 1000) : rangee dans la categorie « Tete »
    de la Banque Claude, a sa place dans le cadre du corps (meme echelle que les corps encres)."""
    import io
    from . import bodydraw
    im = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    d = ROOT / "_tetes"
    pid = _free_id(d, name or "tete")
    meta = _store(im, d, pid, {"name": name or "Tête", "kit": "corps"}, FRAMES["visage"])
    s = bodydraw.HEAD_SCALE
    ox, oy = bodydraw.CX - 500 * s, bodydraw.CHIN + bodydraw.HEAD_DROP - 880 * s
    px, py, pw = meta["place"]
    meta["place"] = [round(ox + px * s, 1), round(oy + py * s, 1), round(pw * s)]
    (d / (pid + ".json")).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    for old in sorted(d.glob("*.png"), key=lambda p: p.stat().st_mtime)[:-60]:     # les 60 dernieres tetes
        for f in (old, old.with_suffix(".json")):
            f.unlink(missing_ok=True)
    return next(r for r in _rows(CLAUDE, "tete") if r["id"] == pid)


def add_asset(data):
    """Image importee dans l'atelier (crayon scanne, forme a reprendre) : PNG dans data/parts/_assets, nomme par son
    contenu. Rend son adresse et sa taille."""
    import hashlib
    import io
    if not data or len(data) > 40 * 1024 * 1024:
        raise ValueError("image vide ou trop grosse (40 Mo au plus)")
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception as e:  # noqa: BLE001
        raise ValueError("image illisible") from e
    im = im.convert("RGBA")
    im.thumbnail((2400, 2400), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    key = hashlib.sha1(buf.getvalue()).hexdigest()[:20]
    d = ROOT / "_assets"
    d.mkdir(parents=True, exist_ok=True)
    f = d / (key + ".png")
    if not f.exists():
        f.write_bytes(buf.getvalue())
    return {"url": "/parts/_assets/%s.png" % key, "w": im.width, "h": im.height}
