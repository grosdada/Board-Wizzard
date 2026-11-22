"""Elements de corps de la Banque Claude, decoupes dans les 12 corps encres (data/bodies, voir tools/corps.py).

Chaque corps encre est coupe en torse, bras, mains, jambes et chaussures, dans le cadre 1000 x 2000 du generateur de corps
(app/partbanks.py) : un element garde sa place, et les elements d'un meme corps se remettent exactement l'un sur l'autre.
L'alpha vient du corps entier rebouche (le blanc des vetements reste opaque) ; une coupe qui n'est pas un bord du dessin
(epaule, poignet, haut d'une chaussure) s'efface en fondu, pour ne pas laisser un bord blanc franc sur l'element du dessous.
Chaque element recouvre un peu la place de celui qui passe dessus (ordre du generateur : jambes, chaussures, torse, bras,
mains) : on peut melanger les elements de deux corps. Les paires (bras, mains, jambes, chaussures) sont rognees de facon
symetrique autour de l'axe x = 500, pour que « Separer » coupe au milieu.

  decouper(refaire=False) -> nombre d'elements ecrits dans data/parts/_corps-claude/<categorie>/
  planche(cat, sortie)    -> planche de controle d'une categorie
"""
import json

import numpy as np
from PIL import Image, ImageDraw

from . import bodydraw as B
from . import parts, settings, sprites, store

ROOT = parts.ROOT / "_corps-claude"
CATS = ("torse", "bras", "mains", "jambes", "chaussures")
FADE = 14                                         # longueur du fondu d'une coupe, en pixels du cadre

# bas du haut (torse) par rapport a la ceinture de bodydraw, en hauteurs de tete : mesure a l'oeil sur data/qa/corps-el/grille.jpg
HEM = {"moyen-t-shirt-et-pantalon": 0.05, "mince-chemise": -0.02, "costaud-t-shirt": 0.03, "rond-pull": 0.1, "costume": 0.55,
       "sweat-a-capuche-baskets": 0.1, "robe": -0.4, "jupe-et-blouse": 0.12, "debardeur-et-short": 0.3, "salopette-bottes": 0.05,
       "grand-mince-costume": 0.42, "petit-trapu": 0.04}
# poignets (bas des manches) par rapport a la ceinture, meme mesure
WRIST = {"rond-pull": 0.24, "petit-trapu": 0.72, "grand-mince-costume": 0.56, "sweat-a-capuche-baskets": 0.56}
# corps dont la main touche la jupe : la main est coupee le long du bord de la jupe
HAND_INK = {"robe", "jupe-et-blouse"}
# noms des elements, d'apres la tenue de chaque corps ; deux elements du meme nom sont distingues par leur corps (TAG)
NOMS = {"torse": {"tshirt": "T-shirt", "chemise": "Chemise", "veste": "Veste de costume", "sweat": "Sweat à capuche",
                  "debardeur": "Débardeur", "pull": "Pull", "blouse": "Blouse"},
        "jambes": {"pantalon": "Pantalon", "short": "Short", "jupe": "Jupe", "robe": "Jupe de robe", "salopette": "Salopette"},
        "chaussures": {"chaussures": "Chaussures", "bottes": "Bottes", "baskets": "Baskets"},
        "manches": {"tshirt": "de t-shirt", "chemise": "de chemise", "veste": "de veste", "sweat": "de sweat", "pull": "de pull",
                    "blouse": "de blouse", "robe": "de robe"}}
# manches telles qu'encrees, quand l'encrage s'est ecarte des cotes de bodydraw
MANCHES = {"robe": "longues", "petit-trapu": "longues"}
TAG = {"moyen-t-shirt-et-pantalon": "moyen", "mince-chemise": "mince", "costaud-t-shirt": "costaud", "rond-pull": "rond",
       "costume": "costume", "sweat-a-capuche-baskets": "sweat", "robe": "robe", "jupe-et-blouse": "jupe et blouse",
       "debardeur-et-short": "sportif", "salopette-bottes": "salopette", "grand-mince-costume": "grand, mince",
       "petit-trapu": "petit, trapu"}


def _full(slug):
    """Le corps encre dans le cadre : couleurs (RGB) et alpha du corps entier, tete vide effacee."""
    im = Image.open(settings.DATA / "bodies" / (slug + ".png")).convert("RGB").resize((B.W, B.H), Image.LANCZOS)
    s = B.HEAD_SCALE
    ImageDraw.Draw(im).ellipse([B.CX - 250 * s - 26, B.CHIN - 730 * s - 40, B.CX + 250 * s + 26, B.CHIN - 6], fill="white")
    rgb = np.asarray(im)
    g = rgb.mean(axis=2).astype(np.float32)
    a = sprites.fill_holes((np.clip((235.0 - g) / 150.0, 0, 1) * 255).astype(np.uint8))
    return rgb, a


def _ramp(d):
    """d : distance (pixels) du cote garde de la coupe ; 0 sur la coupe -> 0, FADE et plus -> 1."""
    return np.clip(d / FADE, 0, 1)


def _gaps(a, y0, y1):
    """Pour chaque ligne de y0 a y1 : colonne du vide entre le corps et le bras, a gauche et a droite (None sans vide).
    Seulement la ou le corps occupe l'axe : entre deux jambes, le vide n'est pas celui du bras."""
    out = {}
    cx = B.CX
    for y in range(int(y0), int(y1)):
        row = a[y] > 40
        if not row[cx]:
            continue
        res = []
        for sg in (-1, 1):
            x, n = cx, 0
            while 0 < x < B.W - 1 and row[x]:            # le corps, depuis l'axe
                x += sg
            g0 = x
            while 0 < x < B.W - 1 and not row[x]:
                x += sg
                n += 1
            res.append((g0 + x) / 2 if 2 < n < 160 and 0 < x < B.W - 1 else None)
        out[y] = res
    return out


def _keep(mask, seed):
    """Les parties de mask (d'un seul tenant) qui touchent seed."""
    from scipy import ndimage
    lab, n = ndimage.label(mask)
    ids = np.unique(lab[seed & mask])
    return np.isin(lab, ids[ids > 0])


def _track(rgb, ys, xs, top, y_ais, u):
    """Au-dessus du plus haut vide, suit vers le haut le trait d'encre le plus proche (le bord interieur de la manche)."""
    g = rgb.mean(axis=2)
    x = float(np.median(xs[ys < top + 15]))
    add_y, add_x = [], []
    for y in range(int(top) - 1, int(y_ais), -1):
        lo, hi = int(x - 10), int(x + 11)
        dark = np.where(g[y, lo:hi] < 110)[0]
        if len(dark):
            x = 0.7 * x + 0.3 * (lo + dark[np.argmin(np.abs(dark + lo - x))])
        add_y.append(y)
        add_x.append(x)
    if not add_y:
        return ys, xs, top
    ys2 = np.concatenate([np.array(add_y[::-1], np.float32), ys])
    xs2 = np.concatenate([np.array(add_x[::-1], np.float32), xs])
    o = np.argsort(ys2)
    return ys2[o], xs2[o], float(ys2.min())


def _cut(slug, kw):
    p = dict(B.CORPS, **kw)
    u = B.U
    Y = lambda d: B.CHIN + d * u
    rgb, a = _full(slug)
    H, W = a.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    y_ce = p["buste"]
    hem = Y(y_ce + HEM.get(slug, 0.05))
    y_shoe = Y(y_ce + p["jambes"] - 0.1)            # haut des chaussures (un peu au-dessus de la cheville)
    y_wr = Y(y_ce + WRIST.get(slug, 0.6))            # poignets
    y_ais = Y(0.95)
    y_ep = Y(0.42)

    # separation bras / corps : le vide entre les deux, ligne par ligne, la ou il est pres du bord attendu du bras ;
    # au-dessus de l'aisselle, une ligne qui monte vers l'epaule : l'arrondi de l'epaule part avec le bras
    gaps = _gaps(a, y_ais - 0.3 * u, Y(y_ce + 0.7))
    sep = np.zeros((2, H), np.float32)
    rows = np.arange(H, dtype=np.float32)
    for k, sg in enumerate((-1, 1)):
        expect = B.CX + sg * (p["ep"] - 1.9 * p["bras"] + p["ventre"] * 0.3) * u
        known = [(y, g[k]) for y, g in gaps.items() if g[k] is not None and abs(g[k] - expect) < 0.45 * u]
        sx = B.CX + sg * max(p["cou"] * 1.5, p["ep"] * 0.55) * u        # haut de la couture d'epaule
        ys_ = y_ep - 0.1 * u
        if len(known) < 5:
            ys = np.array([y_ais, Y(y_ce + 0.7)], np.float32)
            xs = np.array([expect, expect + sg * 0.1 * u], np.float32)
        else:
            ys = np.array([q[0] for q in known], np.float32)
            xs = np.array([q[1] for q in known], np.float32)
        top = float(ys.min())
        if top > y_ais + 0.4 * u and len(known) >= 5:  # bras colle au corps (sweat) : on remonte le trait entre les deux
            ys, xs, top = _track(rgb, ys, xs, top, y_ais, u)
        ax = float(np.median(xs[ys < top + 25]))
        col = np.interp(rows, ys, xs)
        up = rows < top
        t = np.clip((top - rows) / max(1.0, top - ys_), 0, 1)
        col[up] = (ax + (sx - ax) * t)[up]
        sep[k] = col
    # distance (signee, vers l'exterieur) a la separation, pour chaque pixel
    sl = sep[0][:, None] - xx                        # > 0 : a gauche de la separation gauche (dans le bras gauche)
    sr = xx - sep[1][:, None]                        # > 0 : a droite de la separation droite
    out_arm = np.maximum(sl, sr)                     # > 0 : dans un bras

    alpha = a.astype(np.float32) / 255
    els = {}
    # torse : du cou au bas du haut, entre les bras ; il passe un peu sous les bras (ils le couvrent)
    m = alpha * (yy < hem + 2) * (out_arm < 6)
    els["torse"] = m
    # bras : hors de la separation, du haut au-dessous du poignet (la main passe dessus) ; l'epaule s'efface en fondu
    m = alpha * (out_arm > -2) * _ramp(out_arm + 2) * (yy < y_wr + 0.18 * u)
    els["bras"] = m
    # mains : ce qui tient au poignet, sous le poignet, hors des bras du corps ; le haut s'efface en fondu sur la manche
    body = a > 40
    wrist = (yy > y_wr - 0.05 * u) & (yy < y_wr + 0.08 * u) & (out_arm > 0)
    near = np.zeros_like(body)                       # autour du poignet seulement : une jupe ou une poche qui touche la main reste
    for sg in (-1, 1):
        w_ = wrist & (body) & ((xx - B.CX) * sg > 0)
        if w_.any():
            xw = float(xx[w_].mean())
            near |= ((xx - xw) * sg > -0.12 * u) & ((xx - xw) * sg < 0.34 * u)
    zone = body & near & (yy > y_wr - 0.05 * u) & (yy < y_wr + 0.75 * u)
    hands = _keep(zone, wrist)
    skirt = np.zeros_like(body)                      # hors du bord de la jupe, a hauteur des mains (corps HAND_INK)
    if slug in HAND_INK:                             # le bord de la jupe : un trait droit, net sous les doigts ; on le prolonge
        g = rgb.mean(axis=2)
        for sg in (-1, 1):
            side = zone & ((xx - B.CX) * sg > 0)
            pts = []
            for y in range(int(y_wr + 0.62 * u), int(y_wr + 0.75 * u)):
                xs_ = np.where(side[y] & (g[y] < 110))[0]
                if len(xs_):
                    pts.append((y, xs_.max() if sg > 0 else xs_.min()))     # le trait le plus a l'exterieur : le bord
            if len(pts) > 8:
                k_, b_ = np.polyfit([q[0] for q in pts], [q[1] for q in pts], 1)
                line = k_ * yy + b_
                hands &= ~(((xx - line) * sg < 10) & ((xx - B.CX) * sg > 0))
                skirt |= ((xx - line) * sg > 6) & ((xx - B.CX) * sg > 0) & (yy < y_wr + 0.8 * u)
        white = hands & (g > 150)                    # le blanc entre la main et la jupe : il descend sous les doigts
        hands &= ~_keep(white, white & (yy > y_wr + 0.6 * u))
        hands = _keep(hands, wrist)
    els["mains"] = alpha * hands * _ramp(yy - (y_wr - 0.05 * u))
    # jambes : du dessous du haut (elles y montent un peu) jusque sous le haut des chaussures ; ce qui tient aux chevilles,
    # sans les bras ni les mains (une jupe large deborde la ligne des bras plus bas que les poignets)
    arms_low = y_wr - 0.05 * u if slug in HAND_INK else y_wr + 0.18 * u
    band = body & (yy > hem - 0.3 * u) & (yy < y_shoe + 0.12 * u) & ~hands & ~skirt & ~((out_arm > -4) & (yy < arms_low))
    legs = _keep(band, band & (yy > y_shoe - 0.1 * u))
    els["jambes"] = alpha * legs
    # chaussures : sous la ligne ; le haut s'efface en fondu sur le bas de la jambe
    els["chaussures"] = alpha * (yy > y_shoe) * _ramp(yy - y_shoe) * ~_keep(body & (yy > y_shoe), body & (yy > y_shoe) & hands)
    return rgb, els


def _store(rgb, m, d, pid, meta, sym):
    a = (np.clip(m, 0, 1) * 255).astype(np.uint8)
    ys, xs = np.where(a > 8)
    if len(xs) < 200:
        return None
    x0, x1, y0, y1 = int(xs.min()) - 3, int(xs.max()) + 4, int(ys.min()) - 3, int(ys.max()) + 4
    if sym:                                          # une paire : centree sur l'axe, pour que la separation coupe au milieu
        half = max(B.CX - x0, x1 - B.CX)
        x0, x1 = B.CX - half, B.CX + half
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(B.W, x1), min(B.H, y1)
    im = Image.fromarray(np.dstack([rgb, a])).crop((x0, y0, x1, y1))
    d.mkdir(parents=True, exist_ok=True)
    im.save(d / (pid + ".png"))
    meta = dict(meta, kit="corps", place=[round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1), x1 - x0])
    (d / (pid + ".json")).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


def _base(cat, p):
    if cat == "torse":
        return {"robe": "Haut de robe", "salopette": "T-shirt et bavette"}.get(p["bas"]) or NOMS["torse"].get(p["haut"], p["haut"])
    if cat == "jambes":
        return NOMS["jambes"].get(p["bas"], p["bas"])
    if cat == "chaussures":
        return NOMS["chaussures"].get(p["pieds"], p["pieds"])
    if cat == "bras":
        if p["manches"] == "sans":
            return "Bras nus"
        return "Manches %s %s" % ("courtes" if p["manches"] == "courtes" else "longues",
                                  NOMS["manches"].get("robe" if p["bas"] == "robe" else p["haut"], ""))
    return "Mains"


def names():
    """Nom de chaque element : (categorie, corps) -> nom ; le corps entre parentheses quand deux elements se ressemblent."""
    def cotes(n, kw):
        p = dict(B.CORPS, **kw)
        p["manches"] = MANCHES.get(store.slug(n), p["manches"])
        return p
    base = {(c, store.slug(n)): _base(c, cotes(n, kw)) for n, kw in B.CORPS_VARIANTES for c in CATS}
    out = {}
    for (c, slug), b in base.items():
        twins = [k for k, v in base.items() if k[0] == c and v == b]
        out[(c, slug)] = "%s (%s)" % (b, TAG.get(slug, slug)) if len(twins) > 1 else b
    return out


def decouper(refaire=False, seul=None):
    n, nm = 0, names()
    for nom, kw in B.CORPS_VARIANTES:
        slug = store.slug(nom)
        if seul and slug != store.slug(seul):
            continue
        if not (settings.DATA / "bodies" / (slug + ".png")).exists():
            continue
        if not refaire and all((ROOT / c / (slug + ".png")).exists() for c in CATS):
            continue
        rgb, els = _cut(slug, kw)
        for c in CATS:
            if _store(rgb, els[c], ROOT / c, slug, {"name": nm[(c, slug)], "src": slug}, sym=c != "torse"):
                n += 1
    return n


def planche(cat, sortie):
    fs = sorted((ROOT / cat).glob("*.png"))
    if not fs:
        return None
    cell = 300
    sh = Image.new("RGB", (cell * min(6, len(fs)), cell * ((len(fs) + 5) // 6)), (205, 205, 205))
    for i, f in enumerate(fs):
        im = Image.open(f).convert("RGBA")
        im.thumbnail((cell - 10, cell - 10))
        sh.paste(im, ((i % 6) * cell + (cell - im.width) // 2, (i // 6) * cell + (cell - im.height) // 2), im)
    sortie.parent.mkdir(parents=True, exist_ok=True)
    sh.save(sortie, quality=88)
    return sortie
